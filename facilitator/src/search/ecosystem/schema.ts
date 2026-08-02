import { z } from "zod";

/**
 * The live evidence cohort retains a distinct contract inside the unified
 * evaluation program. External directories do not share the controlled cohort's
 * `.example` URL or Stellar-payment invariants, so they are normalized into
 * provenance-bearing adapter instead of being forced through the production
 * catalog seed path.
 */

export const ECOSYSTEM_SOURCES = [
  "cdp",
  "x402.direct",
  "agent-tools",
  "x402scan",
  "openx402",
] as const;

export const EcosystemSourceSchema = z.enum(ECOSYSTEM_SOURCES);
export const EcosystemTransportSchema = z.enum(["http", "mcp", "a2a", "unknown"]);

const isoDate = z.string().datetime({ offset: true });

export const EcosystemPaymentOptionSchema = z.object({
  scheme: z.string().min(1).max(64),
  network: z.string().min(1).max(200),
  asset: z.string().min(1).max(256),
  amount: z.string().min(1).max(256),
  pay_to: z.string().min(1).max(256).optional(),
  // This is observed directory metadata, not a local policy limit. Preserve
  // long-lived offers while still rejecting values that cannot be represented
  // safely as a JavaScript integer.
  max_timeout_seconds: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict();

export const EcosystemQualitySchema = z.object({
  buyer_reach_30d: z.number().int().nonnegative().optional(),
  transaction_volume_30d: z.number().int().nonnegative().optional(),
  last_called_at: isoDate.optional(),
  metadata_completeness: z.number().min(0).max(1).optional(),
  provider_score: z.number().finite().optional(),
  trust_score: z.number().finite().optional(),
  source_grade: z.string().min(1).max(16).optional(),
}).strict();

export const EcosystemOperationalSchema = z.object({
  liveness: z.enum(["pass", "fail", "unknown"]).default("unknown"),
  payment: z.enum(["pass", "fail", "unknown"]).default("unknown"),
  invocation: z.enum(["pass", "fail", "unknown"]).default("unknown"),
  response_valid: z.boolean().nullable().default(null),
  safety: z.enum(["pass", "fail", "unknown"]).default("unknown"),
  latency_ms: z.number().nonnegative().optional(),
  checked_at: isoDate.optional(),
  failure_reason: z.string().max(1_000).optional(),
}).strict();

export const EcosystemSourceRecordSchema = z.object({
  source: EcosystemSourceSchema,
  source_url: z.string().url(),
  source_record_id: z.string().min(1).max(512),
  record_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  observed_at: isoDate,
  redistribution: z.enum(["unknown", "allowed", "derived_only", "prohibited"]),
}).strict();

export const EcosystemResourceSchema = z.object({
  resource_id: z.string().regex(/^eco-[a-f0-9]{16}$/),
  canonical_key: z.string().min(1).max(2_000),
  resource: z.string().url(),
  canonical_origin: z.string().min(1).max(512),
  transport: EcosystemTransportSchema,
  service_name: z.string().min(1).max(512).optional(),
  description: z.string().min(1).max(8_000).optional(),
  tags: z.array(z.string().min(1).max(128)).max(100),
  categories: z.array(z.string().min(1).max(128)).max(50),
  accepts: z.array(EcosystemPaymentOptionSchema).max(20),
  quality: EcosystemQualitySchema,
  operational: EcosystemOperationalSchema,
  status: z.enum(["active", "stale", "unreachable", "unsafe", "unknown"]),
  last_updated: isoDate.optional(),
  observed_at: isoDate,
  source_records: z.array(EcosystemSourceRecordSchema).min(1).max(50),
}).strict();

export const EcosystemFilterSchema = z.record(
  z.union([z.string().min(1).max(256), z.number().finite(), z.boolean(), z.array(z.string().min(1).max(256))]),
);

export const EcosystemQuerySchema = z.object({
  query_id: z.string().regex(/^eco-qry-\d{4}$/),
  split: z.enum(["development", "release", "temporal_holdout", "cold_start"]),
  query_class: z.enum([
    "capability", "structured", "semantic", "price", "trust", "operational",
    "adversarial", "no_result", "cold_start", "multilingual",
  ]),
  text: z.string().min(3).max(1_000),
  filters: EcosystemFilterSchema,
  expects_no_result: z.boolean(),
  provenance: z.object({
    kind: z.enum(["curated", "imported", "observed", "openrouter"]),
    generation_id: z.string().min(1).max(256),
  }).strict(),
}).strict();

export const EcosystemJudgmentSchema = z.object({
  query_id: z.string().regex(/^eco-qry-\d{4}$/),
  resource_id: z.string().regex(/^eco-[a-f0-9]{16}$/),
  relevance_grade: z.number().int().min(0).max(3),
  eligibility: z.enum(["eligible", "incompatible", "stale", "unsafe", "unreachable", "unknown"]),
  judge: z.enum(["human", "openrouter", "deterministic", "pending"]),
  provisional: z.boolean(),
  rationale: z.string().max(2_000).optional(),
  judged_at: isoDate.optional(),
}).strict().superRefine((value, context) => {
  if (value.eligibility !== "eligible" && value.relevance_grade > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "ineligible resources must have relevance grade 0" });
  }
  if (value.judge === "pending" && value.relevance_grade !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "pending judgments use placeholder grade 0" });
  }
});

export const EcosystemOutcomeSchema = z.object({
  query_id: z.string().regex(/^eco-qry-\d{4}$/),
  resource_id: z.string().regex(/^eco-[a-f0-9]{16}$/),
  selected: z.boolean(),
  attempted: z.boolean(),
  payment_verification: z.enum(["pass", "fail", "not_attempted", "unknown"]),
  settlement: z.enum(["pass", "fail", "not_attempted", "unknown"]),
  invocation: z.enum(["pass", "fail", "not_attempted", "unknown"]),
  response_valid: z.boolean().nullable(),
  task_success: z.boolean().nullable(),
  latency_ms: z.number().nonnegative().optional(),
  total_cost_usd: z.number().nonnegative().optional(),
  failure_reason: z.string().max(1_000).optional(),
  observed_at: isoDate,
}).strict().superRefine((value, context) => {
  if (value.selected && !value.attempted) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "selected resources must be attempted" });
  }
  if (value.task_success === true && (value.payment_verification !== "pass" || value.invocation !== "pass")) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "successful tasks require payment verification and invocation success" });
  }
});

export const EcosystemRecommendationRunSchema = z.object({
  query_id: z.string().regex(/^eco-qry-\d{4}$/),
  ranked_resource_ids: z.array(z.string().regex(/^eco-[a-f0-9]{16}$/)).max(100),
  latency_ms: z.number().nonnegative().optional(),
  selected_resource_id: z.string().regex(/^eco-[a-f0-9]{16}$/).optional(),
}).strict();

export const EcosystemManifestSchema = z.object({
  dataset_version: z.string().regex(/^v\d+\.\d+\.\d+$/),
  generated_at: isoDate,
  hashes: z.record(z.string().regex(/^[a-f0-9]{64}$/)),
  counts: z.object({
    resources: z.number().int().nonnegative(),
    queries: z.number().int().nonnegative(),
    judgments: z.number().int().nonnegative(),
    outcomes: z.number().int().nonnegative(),
  }).strict(),
  sources: z.array(EcosystemSourceSchema),
  source_errors: z.array(z.object({ source: EcosystemSourceSchema, error: z.string().min(1) }).strict()),
  redistribution: z.string().min(1).max(2_000),
  judging: z.object({
    rubric_version: z.string().min(1),
    model: z.string().min(1),
    pool_size: z.number().int().positive().max(100),
    expected_pairs: z.number().int().nonnegative(),
    persisted_pairs: z.number().int().nonnegative(),
    complete: z.boolean(),
    generated_at: isoDate,
  }).strict().optional(),
}).strict();

export type EcosystemSource = z.infer<typeof EcosystemSourceSchema>;
export type EcosystemResource = z.infer<typeof EcosystemResourceSchema>;
export type EcosystemQuery = z.infer<typeof EcosystemQuerySchema>;
export type EcosystemJudgment = z.infer<typeof EcosystemJudgmentSchema>;
export type EcosystemOutcome = z.infer<typeof EcosystemOutcomeSchema>;
export type EcosystemRecommendationRun = z.infer<typeof EcosystemRecommendationRunSchema>;
export type EcosystemManifest = z.infer<typeof EcosystemManifestSchema>;
