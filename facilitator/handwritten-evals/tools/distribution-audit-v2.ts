/**
 * Deterministic BUILD-PLAN §4/§11 anti-correlation audit over the shipped v2 corpus.
 *
 * The plan defines the distribution control as a checklist, not a statistical claim. This module
 * implements every checkable item from `spec/axes.md`, then adds a conservative Cramér's V guard
 * for the release-gate wording "no correlation with family, price tier, or method". MCP versus
 * input method is intentionally not tested: the schema defines every MCP method as
 * `not_applicable`, so that pair is structurally identical rather than an authoring correlation.
 *
 * No file I/O. Callers supply raw records and an explicit timestamp; identical inputs produce an
 * identical report.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import {
  CatalogRecordSchema,
  checkSidecarAgainstWire,
  DISTRIBUTION_TARGETS,
  FAMILY_COUNT,
  PRICE_TIERS,
  RELEASE_COUNTS,
  RESOURCES_PER_FAMILY,
  SidecarRecordSchema,
  type CatalogRecord,
  type SidecarRecord,
} from "../schema/schema-v2.js";

export const DISTRIBUTION_AUDIT_POLICY = {
  labeled_scope: RELEASE_COUNTS.resources.labeled,
  distractor_scope: RELEASE_COUNTS.resources.distractor,
  network_max_absolute_drift: 0.15,
  mcp_upto_share_max_absolute_drift: 0.05,
  association_max_cramers_v: 0.30,
  upto_min_price_tiers: 8,
  mcp_min_price_tiers: 8,
  adversarial_min_price_tiers: 6,
  sparse_min_price_tiers: 5,
  small_tag_max_per_price_tier: 2,
  upto_max_price_tier_share: 0.20,
  max_family_slot_share: 0.40,
  mcp_method_treatment: "structurally_not_testable" as const,
} as const;

export const DISTRIBUTION_CHECK_IDS = [
  "corpus-counts",
  "catalog-sidecar-wire",
  "distractor-scheme-budget",
  "distractor-resource-type-target",
  "resource-type-target",
  "scheme-target",
  "adversarial-target",
  "sparse-target",
  "upto-family-spread",
  "upto-price-spread",
  "upto-http-method-spread",
  "upto-resource-type-spread",
  "mcp-upto-share",
  "mcp-family-spread",
  "mcp-price-spread",
  "adversarial-price-spread",
  "sparse-price-spread",
  "mcp-network-drift",
  "upto-network-drift",
  "adversarial-network-drift",
  "sparse-network-drift",
  "mcp-price-concentration",
  "adversarial-price-concentration",
  "sparse-price-concentration",
  "upto-price-concentration",
  "mcp-slot-concentration",
  "upto-slot-concentration",
  "adversarial-slot-concentration",
  "sparse-slot-concentration",
] as const;

export const ASSOCIATION_IDS = [
  "upto-family",
  "upto-price-tier",
  "upto-input-method",
  "mcp-family",
  "mcp-price-tier",
  "network-family",
  "network-price-tier",
  "network-input-method",
] as const;

const NetworkMixSchema = z.object({
  testnet_only: z.number().int().nonnegative(),
  pubnet_only: z.number().int().nonnegative(),
  both: z.number().int().nonnegative(),
}).strict();

const GroupStatisticsSchema = z.object({
  count: z.number().int().nonnegative(),
  distinct_families: z.number().int().min(0).max(FAMILY_COUNT),
  distinct_price_tiers: z.number().int().min(0).max(PRICE_TIERS.length),
  input_methods: z.array(z.enum(["GET", "POST", "not_applicable"])),
  resource_types: z.array(z.enum(["http", "mcp"])),
  max_price_tier_count: z.number().int().nonnegative(),
  max_price_tier_share: z.number().min(0).max(1),
  max_family_slot_count: z.number().int().nonnegative(),
  max_family_slot_share: z.number().min(0).max(1),
  network_mix: NetworkMixSchema,
  network_max_absolute_drift: z.number().min(0).max(1),
}).strict();

export const DistributionCheckSchema = z.object({
  id: z.enum(DISTRIBUTION_CHECK_IDS),
  requirement: z.string().min(1),
  passed: z.boolean(),
  observed: z.string().min(1),
}).strict();

export const DistributionAssociationSchema = z.object({
  id: z.enum(ASSOCIATION_IDS),
  left: z.enum(["upto", "mcp", "network"]),
  right: z.enum(["family", "price_tier", "input_method"]),
  sample_size: z.number().int().nonnegative(),
  cramers_v: z.number().min(0).max(1).nullable(),
  maximum_allowed: z.literal(DISTRIBUTION_AUDIT_POLICY.association_max_cramers_v),
  passed: z.boolean(),
}).strict().superRefine((value, context) => {
  const expected = value.cramers_v !== null && value.cramers_v <= value.maximum_allowed;
  if (value.passed !== expected) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["passed"], message: `must equal ${expected}` });
  }
});

const PolicySchema = z.object({
  labeled_scope: z.literal(DISTRIBUTION_AUDIT_POLICY.labeled_scope),
  distractor_scope: z.literal(DISTRIBUTION_AUDIT_POLICY.distractor_scope),
  network_max_absolute_drift: z.literal(DISTRIBUTION_AUDIT_POLICY.network_max_absolute_drift),
  mcp_upto_share_max_absolute_drift: z.literal(DISTRIBUTION_AUDIT_POLICY.mcp_upto_share_max_absolute_drift),
  association_max_cramers_v: z.literal(DISTRIBUTION_AUDIT_POLICY.association_max_cramers_v),
  upto_min_price_tiers: z.literal(DISTRIBUTION_AUDIT_POLICY.upto_min_price_tiers),
  mcp_min_price_tiers: z.literal(DISTRIBUTION_AUDIT_POLICY.mcp_min_price_tiers),
  adversarial_min_price_tiers: z.literal(DISTRIBUTION_AUDIT_POLICY.adversarial_min_price_tiers),
  sparse_min_price_tiers: z.literal(DISTRIBUTION_AUDIT_POLICY.sparse_min_price_tiers),
  small_tag_max_per_price_tier: z.literal(DISTRIBUTION_AUDIT_POLICY.small_tag_max_per_price_tier),
  upto_max_price_tier_share: z.literal(DISTRIBUTION_AUDIT_POLICY.upto_max_price_tier_share),
  max_family_slot_share: z.literal(DISTRIBUTION_AUDIT_POLICY.max_family_slot_share),
  mcp_method_treatment: z.literal(DISTRIBUTION_AUDIT_POLICY.mcp_method_treatment),
}).strict();

export const DistributionAuditV2Schema = z.object({
  version: z.literal(1),
  artifact: z.literal("distribution-audit-v2"),
  status: z.enum(["pass", "blocked"]),
  generated_at: z.string().datetime(),
  source_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  scope: z.literal("100_labeled_resource_core_with_full_corpus_integrity_check"),
  policy: PolicySchema,
  counts: z.object({
    catalog: z.number().int().nonnegative(),
    sidecars: z.number().int().nonnegative(),
    labeled: z.number().int().nonnegative(),
    distractors: z.number().int().nonnegative(),
    distractor_upto_bearing: z.number().int().nonnegative(),
  }).strict(),
  wire_error_count: z.number().int().nonnegative(),
  statistics: z.object({
    resource_types: z.object({ http: z.number().int().nonnegative(), mcp: z.number().int().nonnegative() }).strict(),
    scheme_sets: z.object({
      exact_only: z.number().int().nonnegative(),
      exact_and_upto: z.number().int().nonnegative(),
      upto_only: z.number().int().nonnegative(),
    }).strict(),
    overall_network_mix: NetworkMixSchema,
    overall_upto_share: z.number().min(0).max(1),
    mcp_upto_share: z.number().min(0).max(1),
    mcp_upto_share_absolute_drift: z.number().min(0).max(1),
    full_corpus_upto_share: z.number().min(0).max(1),
    groups: z.object({
      mcp: GroupStatisticsSchema,
      upto: GroupStatisticsSchema,
      adversarial: GroupStatisticsSchema,
      sparse: GroupStatisticsSchema,
    }).strict(),
  }).strict(),
  checks: z.array(DistributionCheckSchema).length(DISTRIBUTION_CHECK_IDS.length),
  associations: z.array(DistributionAssociationSchema).length(ASSOCIATION_IDS.length),
  all_checks_passed: z.boolean(),
}).strict().superRefine((value, context) => {
  const checkIds = value.checks.map(check => check.id);
  const associationIds = value.associations.map(association => association.id);
  if (checkIds.join("\n") !== DISTRIBUTION_CHECK_IDS.join("\n")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["checks"], message: "checks must appear exactly once in canonical order" });
  }
  if (associationIds.join("\n") !== ASSOCIATION_IDS.join("\n")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["associations"], message: "associations must appear exactly once in canonical order" });
  }
  const expectedPass = value.checks.every(check => check.passed)
    && value.associations.every(association => association.passed);
  if (value.all_checks_passed !== expectedPass) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["all_checks_passed"], message: `must equal ${expectedPass}` });
  }
  if (value.status !== (expectedPass ? "pass" : "blocked")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: `must be ${expectedPass ? "pass" : "blocked"}` });
  }
});

export type DistributionAuditV2 = z.infer<typeof DistributionAuditV2Schema>;
export type DistributionCheck = z.infer<typeof DistributionCheckSchema>;
export type DistributionAssociation = z.infer<typeof DistributionAssociationSchema>;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

function parseAll<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  records: readonly unknown[],
  label: string,
): Array<z.output<TSchema>> {
  return records.map((record, index) => {
    const parsed = schema.safeParse(record);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ");
      throw new Error(`${label}[${index}]: ${issues}`);
    }
    return parsed.data;
  });
}

function countBy<T>(values: readonly T[], key: (value: T) => string): Map<string, number> {
  const result = new Map<string, number>();
  for (const value of values) {
    const name = key(value);
    result.set(name, (result.get(name) ?? 0) + 1);
  }
  return result;
}

function maxCount(values: ReadonlyMap<string, number>): number {
  return values.size === 0 ? 0 : Math.max(...values.values());
}

function sortedUnique<T extends string | number>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((left, right) => String(left).localeCompare(String(right)));
}

type NetworkBucket = "testnet_only" | "pubnet_only" | "both";

function networkBucket(record: SidecarRecord): NetworkBucket {
  const networks = record.axes!.networks;
  if (networks.length === 2) return "both";
  return networks[0] === "stellar:testnet" ? "testnet_only" : "pubnet_only";
}

function networkMix(records: readonly SidecarRecord[]): Record<NetworkBucket, number> {
  const result = { testnet_only: 0, pubnet_only: 0, both: 0 };
  for (const record of records) result[networkBucket(record)] += 1;
  return result;
}

function maximumNetworkDrift(
  group: readonly SidecarRecord[],
  labeled: readonly SidecarRecord[],
): number {
  if (group.length === 0 || labeled.length === 0) return 1;
  const observed = networkMix(group);
  const baseline = networkMix(labeled);
  return Math.max(...(["testnet_only", "pubnet_only", "both"] as const).map(bucket =>
    Math.abs(observed[bucket] / group.length - baseline[bucket] / labeled.length)));
}

function groupStatistics(
  group: readonly SidecarRecord[],
  labeled: readonly SidecarRecord[],
): z.infer<typeof GroupStatisticsSchema> {
  const byTier = countBy(group, record => String(record.axes!.price_tier));
  const bySlot = countBy(group, record => String(record.family_slot));
  const tierMax = maxCount(byTier);
  const slotMax = maxCount(bySlot);
  return {
    count: group.length,
    distinct_families: new Set(group.map(record => record.family)).size,
    distinct_price_tiers: new Set(group.map(record => record.axes!.price_tier)).size,
    input_methods: sortedUnique(group.map(record => record.axes!.input_method)),
    resource_types: sortedUnique(group.map(record => record.resource_type)),
    max_price_tier_count: tierMax,
    max_price_tier_share: group.length === 0 ? 0 : tierMax / group.length,
    max_family_slot_count: slotMax,
    max_family_slot_share: group.length === 0 ? 0 : slotMax / group.length,
    network_mix: networkMix(group),
    network_max_absolute_drift: maximumNetworkDrift(group, labeled),
  };
}

/** Raw Cramér's V. Null means one side has fewer than two observed categories. */
export function cramersV(left: readonly string[], right: readonly string[]): number | null {
  if (left.length !== right.length) throw new Error(`association vectors differ: ${left.length} vs ${right.length}`);
  if (left.length === 0) return null;
  const rows = sortedUnique(left);
  const columns = sortedUnique(right);
  if (rows.length < 2 || columns.length < 2) return null;
  const rowIndex = new Map(rows.map((value, index) => [value, index]));
  const columnIndex = new Map(columns.map((value, index) => [value, index]));
  const table = rows.map(() => columns.map(() => 0));
  for (let index = 0; index < left.length; index += 1) {
    table[rowIndex.get(left[index]!)!]![columnIndex.get(right[index]!)!]! += 1;
  }
  const rowTotals = table.map(row => row.reduce((sum, value) => sum + value, 0));
  const columnTotals = columns.map((_, column) => table.reduce((sum, row) => sum + row[column]!, 0));
  let chiSquared = 0;
  for (let row = 0; row < rows.length; row += 1) {
    for (let column = 0; column < columns.length; column += 1) {
      const expected = rowTotals[row]! * columnTotals[column]! / left.length;
      chiSquared += (table[row]![column]! - expected) ** 2 / expected;
    }
  }
  return Math.sqrt(chiSquared / (left.length * Math.min(rows.length - 1, columns.length - 1)));
}

function association(
  id: typeof ASSOCIATION_IDS[number],
  leftName: DistributionAssociation["left"],
  rightName: DistributionAssociation["right"],
  records: readonly SidecarRecord[],
  left: (record: SidecarRecord) => string,
  right: (record: SidecarRecord) => string,
): DistributionAssociation {
  const value = cramersV(records.map(left), records.map(right));
  return DistributionAssociationSchema.parse({
    id,
    left: leftName,
    right: rightName,
    sample_size: records.length,
    cramers_v: value,
    maximum_allowed: DISTRIBUTION_AUDIT_POLICY.association_max_cramers_v,
    passed: value !== null && value <= DISTRIBUTION_AUDIT_POLICY.association_max_cramers_v,
  });
}

function check(
  id: typeof DISTRIBUTION_CHECK_IDS[number],
  requirement: string,
  passed: boolean,
  observed: string,
): DistributionCheck {
  return DistributionCheckSchema.parse({ id, requirement, passed, observed });
}

export function buildDistributionAuditV2(
  rawCatalog: readonly unknown[],
  rawSidecars: readonly unknown[],
  generatedAt: string,
): DistributionAuditV2 {
  z.string().datetime().parse(generatedAt);
  const catalog = parseAll(CatalogRecordSchema, rawCatalog, "catalog") as CatalogRecord[];
  const sidecars = parseAll(SidecarRecordSchema, rawSidecars, "sidecars") as SidecarRecord[];
  const catalogSorted = [...catalog].sort((left, right) => left.resource_id.localeCompare(right.resource_id));
  const sidecarsSorted = [...sidecars].sort((left, right) => left.resource_id.localeCompare(right.resource_id));
  const sourceHash = `sha256:${createHash("sha256").update(canonicalJson({
    catalog: catalogSorted,
    sidecars: sidecarsSorted,
  })).digest("hex")}`;

  const catalogById = new Map(catalog.map(record => [record.resource_id, record]));
  const sidecarById = new Map(sidecars.map(record => [record.resource_id, record]));
  const wireErrors: string[] = [];
  if (catalogById.size !== catalog.length) wireErrors.push("duplicate catalog resource_id");
  if (sidecarById.size !== sidecars.length) wireErrors.push("duplicate sidecar resource_id");
  const expectedIds = new Set(Array.from({ length: RELEASE_COUNTS.resources.total }, (_, index) =>
    `res-${String(index + 1).padStart(4, "0")}`));
  for (const id of expectedIds) {
    if (!catalogById.has(id)) wireErrors.push(`${id}: missing expected catalog ID`);
    if (!sidecarById.has(id)) wireErrors.push(`${id}: missing expected sidecar ID`);
  }
  for (const id of catalogById.keys()) if (!expectedIds.has(id)) wireErrors.push(`${id}: unexpected catalog ID`);
  for (const id of sidecarById.keys()) if (!expectedIds.has(id)) wireErrors.push(`${id}: unexpected sidecar ID`);
  for (const sidecar of sidecars) {
    const record = catalogById.get(sidecar.resource_id);
    if (!record) wireErrors.push(`${sidecar.resource_id}: missing catalog record`);
    else wireErrors.push(...checkSidecarAgainstWire(sidecar, record.wire));
  }
  for (const record of catalog) {
    if (!sidecarById.has(record.resource_id)) wireErrors.push(`${record.resource_id}: missing sidecar`);
  }

  const labeled = sidecars.filter(record => !record.is_distractor);
  const distractors = sidecars.filter(record => record.is_distractor);
  const upto = labeled.filter(record => record.axes!.scheme_set !== "exact_only");
  const mcp = labeled.filter(record => record.resource_type === "mcp");
  const adversarial = labeled.filter(record => record.adversarial_kind !== null);
  const sparse = labeled.filter(record => record.is_sparse);
  const groups = {
    mcp: groupStatistics(mcp, labeled),
    upto: groupStatistics(upto, labeled),
    adversarial: groupStatistics(adversarial, labeled),
    sparse: groupStatistics(sparse, labeled),
  };
  const resourceTypes = countBy(labeled, record => record.resource_type);
  const schemeSets = countBy(labeled, record => record.axes!.scheme_set);
  const overallUptoShare = labeled.length === 0 ? 0 : upto.length / labeled.length;
  const mcpUpto = mcp.filter(record => record.axes!.scheme_set !== "exact_only").length;
  const mcpUptoShare = mcp.length === 0 ? 0 : mcpUpto / mcp.length;
  const mcpUptoDrift = Math.abs(mcpUptoShare - overallUptoShare);
  const distractorUpto = distractors.filter(sidecar =>
    catalogById.get(sidecar.resource_id)?.wire.accepts.some(option => option.scheme === "upto") === true);
  const fullCorpusUpto = labeled.filter(sidecar =>
    catalogById.get(sidecar.resource_id)?.wire.accepts.some(option => option.scheme === "upto") === true).length
    + distractorUpto.length;
  const fullCorpusUptoShare = sidecars.length === 0 ? 0 : fullCorpusUpto / sidecars.length;

  const countsPass = catalog.length === RELEASE_COUNTS.resources.total
    && sidecars.length === RELEASE_COUNTS.resources.total
    && labeled.length === RELEASE_COUNTS.resources.labeled
    && distractors.length === RELEASE_COUNTS.resources.distractor;
  const checks: DistributionCheck[] = [
    check("corpus-counts", "Audit the complete shipped 1,000-record corpus and 100-record labeled core",
      countsPass, `catalog=${catalog.length}, sidecars=${sidecars.length}, labeled=${labeled.length}, distractors=${distractors.length}`),
    check("catalog-sidecar-wire", "Catalog and sidecar IDs are one-to-one and every sidecar agrees with its wire record",
      wireErrors.length === 0, `${wireErrors.length} error(s)`),
    check("distractor-scheme-budget", "At most 1% of the 900 distractors carry an upto option",
      distractorUpto.length <= Math.floor(RELEASE_COUNTS.resources.distractor
        * DISTRIBUTION_TARGETS.distractor_upto_max_fraction),
      `${distractorUpto.length}/${distractors.length}`),
    check("distractor-resource-type-target", "Distractors use the selected HTTP-only transport policy",
      distractors.every(record => record.resource_type === "http"),
      `http=${distractors.filter(record => record.resource_type === "http").length}, mcp=${distractors.filter(record => record.resource_type === "mcp").length}`),
    check("resource-type-target", "Labeled core contains exactly 85 HTTP and 15 MCP resources",
      resourceTypes.get("http") === RELEASE_COUNTS.resource_types.http
        && resourceTypes.get("mcp") === RELEASE_COUNTS.resource_types.mcp,
      `http=${resourceTypes.get("http") ?? 0}, mcp=${resourceTypes.get("mcp") ?? 0}`),
    check("scheme-target", "Labeled core uses the pinned 70 exact-only / 22 exact+upto / 8 upto-only split",
      schemeSets.get("exact_only") === DISTRIBUTION_TARGETS.scheme.exact_only
        && schemeSets.get("exact_and_upto") === DISTRIBUTION_TARGETS.scheme.exact_and_upto
        && schemeSets.get("upto_only") === DISTRIBUTION_TARGETS.scheme.upto_only,
      `exact_only=${schemeSets.get("exact_only") ?? 0}, exact_and_upto=${schemeSets.get("exact_and_upto") ?? 0}, upto_only=${schemeSets.get("upto_only") ?? 0}`),
    check("adversarial-target", "Labeled core carries exactly 15 adversarial resources",
      adversarial.length === DISTRIBUTION_TARGETS.adversarial.resources, `${adversarial.length}`),
    check("sparse-target", "Labeled core carries exactly 10 sparse resources",
      sparse.length === DISTRIBUTION_TARGETS.sparse, `${sparse.length}`),
    check("upto-family-spread", "upto-bearing resources appear in all 20 families",
      groups.upto.distinct_families === FAMILY_COUNT, `${groups.upto.distinct_families}/${FAMILY_COUNT}`),
    check("upto-price-spread", "upto-bearing resources appear at at least 8 price tiers",
      groups.upto.distinct_price_tiers >= DISTRIBUTION_AUDIT_POLICY.upto_min_price_tiers,
      `${groups.upto.distinct_price_tiers}/${PRICE_TIERS.length}`),
    check("upto-http-method-spread", "upto-bearing HTTP resources include both GET and POST",
      groups.upto.input_methods.includes("GET") && groups.upto.input_methods.includes("POST"),
      groups.upto.input_methods.join(",") || "none"),
    check("upto-resource-type-spread", "upto-bearing resources include HTTP and MCP",
      groups.upto.resource_types.includes("http") && groups.upto.resource_types.includes("mcp"),
      groups.upto.resource_types.join(",") || "none"),
    check("mcp-upto-share", "MCP upto-bearing share stays within 5 percentage points of the labeled-core share",
      mcpUptoDrift <= DISTRIBUTION_AUDIT_POLICY.mcp_upto_share_max_absolute_drift,
      `overall=${overallUptoShare.toFixed(6)}, mcp=${mcpUptoShare.toFixed(6)}, drift=${mcpUptoDrift.toFixed(6)}`),
    check("mcp-family-spread", "MCP appears in at least 8 families",
      groups.mcp.distinct_families >= DISTRIBUTION_TARGETS.mcp_min_families,
      `${groups.mcp.distinct_families}/${FAMILY_COUNT}`),
    check("mcp-price-spread", "MCP appears at at least 8 price tiers",
      groups.mcp.distinct_price_tiers >= DISTRIBUTION_AUDIT_POLICY.mcp_min_price_tiers,
      `${groups.mcp.distinct_price_tiers}/${PRICE_TIERS.length}`),
    check("adversarial-price-spread", "Adversarial resources appear at at least 6 price tiers",
      groups.adversarial.distinct_price_tiers >= DISTRIBUTION_AUDIT_POLICY.adversarial_min_price_tiers,
      `${groups.adversarial.distinct_price_tiers}/${PRICE_TIERS.length}`),
    check("sparse-price-spread", "Sparse resources appear at at least 5 price tiers",
      groups.sparse.distinct_price_tiers >= DISTRIBUTION_AUDIT_POLICY.sparse_min_price_tiers,
      `${groups.sparse.distinct_price_tiers}/${PRICE_TIERS.length}`),
    ...(["mcp", "upto", "adversarial", "sparse"] as const).map(name =>
      check(`${name}-network-drift`, `${name} network mix stays within 15 percentage points of the labeled-core mix`,
        groups[name].network_max_absolute_drift <= DISTRIBUTION_AUDIT_POLICY.network_max_absolute_drift,
        groups[name].network_max_absolute_drift.toFixed(6))),
    ...(["mcp", "adversarial", "sparse"] as const).map(name =>
      check(`${name}-price-concentration`, `${name} places at most 2 resources at one price tier`,
        groups[name].max_price_tier_count <= DISTRIBUTION_AUDIT_POLICY.small_tag_max_per_price_tier,
        `${groups[name].max_price_tier_count}`)),
    check("upto-price-concentration", "No price tier contains more than 20% of upto-bearing resources",
      groups.upto.max_price_tier_share <= DISTRIBUTION_AUDIT_POLICY.upto_max_price_tier_share,
      groups.upto.max_price_tier_share.toFixed(6)),
    ...(["mcp", "upto", "adversarial", "sparse"] as const).map(name =>
      check(`${name}-slot-concentration`, `${name} places at most 40% of its resources in one family slot`,
        groups[name].max_family_slot_share <= DISTRIBUTION_AUDIT_POLICY.max_family_slot_share,
        groups[name].max_family_slot_share.toFixed(6))),
  ];

  const family = (record: SidecarRecord) => String(record.family);
  const price = (record: SidecarRecord) => String(record.axes!.price_tier);
  const method = (record: SidecarRecord) => record.axes!.input_method;
  const uptoFlag = (record: SidecarRecord) => record.axes!.scheme_set === "exact_only" ? "exact_only" : "upto_bearing";
  const mcpFlag = (record: SidecarRecord) => record.resource_type;
  const network = (record: SidecarRecord) => networkBucket(record);
  const associations: DistributionAssociation[] = [
    association("upto-family", "upto", "family", labeled, uptoFlag, family),
    association("upto-price-tier", "upto", "price_tier", labeled, uptoFlag, price),
    association("upto-input-method", "upto", "input_method", labeled, uptoFlag, method),
    association("mcp-family", "mcp", "family", labeled, mcpFlag, family),
    association("mcp-price-tier", "mcp", "price_tier", labeled, mcpFlag, price),
    association("network-family", "network", "family", labeled, network, family),
    association("network-price-tier", "network", "price_tier", labeled, network, price),
    association("network-input-method", "network", "input_method", labeled, network, method),
  ];

  if (checks.map(item => item.id).join("\n") !== DISTRIBUTION_CHECK_IDS.join("\n")) {
    throw new Error("internal distribution check order mismatch");
  }
  const allPassed = checks.every(item => item.passed) && associations.every(item => item.passed);
  return DistributionAuditV2Schema.parse({
    version: 1,
    artifact: "distribution-audit-v2",
    status: allPassed ? "pass" : "blocked",
    generated_at: generatedAt,
    source_hash: sourceHash,
    scope: "100_labeled_resource_core_with_full_corpus_integrity_check",
    policy: DISTRIBUTION_AUDIT_POLICY,
    counts: {
      catalog: catalog.length,
      sidecars: sidecars.length,
      labeled: labeled.length,
      distractors: distractors.length,
      distractor_upto_bearing: distractorUpto.length,
    },
    wire_error_count: wireErrors.length,
    statistics: {
      resource_types: { http: resourceTypes.get("http") ?? 0, mcp: resourceTypes.get("mcp") ?? 0 },
      scheme_sets: {
        exact_only: schemeSets.get("exact_only") ?? 0,
        exact_and_upto: schemeSets.get("exact_and_upto") ?? 0,
        upto_only: schemeSets.get("upto_only") ?? 0,
      },
      overall_network_mix: networkMix(labeled),
      overall_upto_share: overallUptoShare,
      mcp_upto_share: mcpUptoShare,
      mcp_upto_share_absolute_drift: mcpUptoDrift,
      full_corpus_upto_share: fullCorpusUptoShare,
      groups,
    },
    checks,
    associations,
    all_checks_passed: allPassed,
  });
}

/** Expected family-slot cardinality, exported for focused fixture assertions. */
export const LABELED_SLOT_COUNT = FAMILY_COUNT * RESOURCES_PER_FAMILY;
