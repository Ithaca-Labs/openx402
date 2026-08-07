/**
 * Stellar Bazaar Search Benchmark — v2 dataset schema.
 *
 * Standalone module. This file DOES NOT replace `src/search/release/schema.ts` in place;
 * the production v1 module stays untouched until the v2 dataset is authored and frozen.
 *
 * Authority: `handwritten-evals/BUILD-PLAN.md` §0 (schema), §3 (axes), §4 (distributions),
 * §5 (wire constraints), §6 (queries), §7 (grades), §8 (labeling), §11 (release gates).
 *
 * Core principle (BUILD-PLAN preamble): humans write meaning, machines write syntax.
 * Everything in this file is syntax. No relevance decision is encoded here.
 */

import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";

/* ------------------------------------------------------------------------------------------------
 * §0.4 — RELEASE_COUNTS v2
 * ---------------------------------------------------------------------------------------------- */

export const RELEASE_COUNTS = {
  /** MVP scope cut: 400 distractors (not the original 900) — see BUILD-PLAN sixth revision note. */
  resources: { labeled: 100, distractor: 400, total: 500 },
  resource_types: { http: 85, mcp: 15 },
  queries: { development: 50, release: 50, total: 100 },
  qrels: { estimated: 3_500, exhaustive: false }, // pooled, not cross-product
  providers: 120,
  // Orthogonal tags over the 100 labeled resources. These deliberately overlap
  // and do NOT sum to 100 — a resource may be both MCP and adversarial.
  labeled_tags: {
    adversarial: 15,
    sparse: 10,
    mcp: 15,
  },
} as const;

/**
 * §0.4: "Assert `labeled = 100` and `distractor = 900` independently."
 * Independent assertions — deliberately not derived from `total`, so a typo in one
 * cannot be masked by a compensating typo in the other.
 */
export function assertReleaseCounts(): void {
  const { labeled, distractor, total } = RELEASE_COUNTS.resources;
  if (labeled !== 100) throw new Error(`RELEASE_COUNTS.resources.labeled must be 100, got ${labeled}`);
  if (distractor !== 400) throw new Error(`RELEASE_COUNTS.resources.distractor must be 400, got ${distractor}`);
  if (total !== 500) throw new Error(`RELEASE_COUNTS.resources.total must be 500, got ${total}`);
  const { http, mcp } = RELEASE_COUNTS.resource_types;
  if (http + mcp !== labeled) throw new Error(`resource_types must partition the ${labeled} labeled resources`);
  const { development, release } = RELEASE_COUNTS.queries;
  if (development + release !== RELEASE_COUNTS.queries.total) throw new Error("query splits must sum to total");
  // labeled_tags are overlapping minimums, NEVER a partition: no sum assertion exists here
  // by design. Asserting a sum over them is the v1 `source_class` modelling error (§0.2b).
}

/** §4 — distribution targets over the 100 labeled resources. Gate inputs, not schema constraints. */
export const DISTRIBUTION_TARGETS = {
  /** §4 scheme table. `exact_only` + `exact_and_upto` + `upto_only` = 100. */
  scheme: { exact_only: 70, exact_and_upto: 22, upto_only: 8 },
  /** §4: the 30 resources carrying an `upto` option (22 + 8). */
  upto_bearing: 30,
  /** §4 adversarial: ~15 labeled resources, using at least this many distinct kinds. */
  adversarial: { resources: 15, min_distinct_kinds: 6 },
  /** §4 sparse: ~10 labeled resources with minimal metadata. */
  sparse: 10,
  /** §4: MCP spread across at least this many of the 20 families. */
  mcp_min_families: 8,
  /** §1/§4: keep the 900 distractors ~99% exact-only so the full corpus lands near 3% upto. */
  distractor_upto_max_fraction: 0.01,
} as const;

/** §6 — query class counts. Sums to 100. */
export const QUERY_CLASS_TARGETS = {
  capability: 30,
  structured: 14,
  semantic: 14,
  price_category: 9,
  mcp: 9,
  adversarial: 9,
  no_result: 10,
  cold_start: 5,
} as const;

/** §2 — 20 capability families, 5 labeled resources each. */
export const FAMILY_COUNT = 20;
export const RESOURCES_PER_FAMILY = 5;

/** §3 — every labeled resource must differ from its family siblings on at least two axes. */
export const MIN_AXIS_DIFFERENCES = 2;

/** §10 — relevance thresholds, pinned explicitly so no metric leaves its cutoff implicit. */
export const RELEVANCE_THRESHOLDS = {
  mrr: 2,
  recall_at_k: 2,
  bpref: 2,
  /** judged@k counts any explicit judgment, grade 0 through 3. */
  judged_at_k: "any_judgment",
} as const;

/** §10 — nDCG gain values `2^g - 1` for grades 0..3. Matches `src/search/evaluate.ts:52`. */
export const NDCG_GAINS = [0, 1, 3, 7] as const;

/* ------------------------------------------------------------------------------------------------
 * §5 — wire constants and primitives (unchanged from v1)
 * ---------------------------------------------------------------------------------------------- */

export const TESTNET_USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
export const PUBNET_USDC = "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75";

export const NETWORKS = ["stellar:testnet", "stellar:pubnet"] as const;
export const NetworkSchema = z.enum(NETWORKS);

/** §0.2 — scheme is now an enum on both the wire and the query filter. */
export const SCHEMES = ["exact", "upto"] as const;
export const SchemeSchema = z.enum(SCHEMES);

const stellarContract = z.string().refine(value => StrKey.isValidContract(value), "invalid Stellar C address");
const stellarAddress = z.string().refine(
  value => StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value),
  "invalid Stellar G or C address",
);
const jsonObject = z.record(z.unknown());

/* ------------------------------------------------------------------------------------------------
 * §0.1 — identifier widths
 * ---------------------------------------------------------------------------------------------- */

/** v1 `/^res-\d{3}$/` caps at res-999; the v2 corpus is 1,000 records. */
export const RESOURCE_ID_PATTERN = /^res-\d{4}$/;
/** v1 `/^provider-\d{2}$/` caps at 100 providers; v2 budgets 120. */
export const PROVIDER_ID_PATTERN = /^provider-\d{3}$/;
/** unchanged — 100 queries fits three digits. */
export const QUERY_ID_PATTERN = /^qry-\d{3}$/;

export const ResourceIdSchema = z.string().regex(RESOURCE_ID_PATTERN);
export const ProviderIdSchema = z.string().regex(PROVIDER_ID_PATTERN);
export const QueryIdSchema = z.string().regex(QUERY_ID_PATTERN);

/* ------------------------------------------------------------------------------------------------
 * §5 — wire schema
 * ---------------------------------------------------------------------------------------------- */

export const AcceptsSchema = z.object({
  scheme: SchemeSchema, // §0.2: was z.literal("exact")
  network: NetworkSchema,
  asset: stellarContract,
  amount: z.string().regex(/^\d+$/),
  payTo: stellarAddress,
  maxTimeoutSeconds: z.number().int().positive().max(3600),
  extra: z.object({ areFeesSponsored: z.boolean() }).strict(),
}).strict().superRefine((value, context) => {
  const expected = value.network === "stellar:testnet" ? TESTNET_USDC : PUBNET_USDC;
  if (value.asset !== expected) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `asset must be configured USDC ${expected}` });
  }
});

const resourceWire = z.object({
  url: z.string().url().refine(
    value => new URL(value).hostname.endsWith(".example"),
    "fixture URL must use reserved .example",
  ),
  description: z.string().min(1).max(4_000).optional(),
  serviceName: z.string().min(1).max(32).optional(),
  tags: z.array(z.string().min(1).max(32)).max(5).optional(),
  mimeType: z.string().max(128).optional(),
}).strict();

export const WireSchema = z.object({
  x402Version: z.literal(2),
  resource: resourceWire,
  accepts: z.array(AcceptsSchema).min(1).max(3),
  extensions: z.object({ bazaar: jsonObject }).strict(),
}).strict();

export const CatalogRecordSchema = z.object({
  resource_id: ResourceIdSchema,
  wire: WireSchema,
}).strict();

/* ------------------------------------------------------------------------------------------------
 * §3 — differentiation axes
 *
 * Recorded structurally so release gate "every labeled resource differs from family siblings on
 * >=2 axes" (§11) and the anti-correlation checks (§4) are decidable by script rather than by eye.
 * ---------------------------------------------------------------------------------------------- */

export const RESOURCE_TYPES = ["http", "mcp"] as const;
export const ResourceTypeSchema = z.enum(RESOURCE_TYPES);

/**
 * §3 lists GET/POST on the evidence of HTTP listings, but also makes `mcp` a first-class resource
 * type. An MCP tool call is neither verb, so v2 adds `not_applicable` rather than forcing a fake
 * one. MCP slots are excluded from the ~2:1 GET:POST ratio. See spec/axes.md "Conflicts".
 */
export const INPUT_METHODS = ["GET", "POST", "not_applicable"] as const;
export const INPUT_SHAPES = ["query_params", "json_body", "path", "tool_arguments"] as const;
export const OUTPUT_SHAPES = ["json", "text", "score", "list", "status"] as const;
export const COVERAGES = ["single_chain", "multi_chain", "regional", "global"] as const;
/** §3 axis "Freshness". NOTE: this REPLACES the v1 sidecar `warm`/`cold` enum — see README. */
export const FRESHNESS_VALUES = ["live", "hourly", "daily", "historical"] as const;
export const ATTESTATIONS = ["signed", "unsigned"] as const;
/** §3: "use these exact tiers". */
export const PRICE_TIERS = [0, 0.001, 0.002, 0.003, 0.005, 0.01, 0.02, 0.05, 0.1, 0.15] as const;
/** §4: scheme is per payment option; a resource falls in exactly one of these three groups. */
export const SCHEME_SETS = ["exact_only", "exact_and_upto", "upto_only"] as const;

export const PriceTierSchema = z.union([
  z.literal(0), z.literal(0.001), z.literal(0.002), z.literal(0.003), z.literal(0.005),
  z.literal(0.01), z.literal(0.02), z.literal(0.05), z.literal(0.1), z.literal(0.15),
]);

export const AxesSchema = z.object({
  /** Short, stable capability slug. The "specific thing it does" axis (§3 row 1). */
  capability: z.string().min(1).max(64),
  resource_type: ResourceTypeSchema,
  input_method: z.enum(INPUT_METHODS),
  input_shape: z.enum(INPUT_SHAPES),
  output_shape: z.enum(OUTPUT_SHAPES),
  coverage: z.enum(COVERAGES),
  freshness: z.enum(FRESHNESS_VALUES),
  price_tier: PriceTierSchema,
  /** Networks the resource offers payment on; derived from `accepts`. */
  networks: z.array(NetworkSchema).min(1).max(2),
  scheme_set: z.enum(SCHEME_SETS),
  attestation: z.enum(ATTESTATIONS),
}).strict();

/**
 * MCP-specific variation required by §4: tool tuple, schema shape, transport, tool count.
 * §6: the only two transports the official Bazaar extension permits. Local `stdio` tools are
 * not valid Bazaar transport declarations and must not appear here.
 */
export const MCP_TRANSPORTS = ["streamable-http", "sse"] as const;

export const McpAxesSchema = z.object({
  server_name: z.string().min(1).max(64),
  tool_name: z.string().min(1).max(64),
  transport: z.enum(MCP_TRANSPORTS),
  tool_count: z.number().int().min(1).max(32),
  /** Coarse input-schema shape, so "query by schema shape" MCP queries are decidable. */
  input_schema_shape: z.enum(["flat_scalars", "nested_object", "array_input", "enum_union", "no_input"]),
}).strict();

/* ------------------------------------------------------------------------------------------------
 * §0.2b — sidecar: `source_class` retired in favour of orthogonal fields
 * ---------------------------------------------------------------------------------------------- */

export const ADVERSARIAL_KINDS = [
  "prompt_injection",
  "keyword_stuffing",
  "false_free_claim",
  "misleading_tags",
  "unsupported_network_claim",
  "scheme_mismatch_claim",
  "duplicate_provider",
  "capability_spoof",
  "ranking_instruction",
] as const;

export const AdversarialKindSchema = z.enum(ADVERSARIAL_KINDS);

/**
 * §1.1 / §11 — exact model/run provenance for one generated artifact.
 * `temperature` and `generated_at` are the "temperature, timestamp" §1.1 requires alongside
 * provider, model, prompt hash, run ID, and shard ID.
 */
export const GenerationSchema = z.object({
  provider: z.literal("anthropic"),
  model: z.string().min(1), // exact model/revision, never a family name alone
  prompt_hash: z.string().min(1),
  run_id: z.string().min(1),
  shard_id: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  generated_at: z.string().datetime(),
}).strict();

/** Full provenance for a grading/adjudication context (§1.1, §11). */
export const GraderRefSchema = GenerationSchema;

/** §0.2b / §11 — owner acceptance state. No artifact ships without owner review. */
export const REVIEW_STATUSES = ["pending", "approved", "corrected", "rejected"] as const;
export const ReviewStatusSchema = z.enum(REVIEW_STATUSES);

export const SidecarRecordSchema = z.object({
  resource_id: ResourceIdSchema,

  // --- §0.2b orthogonal fields. There is no `source_class` and no `adversarial` boolean. ---
  /** Provenance of the *meaning*. v2 is authored by isolated fresh-context Claude subagents. */
  authorship: z.enum(["agent"]),
  /** Transport, NOT provenance. `generated_mcp` was never provenance (§0.2b). */
  resource_type: ResourceTypeSchema,
  /** Unlabeled corpus padding. Distractors are unjudged, not grade 0 (§0.3, §1). */
  is_distractor: z.boolean(),
  /** Minimal metadata: no description, no tags, terse serviceName (§4). */
  is_sparse: z.boolean(),
  /** `null` means not adversarial. This field replaces the v1 `adversarial` boolean entirely. */
  adversarial_kind: AdversarialKindSchema.nullable(),

  provider_id: ProviderIdSchema,
  /** §0.2b: exact model/run provenance for the isolated authoring agent that wrote this record. */
  generation: GenerationSchema,
  derived_from: z.object({
    kind: z.literal("agent_generated"), // §5: was "curated" — v2 is agent-authored end to end
    generation_id: z.string().min(1),
    /** §6 rule 2 / §5: real provenance — family, use case, trap. Never a placeholder. */
    rationale: z.string().min(1).max(2_000),
  }).strict(),
  /** §0.2b / §11 — owner acceptance state; the release gate requires every artifact reviewed. */
  review_status: ReviewStatusSchema,
  reviewed_at: z.string().datetime().nullable().default(null),
  /** §1.1: owner corrections are append-only provenance, never an overwrite of agent output. */
  owner_note: z.string().min(1).max(2_000).nullable().default(null),

  /** §2 family index, 1..20, and the 1..5 slot within it. Null for distractors. */
  family: z.number().int().min(1).max(FAMILY_COUNT).nullable(),
  family_slot: z.number().int().min(1).max(RESOURCES_PER_FAMILY).nullable(),
  category: z.string().min(1),

  is_live: z.literal(false),
  settlement_verified: z.literal(false),
  source_last_updated: z.string().datetime().optional(),

  asset_decimals: z.literal(7),
  price_usd_snapshot: z.object({
    value: z.number().nonnegative(),
    as_of: z.string().datetime(),
    basis: z.literal("fixed_fixture_minimum_option_value"),
  }).strict(),

  /** §3 axis assignment. Required on labeled resources; omitted on distractors. */
  axes: AxesSchema.optional(),
  /** §4 MCP variation. Required when `resource_type === "mcp"` and the record is labeled. */
  mcp: McpAxesSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.review_status !== "pending" && !value.reviewed_at) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reviewed_at"],
      message: "approved/corrected/rejected records must record when the owner reviewed them",
    });
  }
  if ((value.review_status === "corrected" || value.review_status === "rejected") && !value.owner_note) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["owner_note"],
      message: "corrections and rejections must record the owner's reason (§1.1 append-only provenance)",
    });
  }
  const labeled = !value.is_distractor;

  if (labeled && !value.axes) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["axes"],
      message: "labeled resources require a §3 axis assignment",
    });
  }
  if (labeled && (value.family === null || value.family_slot === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["family"],
      message: "labeled resources belong to exactly one §2 family slot",
    });
  }
  if (!labeled && (value.family !== null || value.family_slot !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["family"],
      message: "distractors are unlabeled: family and family_slot must be null",
    });
  }
  if (!labeled && value.axes) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["axes"],
      message: "distractors must omit labeled-resource axis assignments",
    });
  }
  if (!labeled && value.mcp) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["mcp"],
      message: "distractors must omit labeled-resource MCP axis assignments",
    });
  }
  if (value.axes && value.axes.resource_type !== value.resource_type) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["axes", "resource_type"],
      message: "axes.resource_type must match the sidecar resource_type",
    });
  }
  if (value.axes) {
    const mcpOnlyMethod = value.axes.input_method === "not_applicable";
    const mcpOnlyShape = value.axes.input_shape === "tool_arguments";
    if (value.resource_type === "mcp" && !(mcpOnlyMethod && mcpOnlyShape)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["axes", "input_method"],
        message: "MCP resources use input_method 'not_applicable' and input_shape 'tool_arguments'",
      });
    }
    if (value.resource_type === "http" && (mcpOnlyMethod || mcpOnlyShape)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["axes", "input_method"],
        message: "HTTP resources take a real verb (GET/POST) and a wire input shape",
      });
    }
  }
  if (labeled && value.resource_type === "mcp" && !value.mcp) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["mcp"],
      message: "labeled MCP resources require MCP-specific axis values (§4)",
    });
  }
  if (value.resource_type === "http" && value.mcp) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["mcp"],
      message: "HTTP resources must not carry MCP axis values",
    });
  }
  // §7 grade-0 traps are planted among labeled resources; an unjudged distractor cannot be one.
  if (value.is_distractor && value.adversarial_kind !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["adversarial_kind"],
      message: "adversarial resources are labeled planted negatives, never distractors",
    });
  }
});

/**
 * Cross-checks the sidecar against its wire record. Syntax only.
 * Keeps `axes` honest: the axis values must be observable in the wire JSON, not merely asserted.
 */
export function checkSidecarAgainstWire(
  sidecar: z.infer<typeof SidecarRecordSchema>,
  wire: z.infer<typeof WireSchema>,
): string[] {
  const errors: string[] = [];
  const schemes = new Set(wire.accepts.map(a => a.scheme));
  const expectedSet: (typeof SCHEME_SETS)[number] = schemes.has("upto")
    ? (schemes.has("exact") ? "exact_and_upto" : "upto_only")
    : "exact_only";
  if (sidecar.axes && sidecar.axes.scheme_set !== expectedSet) {
    errors.push(`${sidecar.resource_id}: axes.scheme_set=${sidecar.axes.scheme_set} but accepts imply ${expectedSet}`);
  }

  const networks = [...new Set(wire.accepts.map(a => a.network))].sort();
  if (sidecar.axes) {
    const declared = [...sidecar.axes.networks].sort();
    if (declared.join(",") !== networks.join(",")) {
      errors.push(`${sidecar.resource_id}: axes.networks=[${declared}] but accepts imply [${networks}]`);
    }
  }

  const minAmount = Math.min(...wire.accepts.map(a => Number(a.amount))) / 10 ** 7;
  if (Math.abs(minAmount - sidecar.price_usd_snapshot.value) > 1e-9) {
    errors.push(
      `${sidecar.resource_id}: price_usd_snapshot.value=${sidecar.price_usd_snapshot.value} ` +
      `but minimum accepts option is ${minAmount} (basis is fixed_fixture_minimum_option_value)`,
    );
  }
  if (sidecar.axes && Math.abs(sidecar.axes.price_tier - sidecar.price_usd_snapshot.value) > 1e-9) {
    errors.push(`${sidecar.resource_id}: axes.price_tier does not match price_usd_snapshot.value`);
  }

  if (sidecar.is_sparse) {
    if (wire.resource.description !== undefined) {
      errors.push(`${sidecar.resource_id}: sparse resources carry no description (§4)`);
    }
    if (wire.resource.tags !== undefined && wire.resource.tags.length > 0) {
      errors.push(`${sidecar.resource_id}: sparse resources carry no tags (§4)`);
    }
  }
  return errors;
}

/**
 * §3 / §11 — "Every labeled resource differs from family siblings on >=2 axes."
 * Returns the axis names on which two labeled resources differ.
 */
export function axisDifferences(
  a: z.infer<typeof AxesSchema>,
  b: z.infer<typeof AxesSchema>,
): string[] {
  const keys = Object.keys(a) as (keyof z.infer<typeof AxesSchema>)[];
  return keys.filter(key => {
    const left = a[key];
    const right = b[key];
    if (Array.isArray(left) && Array.isArray(right)) {
      return [...left].sort().join(",") !== [...right].sort().join(",");
    }
    return left !== right;
  }) as string[];
}

/* ------------------------------------------------------------------------------------------------
 * §6 — queries
 * ---------------------------------------------------------------------------------------------- */

export const QUERY_CLASSES = [
  "capability",
  "structured",
  "semantic",
  "price_category",
  "adversarial",
  "no_result",
  "cold_start",
  "mcp", // §0.2 addition
] as const;

export const SupportedFiltersSchema = z.object({
  type: ResourceTypeSchema.optional(),
  network: NetworkSchema.optional(),
  scheme: SchemeSchema.optional(), // §0.2: was z.literal("exact")
  payTo: stellarAddress.optional(),
  asset: stellarContract.optional(),
  extensions: z.string().min(1).optional(),
}).strict();

/**
 * §7 — filters are WHERE clauses, asserted in code, never graded.
 * `source_class` is gone (§0.2b); the orthogonal replacements that a query may constrain on are
 * exposed here individually.
 */
export const EvaluationConstraintsSchema = z.object({
  max_price_usd: z.number().nonnegative().optional(),
  category: z.string().min(1).optional(),
  freshness: z.enum(FRESHNESS_VALUES).optional(),
  resource_type: ResourceTypeSchema.optional(),
}).strict();

/** §6 MCP sub-types. §11 requires all four to be covered. */
export const MCP_QUERY_SUBTYPES = ["tuple_identity", "tool_schema", "transport", "http_vs_mcp"] as const;

/** §6 rule 4 — vary phrasing register. */
export const PHRASING_REGISTERS = ["terse_agent", "verbose_natural", "keyword_only"] as const;

export const QueryRecordSchema = z.object({
  query_id: QueryIdSchema,
  split: z.enum(["development", "release"]),
  query_class: z.enum(QUERY_CLASSES),
  query: z.string().min(3).max(512),
  filters: SupportedFiltersSchema.default({}),
  evaluation_constraints: EvaluationConstraintsSchema.default({}),
  expects_no_result: z.boolean(),
  phrasing_register: z.enum(PHRASING_REGISTERS),
  /** Required on `query_class: "mcp"`; forbidden elsewhere. */
  mcp_subtype: z.enum(MCP_QUERY_SUBTYPES).optional(),
  /** §6: the family the buyer use case sits in. Null for no_result queries by construction. */
  family: z.number().int().min(1).max(FAMILY_COUNT).nullable(),
  /**
   * §6 no-result: the capability that must be absent from all 1,000 records.
   * Mirrored into `forbidden-capabilities.md` and checked by the exclusion scanner.
   */
  forbidden_capability: z.string().min(1).max(200).optional(),
  /** §11: every generated artifact, queries included, records exact model/run provenance. */
  generation: GenerationSchema,
  derived_from: z.object({
    kind: z.literal("agent_generated"), // was "curated" — see SidecarRecordSchema
    generation_id: z.string().min(1),
    /** §6 rule 2 — real provenance: family, use case, trap. A placeholder here is a defect. */
    use_case: z.string().min(1).max(1_000),
    trap: z.string().min(1).max(1_000).optional(),
  }).strict(),
  /** §11: owner reviews and accepts every query before release, same as resources. */
  review_status: ReviewStatusSchema,
  reviewed_at: z.string().datetime().nullable().default(null),
  owner_note: z.string().min(1).max(2_000).nullable().default(null),
}).strict().superRefine((value, context) => {
  if (value.review_status !== "pending" && !value.reviewed_at) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reviewed_at"],
      message: "approved/corrected/rejected queries must record when the owner reviewed them",
    });
  }
  if ((value.review_status === "corrected" || value.review_status === "rejected") && !value.owner_note) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["owner_note"],
      message: "corrections and rejections must record the owner's reason (§1.1 append-only provenance)",
    });
  }
  if (value.query_class === "mcp" && !value.mcp_subtype) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["mcp_subtype"],
      message: "mcp queries must declare one of the four §6 sub-types",
    });
  }
  if (value.query_class !== "mcp" && value.mcp_subtype) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["mcp_subtype"],
      message: "mcp_subtype is only meaningful on query_class 'mcp'",
    });
  }
  if (value.query_class === "no_result" && !value.expects_no_result) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expects_no_result"],
      message: "no_result queries must set expects_no_result",
    });
  }
  if (value.expects_no_result && !value.forbidden_capability) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["forbidden_capability"],
      message: "§6: every no_result query names the capability excluded from the whole corpus",
    });
  }
  if (value.expects_no_result && value.family !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["family"],
      message: "no_result queries have no answering family",
    });
  }
  if (value.query_class === "price_category" && value.evaluation_constraints.max_price_usd === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evaluation_constraints", "max_price_usd"],
      message: "price_category queries exercise evaluation_constraints.max_price_usd (§6)",
    });
  }
  if (value.query_class === "structured" && Object.keys(value.filters).length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["filters"],
      message: "structured queries exercise at least one supported filter (§6)",
    });
  }
});

/* ------------------------------------------------------------------------------------------------
 * §0.3 — qrels: unjudged is not grade 0
 * ---------------------------------------------------------------------------------------------- */

/**
 * `qrels-v2.jsonl` contains ONLY judged pairs.
 *
 * - grade 0 here means "an isolated fresh-context grading agent inspected this pair and
 *   determined it irrelevant" (§7), not "nobody looked."
 * - ABSENCE of a (query_id, resource_id) pair means UNJUDGED — a distinct state that contributes
 *   0 to DCG but is counted and reported separately via `judged@k` (§10).
 * - There is no `pending` judge and no `provisional` flag: both encoded "unjudged" inside the
 *   qrels file, which is exactly the v1 conflation this schema removes.
 * - `judge: "agent"` is a raw isolated-grader grade (§8 pass 1/2). `judge: "reviewed_agent"` is
 *   one the owner has reviewed, adjudicated, or corrected (§8 pass 3) — release qrels are this.
 */
export const QrelRecordSchema = z.object({
  query_id: QueryIdSchema,
  resource_id: ResourceIdSchema,
  grade: z.number().int().min(0).max(3),
  /** false = deterministic hard-filter exclusion (network/scheme/type/asset/price), §7. */
  eligible: z.boolean(),
  hard_constraint_reason: z.string().min(1).max(200).optional(),
  judge: z.enum(["deterministic", "agent", "reviewed_agent"]), // human/openrouter/curated/pending retired (§0.2)
  /** §8: required on release judgments. Enforced by the release gate, which knows the split. */
  rationale: z.string().max(1_000).optional(),
  /** Isolated grader/adjudicator run_id; owner identity is recorded separately in `reviewed_by`. */
  annotator: z.string().min(1).optional(),
  judged_at: z.string().datetime().optional(),
  /** Original isolated grader/adjudicator provenance. Null only for deterministic exclusions. */
  generation: GraderRefSchema.nullable(),
  /** Explicit owner acceptance; never infer this from `judge`. */
  review_status: ReviewStatusSchema,
  reviewed_at: z.string().datetime().nullable(),
  reviewed_by: z.string().min(1).nullable(),
  owner_note: z.string().min(1).max(2_000).nullable(),
}).strict().superRefine((value, context) => {
  // §0.3: `eligible: false` still means a deterministic hard-filter exclusion at grade 0.
  if (!value.eligible && (value.grade !== 0 || value.judge !== "deterministic")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "ineligible qrels must be deterministic grade 0",
    });
  }
  if (!value.eligible && !value.hard_constraint_reason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["hard_constraint_reason"],
      message: "ineligible qrels must name the filter that excluded the resource",
    });
  }
  // §0.3: the v1 "eligible requires OpenRouter judgment" rule is replaced by this.
  if (value.eligible && value.judge !== "agent" && value.judge !== "reviewed_agent") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["judge"],
      message: "eligible qrels require an agent or reviewed_agent judgment",
    });
  }
  if (value.eligible && value.judge !== "deterministic" && !value.annotator) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["annotator"],
      message: "agent/reviewed_agent judgments must record who made them",
    });
  }
  if (value.judge !== "deterministic" && value.generation === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["generation"],
      message: "agent/reviewed_agent judgments require full isolated-run provenance",
    });
  }
  if (value.judge === "deterministic" && value.generation !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["generation"],
      message: "deterministic exclusions do not carry agent generation provenance",
    });
  }
  if (value.generation && value.annotator !== value.generation.run_id) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["annotator"],
      message: "annotator must equal generation.run_id",
    });
  }
  if (value.judge === "agent" && value.review_status !== "pending") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["review_status"],
      message: "raw agent qrels remain pending until the owner-review phase",
    });
  }
  if (value.judge === "reviewed_agent"
      && value.review_status !== "approved" && value.review_status !== "corrected") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["review_status"],
      message: "reviewed_agent qrels must be owner-approved or corrected",
    });
  }
  if (value.review_status !== "pending" && (!value.reviewed_at || !value.reviewed_by)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reviewed_at"],
      message: "owner-reviewed qrels require reviewed_at and reviewed_by",
    });
  }
  if (value.review_status === "pending" && (value.reviewed_at !== null || value.reviewed_by !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reviewed_at"],
      message: "pending qrels cannot claim owner review",
    });
  }
  if ((value.review_status === "corrected" || value.review_status === "rejected") && !value.owner_note) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["owner_note"],
      message: "corrected/rejected qrels require an append-only owner note",
    });
  }
});

/**
 * §8/§10 (ninth revision) — pool construction and system scoring are separate roles.
 *
 * `POOL_BUILD_SYSTEMS`: the three exact, non-production methods that build `pool-v2.jsonl`.
 * Production systems are never pool contributors — building the pool from approximate HNSW risks a
 * resource ANN misses never entering the pool at all, a gap invisible to `judged@k`. `bm25` is exact
 * by construction (no ANN involved), so it belongs in both lists.
 */
export const POOL_BUILD_SYSTEMS = ["bm25", "exact_dense", "hybrid_exact"] as const;

/**
 * `SCORED_SYSTEMS`: what the final report scores against the qrels the pool produces. Production
 * `lexical`/`semantic`/`hybrid` plus `bm25` in its comparability-baseline role. `reranked` is out of
 * MVP scope (ninth revision) — needs a configured, healthy reranker provider to stand up.
 */
export const SCORED_SYSTEMS = ["lexical", "semantic", "hybrid", "bm25"] as const;

/**
 * Every distinct system that produces a run file — the union of `POOL_BUILD_SYSTEMS` and
 * `SCORED_SYSTEMS` (`bm25` counted once). Used wherever code has to handle "any system with a run
 * file" generically: loading run files, and the pool-freshness snapshot, which must bind *all* run
 * files (pool-building and scored) since a stale production run makes the final report stale even
 * when the pool itself is still fresh.
 */
export const ALL_RUN_SYSTEMS = ["bm25", "exact_dense", "hybrid_exact", "lexical", "semantic", "hybrid"] as const;

/**
 * §0.3 — `pool-v2.jsonl`: exactly which pairs entered the pool, and from which systems.
 * Everything pooled must be judged; this file is the completeness audit trail.
 */
export const POOL_ORIGINS = [
  /** §8 pass 2 — union of the top-k of the three pool-building methods. */
  "system_pool",
  /** §8 pass 1 — named during authoring from corpus knowledge. */
  "authoring_pass1",
  /** §8 pass 2b — topically related but unpooled, sampled to test the unjudged assumption. */
  "unpooled_audit",
] as const;

export const PoolRecordSchema = z.object({
  query_id: QueryIdSchema,
  resource_id: ResourceIdSchema,
  origin: z.enum(POOL_ORIGINS),
  /** Which systems returned this pair, and at what rank. Empty only for non-system origins. */
  contributions: z.array(z.object({
    system: z.enum(POOL_BUILD_SYSTEMS),
    rank: z.number().int().min(1),
  }).strict()),
  /** Best rank across contributing systems; null when no system returned it. */
  best_rank: z.number().int().min(1).nullable(),
  /** Pool depth used for this run (§8: top-20 from each system). */
  pool_depth: z.number().int().min(1),
  /** §8 step 3 — grading must be blind: profile attribution stripped and candidates shuffled. */
  blinded: z.literal(true),
  pooled_at: z.string().datetime(),
  run_id: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (value.origin === "system_pool" && value.contributions.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contributions"],
      message: "system_pool entries must record at least one contributing system",
    });
  }
  if (value.origin !== "system_pool" && value.contributions.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contributions"],
      message: "only system_pool entries carry system contributions",
    });
  }
  const ranks = value.contributions.map(c => c.rank);
  const expectedBest = ranks.length > 0 ? Math.min(...ranks) : null;
  if (value.best_rank !== expectedBest) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["best_rank"],
      message: `best_rank must be the minimum contributing rank (${expectedBest})`,
    });
  }
  if (ranks.some(rank => rank > value.pool_depth)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contributions"],
      message: "a contribution ranked deeper than pool_depth cannot be in the pool",
    });
  }
  const systems = value.contributions.map(c => c.system);
  if (new Set(systems).size !== systems.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["contributions"],
      message: "one contribution per system",
    });
  }
});

/**
 * §0.3 — "Everything pooled must be judged."
 * Returns pooled pairs that have no qrel entry. A non-empty result blocks the release gate.
 */
export function unjudgedPooledPairs(
  pool: readonly z.infer<typeof PoolRecordSchema>[],
  qrels: readonly z.infer<typeof QrelRecordSchema>[],
): string[] {
  const judged = new Set(qrels.map(q => `${q.query_id}\u0000${q.resource_id}`));
  return pool
    .map(p => `${p.query_id}\u0000${p.resource_id}`)
    .filter(key => !judged.has(key))
    .map(key => key.replace("\u0000", "/"));
}

/* ------------------------------------------------------------------------------------------------
 * §0.5 — calibration
 * ---------------------------------------------------------------------------------------------- */

/**
 * §0.5 — calibration is isolated-grader vs isolated-grader, never human ground truth.
 * Agreement measures consistency between fresh-context agents; it is not presented as human
 * inter-annotator agreement or proof of ground-truth validity (§1.1, §8 pass 3).
 * `boundary_case` marks the 2-vs-3 region where the benchmark lives (§7).
 */
export const AgentCalibrationSchema = z.object({
  query_id: QueryIdSchema,
  resource_id: ResourceIdSchema,
  grader_a_grade: z.number().int().min(0).max(3),
  grader_b_grade: z.number().int().min(0).max(3).nullable(),
  adjudicated_grade: z.number().int().min(0).max(3).nullable(),
  grader_a: GraderRefSchema,
  grader_b: GraderRefSchema.nullable(),
  adjudicator: GraderRefSchema.nullable(),
  /** §8 pass 3 / §11 — the owner reviews, approves, corrects, or rejects every calibration row. */
  owner_review: ReviewStatusSchema,
  reviewed_at: z.string().datetime().nullable(),
  /** true when either grade is 2 or 3 (§0.5). */
  boundary_case: z.boolean(),
  notes: z.string().nullable(),
}).strict().superRefine((value, context) => {
  const grades = [value.grader_a_grade, value.grader_b_grade].filter(
    (grade): grade is number => grade !== null,
  );
  const expected = grades.some(grade => grade === 2 || grade === 3);
  if (value.boundary_case !== expected) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["boundary_case"],
      message: `boundary_case must be ${expected}: true iff either grade is 2 or 3`,
    });
  }
  if (value.grader_b === null && value.grader_b_grade !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["grader_b"],
      message: "grader_b_grade requires a named grader_b",
    });
  }
  if (value.grader_b !== null && value.grader_b_grade === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["grader_b_grade"],
      message: "a named grader_b requires grader_b_grade",
    });
  }
  if (value.grader_b && value.grader_b.run_id === value.grader_a.run_id) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["grader_b", "run_id"],
      message: "grader_a and grader_b must be distinct isolated runs",
    });
  }
  const disagreement = value.grader_b_grade !== null && value.grader_b_grade !== value.grader_a_grade;
  if (disagreement && value.adjudicated_grade === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["adjudicated_grade"],
      message: "§8 pass 3: disagreements must be adjudicated and the resolution recorded",
    });
  }
  if (disagreement && value.adjudicator === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["adjudicator"],
      message: "§8 pass 3: a disagreement resolved without a recorded adjudicator is not traceable",
    });
  }
  if (value.adjudicator && [value.grader_a.run_id, value.grader_b?.run_id].includes(value.adjudicator.run_id)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["adjudicator", "run_id"],
      message: "adjudicator must be a third distinct isolated run",
    });
  }
  if (!disagreement && (value.adjudicated_grade !== null || value.adjudicator !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["adjudicated_grade"],
      message: "agreement rows must not invent an adjudication",
    });
  }
  if (value.owner_review !== "pending" && value.reviewed_at === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reviewed_at"],
      message: "approved/corrected/rejected calibration rows must record when the owner reviewed them",
    });
  }
  if ((value.owner_review === "corrected" || value.owner_review === "rejected") && value.notes === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["notes"],
      message: "corrected/rejected calibration rows require owner notes",
    });
  }
});

/** §1.1: the owner's final acceptance pass over a grade, imported as an append-only record. */
export const OwnerReviewImportSchema = z.object({
  query_id: QueryIdSchema,
  resource_id: ResourceIdSchema,
  grade: z.number().int().min(0).max(3),
  reviewer: z.string().min(1),
  reviewed_at: z.string().datetime(),
  rationale: z.string().max(1_000).nullable().default(null),
  notes: z.string().nullable().default(null),
}).strict();

/* ------------------------------------------------------------------------------------------------
 * Types
 * ---------------------------------------------------------------------------------------------- */

export type Network = (typeof NETWORKS)[number];
export type Scheme = (typeof SCHEMES)[number];
export type ResourceType = (typeof RESOURCE_TYPES)[number];
export type AdversarialKind = (typeof ADVERSARIAL_KINDS)[number];
export type QueryClass = (typeof QUERY_CLASSES)[number];
export type PoolBuildSystem = (typeof POOL_BUILD_SYSTEMS)[number];
export type ScoredSystem = (typeof SCORED_SYSTEMS)[number];
export type RunSystem = (typeof ALL_RUN_SYSTEMS)[number];
export type PriceTier = (typeof PRICE_TIERS)[number];
export type SchemeSet = (typeof SCHEME_SETS)[number];

export type Wire = z.infer<typeof WireSchema>;
export type Axes = z.infer<typeof AxesSchema>;
export type McpAxes = z.infer<typeof McpAxesSchema>;
export type CatalogRecord = z.infer<typeof CatalogRecordSchema>;
export type SidecarRecord = z.infer<typeof SidecarRecordSchema>;
export type QueryRecord = z.infer<typeof QueryRecordSchema>;
export type QrelRecord = z.infer<typeof QrelRecordSchema>;
export type PoolRecord = z.infer<typeof PoolRecordSchema>;
export type Generation = z.infer<typeof GenerationSchema>;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export type GraderRef = z.infer<typeof GraderRefSchema>;
export type AgentCalibrationRecord = z.infer<typeof AgentCalibrationSchema>;
export type OwnerReviewImport = z.infer<typeof OwnerReviewImportSchema>;
