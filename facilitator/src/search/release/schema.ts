import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";

export const RELEASE_COUNTS = {
  resources: 300,
  queries: 100,
  qrels: 30_000,
  providers: 50,
  sources: { cdp: 150, generated_mcp: 60, adversarial: 45, sparse: 45 },
  splits: { development: 70, release: 30 },
} as const;

export const TESTNET_USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
export const PUBNET_USDC = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";

const stellarAccount = z.string().refine(value => StrKey.isValidEd25519PublicKey(value), "invalid Stellar G address");
const stellarContract = z.string().refine(value => StrKey.isValidContract(value), "invalid Stellar C address");
const jsonObject = z.record(z.unknown());

export const AcceptsSchema = z.object({
  scheme: z.literal("exact"),
  network: z.enum(["stellar:testnet", "stellar:pubnet"]),
  asset: stellarContract,
  amount: z.string().regex(/^\d+$/),
  payTo: stellarAccount,
  maxTimeoutSeconds: z.number().int().positive().max(3600),
  extra: z.object({ areFeesSponsored: z.boolean() }).strict(),
}).strict().superRefine((value, context) => {
  const expected = value.network === "stellar:testnet" ? TESTNET_USDC : PUBNET_USDC;
  if (value.asset !== expected) context.addIssue({ code: z.ZodIssueCode.custom, message: `asset must be configured USDC ${expected}` });
});

const resourceWire = z.object({
  url: z.string().url().refine(value => new URL(value).hostname.endsWith(".example"), "fixture URL must use reserved .example"),
  description: z.string().min(1).max(4_000).optional(),
  serviceName: z.string().min(1).max(32).optional(),
  tags: z.array(z.string().min(1).max(32)).max(5).optional(),
  mimeType: z.string().max(128).optional(),
}).strict();

export const WireSchema = z.object({
  x402Version: z.literal(2),
  resource: resourceWire,
  accepts: z.array(AcceptsSchema).length(1),
  extensions: z.object({ bazaar: jsonObject }).strict(),
}).strict();

export const CatalogRecordSchema = z.object({
  resource_id: z.string().regex(/^res-\d{3}$/),
  wire: WireSchema,
}).strict();

export const SidecarRecordSchema = z.object({
  resource_id: z.string().regex(/^res-\d{3}$/),
  source_class: z.enum(["cdp", "generated_mcp", "adversarial", "sparse"]),
  provider_id: z.string().regex(/^provider-\d{2}$/),
  derived_from: z.object({
    kind: z.enum(["cdp", "openrouter", "curated"]),
    source_url: z.string().url().optional(),
    source_resource_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    generation_id: z.string().optional(),
  }).strict(),
  category: z.string().min(1),
  is_live: z.boolean(),
  settlement_verified: z.literal(false),
  freshness: z.enum(["warm", "cold"]),
  source_last_updated: z.string().datetime().optional(),
  asset_decimals: z.literal(7),
  price_usd_snapshot: z.object({
    value: z.number().nonnegative(),
    as_of: z.string().datetime(),
    basis: z.literal("fixed_fixture_authoring_value"),
  }).strict(),
  adversarial: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.derived_from.kind === "cdp" && (!value.derived_from.source_url || !value.derived_from.source_resource_hash)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "CDP-derived records require source URL and source hash" });
  }
  if (value.derived_from.kind !== "cdp" && !value.derived_from.generation_id) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "generated/curated records require generation_id" });
  }
});

export const SupportedFiltersSchema = z.object({
  type: z.enum(["http", "mcp"]).optional(),
  network: z.enum(["stellar:testnet", "stellar:pubnet"]).optional(),
  scheme: z.literal("exact").optional(),
  payTo: stellarAccount.optional(),
  asset: stellarContract.optional(),
  extensions: z.string().min(1).optional(),
}).strict();

export const EvaluationConstraintsSchema = z.object({
  max_price_usd: z.number().nonnegative().optional(),
  category: z.string().min(1).optional(),
}).strict();

export const QueryRecordSchema = z.object({
  query_id: z.string().regex(/^qry-\d{3}$/),
  split: z.enum(["development", "release"]),
  query_class: z.enum(["capability", "structured", "semantic", "price_category", "adversarial", "no_result", "cold_start"]),
  query: z.string().min(3).max(512),
  filters: SupportedFiltersSchema.default({}),
  evaluation_constraints: EvaluationConstraintsSchema.default({}),
  expects_no_result: z.boolean(),
  derived_from: z.object({ kind: z.enum(["openrouter", "curated"]), generation_id: z.string() }).strict(),
}).strict();

export const QrelRecordSchema = z.object({
  query_id: z.string().regex(/^qry-\d{3}$/),
  resource_id: z.string().regex(/^res-\d{3}$/),
  grade: z.number().int().min(0).max(3),
  eligible: z.boolean(),
  hard_constraint_reason: z.string().optional(),
  judge: z.enum(["deterministic", "openrouter", "pending"]),
  provisional: z.boolean(),
  rationale: z.string().max(1_000).optional(),
}).strict().superRefine((value, context) => {
  if (!value.eligible && (value.grade !== 0 || value.judge !== "deterministic")) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "ineligible qrels must be deterministic grade 0" });
  }
  if (value.judge === "pending" && value.grade !== 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "pending qrels use a non-relevance placeholder grade of 0" });
  }
  if (value.eligible && value.judge === "deterministic") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "eligible qrels require OpenRouter judgment or an explicit pending state" });
  }
});

export const HumanCalibrationSchema = z.object({
  query_id: z.string(), resource_id: z.string(), agent_grade: z.number().int().min(0).max(3),
  human_grade: z.number().int().min(0).max(3).nullable(),
  human_reviewer: z.string().nullable(), reviewed_at: z.string().datetime().nullable(), notes: z.string().nullable(),
}).strict();

export const HumanReviewImportSchema = z.object({
  query_id: z.string().regex(/^qry-\d{3}$/), resource_id: z.string().regex(/^res-\d{3}$/),
  human_grade: z.number().int().min(0).max(3), human_reviewer: z.string().min(1),
  reviewed_at: z.string().datetime(), notes: z.string().nullable().default(null),
}).strict();

export type CatalogRecord = z.infer<typeof CatalogRecordSchema>;
export type SidecarRecord = z.infer<typeof SidecarRecordSchema>;
export type QueryRecord = z.infer<typeof QueryRecordSchema>;
export type QrelRecord = z.infer<typeof QrelRecordSchema>;
