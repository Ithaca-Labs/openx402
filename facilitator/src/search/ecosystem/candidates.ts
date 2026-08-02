import { seededOrder } from "../release/io.js";
import type {
  EcosystemJudgment,
  EcosystemQuery,
  EcosystemRecommendationRun,
  EcosystemResource,
  EcosystemSource,
} from "./schema.js";

function tokens(value: string): string[] {
  return value.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]{2,}/gu) ?? [];
}

function searchableText(resource: EcosystemResource): string {
  return [
    resource.service_name,
    resource.description,
    resource.resource,
    ...resource.tags,
    ...resource.categories,
    ...resource.accepts.flatMap(value => [value.scheme, value.network, value.asset]),
  ].filter((value): value is string => Boolean(value)).join(" ");
}

function lexicalScore(query: EcosystemQuery, resource: EcosystemResource): number {
  const queryTokens = tokens(query.text);
  const haystack = new Set(tokens(searchableText(resource)));
  const overlap = queryTokens.reduce((sum, token) => sum + (haystack.has(token) ? 1 : 0), 0);
  const categoryBonus = resource.categories.some(category => queryTokens.includes(category.toLocaleLowerCase("en-US"))) ? 2 : 0;
  const nameBonus = resource.service_name && queryTokens.some(token => resource.service_name!.toLocaleLowerCase("en-US").includes(token)) ? 1 : 0;
  return overlap + categoryBonus + nameBonus;
}

function stringFilter(query: EcosystemQuery, name: string): string | undefined {
  const value = query.filters[name];
  return typeof value === "string" ? value : undefined;
}

/** Deterministic operational/structured eligibility before the LLM judge. */
export function ecosystemEligibility(
  query: EcosystemQuery,
  resource: EcosystemResource,
): EcosystemJudgment["eligibility"] {
  if (resource.status === "unsafe" || resource.operational.safety === "fail") return "unsafe";
  if (resource.status === "unreachable" || resource.operational.liveness === "fail") return "unreachable";
  if (resource.status === "stale") return "stale";
  const transport = stringFilter(query, "type");
  if (transport && resource.transport !== transport) return "incompatible";
  const category = stringFilter(query, "category");
  if (category && !resource.categories.some(value => value.toLocaleLowerCase("en-US") === category.toLocaleLowerCase("en-US"))) return "incompatible";
  const optionFilters = ["network", "scheme", "asset", "payTo"] as const;
  const constrained = optionFilters.filter(name => stringFilter(query, name) !== undefined);
  if (constrained.length > 0 && !resource.accepts.some(option => constrained.every(name => {
    const expected = stringFilter(query, name)!;
    const actual = name === "payTo" ? option.pay_to : option[name];
    return actual === expected;
  }))) return "incompatible";
  return "eligible";
}

function rankedResources(resources: EcosystemResource[], query: EcosystemQuery): EcosystemResource[] {
  return [...resources].sort((left, right) => {
    const eligibilityDelta = Number(ecosystemEligibility(query, right) === "eligible")
      - Number(ecosystemEligibility(query, left) === "eligible");
    if (eligibilityDelta !== 0) return eligibilityDelta;
    return lexicalScore(query, right) - lexicalScore(query, left)
      || left.resource_id.localeCompare(right.resource_id);
  });
}

/** Produces a deterministic baseline run and the candidate rankings used for pooling. */
export function generateEcosystemRecommendations(
  resources: EcosystemResource[],
  queries: EcosystemQuery[],
  limit = 100,
): EcosystemRecommendationRun[] {
  return queries.map(query => ({
    query_id: query.query_id,
    ranked_resource_ids: rankedResources(resources, query).slice(0, limit).map(value => value.resource_id),
  }));
}

/**
 * Pools top recommendations while reserving representation from every fetched
 * directory. This expands judgments without paying for the full Cartesian set.
 */
export function buildEcosystemJudgmentPool(
  resources: EcosystemResource[],
  queries: EcosystemQuery[],
  runs: EcosystemRecommendationRun[],
  poolSize = 20,
): Array<{ query: EcosystemQuery; resource: EcosystemResource; eligibility: EcosystemJudgment["eligibility"] }> {
  if (!Number.isInteger(poolSize) || poolSize < 1 || poolSize > 100) throw new Error("ecosystem judgment pool size must be from 1 through 100");
  const resourceById = new Map(resources.map(value => [value.resource_id, value]));
  const runByQuery = new Map(runs.map(value => [value.query_id, value]));
  const sources = [...new Set(resources.flatMap(value => value.source_records.map(record => record.source)))].sort() as EcosystemSource[];
  const pairs: Array<{ query: EcosystemQuery; resource: EcosystemResource; eligibility: EcosystemJudgment["eligibility"] }> = [];
  for (const query of queries) {
    const ranked = runByQuery.get(query.query_id)?.ranked_resource_ids
      .map(resourceId => resourceById.get(resourceId))
      .filter((value): value is EcosystemResource => value !== undefined)
      ?? rankedResources(resources, query);
    const selected = new Map<string, EcosystemResource>();
    for (const source of sources) {
      const sourceCandidate = ranked.find(resource => resource.source_records.some(record => record.source === source));
      if (sourceCandidate) selected.set(sourceCandidate.resource_id, sourceCandidate);
    }
    for (const resource of ranked) {
      if (selected.size >= poolSize) break;
      selected.set(resource.resource_id, resource);
    }
    const ordered = seededOrder([...selected.values()].slice(0, poolSize), `ecosystem-pool:${query.query_id}`, value => value.resource_id);
    pairs.push(...ordered.map(resource => ({ query, resource, eligibility: ecosystemEligibility(query, resource) })));
  }
  return pairs;
}
