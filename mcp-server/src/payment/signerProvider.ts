import { createDecipheriv } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createEd25519Signer, type ClientStellarSigner } from "@x402/stellar";
import { McpToolError } from "../errors.js";
import type { StellarNetwork } from "../types.js";

/**
 * Abstraction over how the signing key is obtained. No MCP tool input ever
 * carries a secret key -- the zod schemas in `tools/index.ts` simply have no
 * such field -- so every provider here reads key material from configuration
 * the operator controls, never from an agent-supplied argument.
 */
export interface SignerProvider {
  readonly kind: "env-secret" | "external" | "encrypted-key";
  getSigner(network: StellarNetwork): Promise<ClientStellarSigner>;
}

/**
 * Reads a raw Stellar secret from an environment variable. Documented as
 * local-stdio-only: `config.ts` refuses to select this provider for the
 * remote Streamable HTTP transport.
 */
export class EnvSecretSignerProvider implements SignerProvider {
  readonly kind = "env-secret";
  constructor(private readonly envVarName: string) {}

  async getSigner(network: StellarNetwork): Promise<ClientStellarSigner> {
    const secret = process.env[this.envVarName];
    if (!secret) {
      throw new McpToolError("PAYMENT_REJECTED", `${this.envVarName} is not set; no local signer is available`);
    }
    return createEd25519Signer(secret, network);
  }
}

/**
 * Delegates signing to a remote service over HTTPS. Minimal contract:
 * `GET {baseUrl}/address` -> `{ address: string }` and
 * `POST {baseUrl}/sign-auth-entry` with `{ network, authEntryXdr }` ->
 * `{ signedAuthEntryXdr: string }`. The raw key never enters this process.
 */
export class ExternalSignerProvider implements SignerProvider {
  readonly kind = "external";
  constructor(private readonly baseUrl: string, private readonly authHeader?: string) {}

  async getSigner(network: StellarNetwork): Promise<ClientStellarSigner> {
    const headers: Record<string, string> = this.authHeader ? { authorization: this.authHeader } : {};
    const addressResponse = await fetch(new URL("/address", this.baseUrl), { headers });
    if (!addressResponse.ok) {
      throw new McpToolError("PAYMENT_REJECTED", `external signer address lookup failed (${addressResponse.status})`);
    }
    const { address } = (await addressResponse.json()) as { address: string };
    return {
      address,
      signAuthEntry: async (entryXdr, opts) => {
        const response = await fetch(new URL("/sign-auth-entry", this.baseUrl), {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ network, authEntryXdr: entryXdr, ...opts }),
        });
        if (!response.ok) {
          throw new McpToolError("PAYMENT_REJECTED", `external signer refused to sign (${response.status})`);
        }
        const { signedAuthEntryXdr } = (await response.json()) as { signedAuthEntryXdr: string };
        return { signedAuthEntry: signedAuthEntryXdr };
      },
    };
  }
}

interface EncryptedKeystore {
  ivBase64: string;
  authTagBase64: string;
  ciphertextBase64: string;
}

/**
 * Decrypts a local AES-256-GCM keystore file using a 32-byte key from an
 * env var, mirroring the facilitator's own `FACILITATOR_KEY_ENCRYPTION_KEY`
 * convention (`facilitator/src/config.ts`). The plaintext secret never
 * touches disk and is held only for the lifetime of the signing call.
 */
export class EncryptedKeyProvider implements SignerProvider {
  readonly kind = "encrypted-key";
  constructor(private readonly keystorePath: string, private readonly encryptionKeyEnvVar: string) {}

  async getSigner(network: StellarNetwork): Promise<ClientStellarSigner> {
    const keyMaterial = process.env[this.encryptionKeyEnvVar];
    if (!keyMaterial) {
      throw new McpToolError("PAYMENT_REJECTED", `${this.encryptionKeyEnvVar} is not set; keystore cannot be decrypted`);
    }
    const key = Buffer.from(keyMaterial, "base64");
    if (key.length !== 32) {
      throw new McpToolError("PAYMENT_REJECTED", `${this.encryptionKeyEnvVar} must be a base64-encoded 32-byte key`);
    }
    const raw = await readFile(this.keystorePath, "utf8").catch(() => {
      throw new McpToolError("PAYMENT_REJECTED", `keystore file not found: ${this.keystorePath}`);
    });
    const keystore = JSON.parse(raw) as EncryptedKeystore;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(keystore.ivBase64, "base64"));
    decipher.setAuthTag(Buffer.from(keystore.authTagBase64, "base64"));
    const secret = Buffer.concat([
      decipher.update(Buffer.from(keystore.ciphertextBase64, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return createEd25519Signer(secret, network);
  }
}
