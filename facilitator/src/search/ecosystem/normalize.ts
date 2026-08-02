import { canonicalJson, sha256 } from "../release/io.js";
import {
  EcosystemResourceSchema,
  EcosystemPaymentOptionSchema,
  type EcosystemResource,
  type EcosystemSource,
  EcosystemSourceRecordSchema,
} from "./schema.js";

type PaymentOption = ReturnType<typeof EcosystemPaymentOptionSchema.parse>;
type SourceRecord = ReturnType<typeof EcosystemSourceRecordSchema.parse>;

export interface NormalizationContext {
  source: EcosystemSource;
  sourceUrl: string;
  observedAt: string;
  redistribution?: SourceRecord["redistribution"];
}

function recordObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nested(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return recordObject(record[key]);
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string" && value.trim().length > 0) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map(item => item.trim()))].slice(0, 100);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function boundedTimeoutSeconds(value: unknown): number | undefined {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : finiteNumber(value);
  return number !== undefined && Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && Number.isInteger(number) && number >= 0 ? number : undefined;
}

function date(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

function validUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export function normalizeResourceUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  const params = [...url.searchParams.entries()].sort(([left], [right]) => left.localeCompare(right));
  url.search = "";
  for (const [key, item] of params) url.searchParams.append(key, item);
  return url.toString();
}

function transport(record: Record<string, unknown>, metadata: Record<string, unknown>): EcosystemResource["transport"] {
  const value = firstString(record.type, record.transport, metadata.type, metadata.transport)?.toLowerCase();
  if (value === "http" || value === "mcp" || value === "a2a") return value;
  if (value?.includes("mcp")) return "mcp";
  if (value?.includes("a2a") || value?.includes("agent")) return "a2a";
  // Directory APIs commonly omit a transport for ordinary URL services. A
  // valid HTTP(S) resource is the least surprising default and lets records
  // from two directories deduplicate correctly.
  return "http";
}

function paymentOptions(record: Record<string, unknown>, metadata: Record<string, unknown>): PaymentOption[] {
  const raw = [record.accepts, record.paymentOptions, record.payment_options, metadata.accepts]
    .find(value => Array.isArray(value));
  if (!Array.isArray(raw)) return [];
  const options: PaymentOption[] = [];
  for (const item of raw) {
    const value = recordObject(item);
    const amount = firstString(value.amount, value.maxAmountRequired, value.max_amount_required);
    const scheme = firstString(value.scheme);
    const network = firstString(value.network, value.chain);
    const asset = firstString(value.asset, value.currency);
    if (!amount || !scheme || !network || !asset) continue;
    const payTo = firstString(value.payTo, value.pay_to);
    const timeout = boundedTimeoutSeconds(value.maxTimeoutSeconds ?? value.max_timeout_seconds);
    const option: PaymentOption = {
      scheme, network, asset, amount,
      ...(payTo ? { pay_to: payTo } : {}),
      ...(timeout !== undefined ? { max_timeout_seconds: timeout } : {}),
    };
    options.push(option);
  }
  return options.slice(0, 20);
}

function operational(record: Record<string, unknown>, observedAt: string): EcosystemResource["operational"] {
  const health = recordObject(record.health);
  const livenessValue = record.liveness ?? record.healthy ?? health.status ?? health.healthy;
  const liveness: EcosystemResource["operational"]["liveness"] =
    livenessValue === true || livenessValue === "pass" || livenessValue === "healthy" ? "pass"
      : livenessValue === false || livenessValue === "fail" || livenessValue === "unhealthy" ? "fail" : "unknown";
  const paymentValue = record.payment ?? record.onChainDemand ?? record.on_chain_demand;
  const payment: EcosystemResource["operational"]["payment"] =
    paymentValue === true || paymentValue === "pass" ? "pass"
      : paymentValue === false || paymentValue === "fail" ? "fail" : "unknown";
  const responseValid = typeof record.responseValid === "boolean" ? record.responseValid
    : typeof record.response_valid === "boolean" ? record.response_valid : null;
  const safetyValue = record.safety ?? record.safetyStatus ?? record.safety_status;
  const safety: EcosystemResource["operational"]["safety"] =
    safetyValue === true || safetyValue === "pass" || safetyValue === "safe" ? "pass"
      : safetyValue === false || safetyValue === "fail" || safetyValue === "unsafe" ? "fail" : "unknown";
  const latency = finiteNumber(record.latencyMs ?? record.latency_ms ?? health.latencyMs);
  const checkedAt = date(record.checkedAt ?? record.checked_at ?? record.lastProbedAt) ?? observedAt;
  const failureReason = firstString(record.failureReason, record.failure_reason, health.error);
  return {
    liveness, payment, invocation: liveness,
    response_valid: responseValid,
    safety,
    ...(latency !== undefined ? { latency_ms: latency } : {}),
    checked_at: checkedAt,
    ...(failureReason ? { failure_reason: failureReason.slice(0, 1_000) } : {}),
  };
}

function quality(record: Record<string, unknown>, metadata: Record<string, unknown>): EcosystemResource["quality"] {
  const sourceQuality = recordObject(record.quality);
  const stats = recordObject(record.stats);
  const calls = nonNegativeInteger(sourceQuality.l30DaysTotalCalls ?? sourceQuality.totalCalls30d ?? stats.calls24h ?? record.calls24h);
  const buyers = nonNegativeInteger(sourceQuality.l30DaysUniquePayers ?? sourceQuality.uniquePayers30d ?? stats.uniqueBuyers30d);
  const lastCalled = date(sourceQuality.lastCalledAt ?? sourceQuality.last_called_at ?? record.lastCalledAt);
  const providerScore = finiteNumber(record.score ?? record.toolGradeScore ?? sourceQuality.score);
  const trustScore = finiteNumber(record.trustScore ?? record.trust_score ?? sourceQuality.trustScore);
  const sourceGrade = firstString(record.grade, sourceQuality.grade);
  const description = firstString(record.description, metadata.description);
  const hasSchema = [metadata.input, metadata.output, record.inputSchema, record.outputSchema, record.schema]
    .some(value => value !== undefined && value !== null);
  const metadataCompleteness = Math.min(1, (description ? 0.5 : 0) + (hasSchema ? 0.5 : 0));
  return {
    ...(buyers !== undefined ? { buyer_reach_30d: buyers } : {}),
    ...(calls !== undefined ? { transaction_volume_30d: calls } : {}),
    ...(lastCalled ? { last_called_at: lastCalled } : {}),
    metadata_completeness: metadataCompleteness,
    ...(providerScore !== undefined ? { provider_score: providerScore } : {}),
    ...(trustScore !== undefined ? { trust_score: trustScore } : {}),
    ...(sourceGrade ? { source_grade: sourceGrade } : {}),
  };
}

function sourceRecord(record: Record<string, unknown>, context: NormalizationContext, resourceKey: string): SourceRecord {
  const sourceRecordId = firstString(record.id, record.serviceId, record.service_id, record.resource, record.url) ?? resourceKey;
  return {
    source: context.source,
    source_url: context.sourceUrl,
    source_record_id: sourceRecordId.slice(0, 512),
    record_sha256: sha256(canonicalJson(record)),
    observed_at: context.observedAt,
    redistribution: context.redistribution ?? "unknown",
  };
}

function status(record: Record<string, unknown>, operationalState: EcosystemResource["operational"]): EcosystemResource["status"] {
  if (operationalState.safety === "fail") return "unsafe";
  if (operationalState.liveness === "fail") return "unreachable";
  if (record.stale === true || record.status === "stale") return "stale";
  if (operationalState.liveness === "pass") return "active";
  return "unknown";
}

export function normalizeExternalRecord(recordInput: unknown, context: NormalizationContext): EcosystemResource | null {
  const record = recordObject(recordInput);
  const metadata = nested(record, "metadata");
  const resource = validUrl(firstString(record.resource, record.url, record.endpoint, record.serviceUrl, metadata.resource));
  if (!resource) return null;
  const normalizedUrl = normalizeResourceUrl(resource);
  const kind = transport(record, metadata);
  const canonicalKey = `${kind}:${normalizedUrl}`;
  const resourceId = `eco-${sha256(canonicalKey).slice(0, 16)}` as EcosystemResource["resource_id"];
  const serviceName = firstString(record.serviceName, record.service_name, record.name, record.title, metadata.serviceName, metadata.name);
  const description = firstString(record.description, metadata.description, metadata.summary);
  const tags = stringArray(record.tags ?? metadata.tags);
  const categories = stringArray(record.categories ?? record.category ?? metadata.category);
  const qualityState = quality(record, metadata);
  const operationalState = operational(record, context.observedAt);
  const lastUpdated = date(record.lastUpdated ?? record.last_updated ?? record.updatedAt);
  const normalized: EcosystemResource = {
    resource_id: resourceId,
    canonical_key: canonicalKey,
    resource: normalizedUrl,
    canonical_origin: new URL(normalizedUrl).origin,
    transport: kind,
    ...(serviceName ? { service_name: serviceName.slice(0, 512) } : {}),
    ...(description ? { description: description.slice(0, 8_000) } : {}),
    tags,
    categories,
    accepts: paymentOptions(record, metadata),
    quality: qualityState,
    operational: operationalState,
    status: status(record, operationalState),
    ...(lastUpdated ? { last_updated: lastUpdated } : {}),
    observed_at: context.observedAt,
    source_records: [sourceRecord(record, context, canonicalKey)],
  };
  // A public directory can contain stale or non-conforming optional fields.
  // Keep the source snapshot progressing and drop only the malformed record;
  // required URL/resource identity failures were already handled above.
  const parsed = EcosystemResourceSchema.safeParse(normalized);
  return parsed.success ? parsed.data : null;
}

function latestDate(left: string, right: string): string {
  return new Date(left).valueOf() >= new Date(right).valueOf() ? left : right;
}

function prefer<T>(left: T | undefined, right: T | undefined): T | undefined {
  return left ?? right;
}

function mergeQuality(left: EcosystemResource["quality"], right: EcosystemResource["quality"]): EcosystemResource["quality"] {
  return {
    ...(prefer(left.buyer_reach_30d, right.buyer_reach_30d) !== undefined ? { buyer_reach_30d: Math.max(left.buyer_reach_30d ?? 0, right.buyer_reach_30d ?? 0) } : {}),
    ...(prefer(left.transaction_volume_30d, right.transaction_volume_30d) !== undefined ? { transaction_volume_30d: Math.max(left.transaction_volume_30d ?? 0, right.transaction_volume_30d ?? 0) } : {}),
    ...(prefer(left.last_called_at, right.last_called_at) ? { last_called_at: [left.last_called_at, right.last_called_at].filter(Boolean).sort().at(-1) } : {}),
    metadata_completeness: Math.max(left.metadata_completeness ?? 0, right.metadata_completeness ?? 0),
    ...(prefer(left.provider_score, right.provider_score) !== undefined ? { provider_score: Math.max(left.provider_score ?? Number.NEGATIVE_INFINITY, right.provider_score ?? Number.NEGATIVE_INFINITY) } : {}),
    ...(prefer(left.trust_score, right.trust_score) !== undefined ? { trust_score: Math.max(left.trust_score ?? Number.NEGATIVE_INFINITY, right.trust_score ?? Number.NEGATIVE_INFINITY) } : {}),
    ...(prefer(left.source_grade, right.source_grade) ? { source_grade: prefer(left.source_grade, right.source_grade) } : {}),
  };
}

function statusRank(value: EcosystemResource["status"]): number {
  return { active: 5, unknown: 4, stale: 3, unreachable: 2, unsafe: 1 }[value];
}

/** Merge cross-directory duplicates while retaining every source attribution. */
export function mergeEcosystemResources(resources: EcosystemResource[]): EcosystemResource[] {
  const merged = new Map<string, EcosystemResource>();
  for (const resource of resources) {
    const existing = merged.get(resource.resource_id);
    if (!existing) {
      merged.set(resource.resource_id, resource);
      continue;
    }
    const statusValue = statusRank(existing.status) >= statusRank(resource.status) ? existing.status : resource.status;
    const sources = [...existing.source_records, ...resource.source_records]
      .filter((value, index, all) => all.findIndex(candidate => `${candidate.source}:${candidate.source_record_id}` === `${value.source}:${value.source_record_id}`) === index);
    merged.set(resource.resource_id, EcosystemResourceSchema.parse({
      ...existing,
      service_name: prefer(existing.service_name, resource.service_name),
      description: [existing.description, resource.description].sort((left, right) => (right?.length ?? 0) - (left?.length ?? 0))[0],
      tags: [...new Set([...existing.tags, ...resource.tags])].slice(0, 100),
      categories: [...new Set([...existing.categories, ...resource.categories])].slice(0, 50),
      accepts: [...existing.accepts, ...resource.accepts].filter((value, index, all) => all.findIndex(candidate => canonicalJson(candidate) === canonicalJson(value)) === index).slice(0, 20),
      quality: mergeQuality(existing.quality, resource.quality),
      operational: statusRank(existing.status) >= statusRank(resource.status) ? existing.operational : resource.operational,
      status: statusValue,
      last_updated: existing.last_updated && resource.last_updated ? latestDate(existing.last_updated, resource.last_updated) : prefer(existing.last_updated, resource.last_updated),
      observed_at: latestDate(existing.observed_at, resource.observed_at),
      source_records: sources,
    }));
  }
  return [...merged.values()].sort((left, right) => left.resource_id.localeCompare(right.resource_id));
}
