import { z } from "zod";
import type { RequestEnvelope } from "../types.js";

const requirements = z.object({
  scheme: z.enum(["exact", "upto"]),
  network: z.enum(["stellar:testnet", "stellar:pubnet"]),
  asset: z.string().regex(/^C[A-Z2-7]{55}$/),
  amount: z.string().regex(/^-?(0|[1-9][0-9]*)$/),
  payTo: z.string().regex(/^[GCM][A-Z2-7]{55}$/),
  maxTimeoutSeconds: z.number().int().positive(),
  extra: z.record(z.string(), z.unknown()),
});

const payload = z.object({
  x402Version: z.number().int(),
  resource: z.object({
    url: z.string(),
    description: z.string().optional(),
    mimeType: z.string().optional(),
    serviceName: z.string().optional(),
    tags: z.array(z.string()).optional(),
    iconUrl: z.string().optional(),
  }).optional(),
  accepted: requirements,
  payload: z.object({ transaction: z.string().min(1).max(2_000_000) }).passthrough(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

const envelope = z.object({
  x402Version: z.number().int(),
  paymentPayload: payload,
  paymentRequirements: requirements,
}).strict();

export function parseEnvelope(value: unknown): RequestEnvelope {
  return envelope.parse(value) as RequestEnvelope;
}
