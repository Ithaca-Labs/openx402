import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";

interface EncryptedSecret {
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
}

export interface StoredKey {
  network: string;
  role: "sponsor" | "channel";
  address: string;
  secret: string;
}

export class KeyStore {
  constructor(private readonly pool: Pool, private readonly encryptionKey: Buffer) {}

  private encrypt(secret: string, network: string, address: string): EncryptedSecret {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, nonce);
    cipher.setAAD(Buffer.from(`${network}\0${address}`));
    const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return { ciphertext, nonce, tag: cipher.getAuthTag() };
  }

  private decrypt(row: { ciphertext: Buffer; nonce: Buffer; tag: Buffer; network: string; address: string }): string {
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, row.nonce);
    decipher.setAAD(Buffer.from(`${row.network}\0${row.address}`));
    decipher.setAuthTag(row.tag);
    return Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString("utf8");
  }

  async put(network: string, role: StoredKey["role"], address: string, secret: string): Promise<void> {
    const encrypted = this.encrypt(secret, network, address);
    await this.pool.query(
      `INSERT INTO managed_keys(network, role, address, ciphertext, nonce, tag)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (network, address) DO UPDATE SET
         role = EXCLUDED.role, ciphertext = EXCLUDED.ciphertext, nonce = EXCLUDED.nonce,
         tag = EXCLUDED.tag, key_version = managed_keys.key_version + 1, active = true`,
      [network, role, address, encrypted.ciphertext, encrypted.nonce, encrypted.tag],
    );
  }

  private async write(client: PoolClient, network: string, role: StoredKey["role"], address: string, secret: string): Promise<void> {
    const encrypted = this.encrypt(secret, network, address);
    await client.query(
      `INSERT INTO managed_keys(network, role, address, ciphertext, nonce, tag)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (network, address) DO UPDATE SET
         role = EXCLUDED.role, ciphertext = EXCLUDED.ciphertext, nonce = EXCLUDED.nonce,
         tag = EXCLUDED.tag, key_version = managed_keys.key_version + 1, active = true`,
      [network, role, address, encrypted.ciphertext, encrypted.nonce, encrypted.tag],
    );
  }

  async rotateSponsor(network: string, address: string, secret: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const unresolved = await client.query<{ count: string }>(
        `SELECT count(*) FROM idempotency_records
         WHERE network = $1 AND status IN ('preparing', 'submitting', 'pending', 'unknown')`,
        [network],
      );
      if (BigInt(unresolved.rows[0]?.count ?? "0") !== 0n) {
        throw new Error(`${network} has unresolved settlements; sponsor rotation requires a drained facilitator`);
      }
      await client.query(
        "UPDATE managed_keys SET active = false WHERE network = $1 AND role = 'sponsor' AND active",
        [network],
      );
      await this.write(client, network, "sponsor", address, secret);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async disableChannel(network: string, address: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const active = await client.query(
        `SELECT 1 FROM channel_accounts
         WHERE network = $1 AND address = $2 AND settlement_record_id IS NOT NULL FOR UPDATE`,
        [network, address],
      );
      if (active.rowCount) throw new Error(`${address} has an unresolved settlement and cannot be disabled`);
      await client.query(
        "UPDATE managed_keys SET active = false WHERE network = $1 AND address = $2 AND role = 'channel'",
        [network, address],
      );
      await client.query(
        `UPDATE channel_accounts SET status = 'disabled', updated_at = now()
         WHERE network = $1 AND address = $2`,
        [network, address],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async list(network: string): Promise<StoredKey[]> {
    const result = await this.pool.query<{
      network: string; role: StoredKey["role"]; address: string;
      ciphertext: Buffer; nonce: Buffer; tag: Buffer;
    }>("SELECT network, role, address, ciphertext, nonce, tag FROM managed_keys WHERE network = $1 AND active", [network]);
    return result.rows.map(row => ({
      network: row.network,
      role: row.role,
      address: row.address,
      secret: this.decrypt(row),
    }));
  }
}
