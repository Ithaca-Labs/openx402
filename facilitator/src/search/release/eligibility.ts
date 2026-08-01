import type { CatalogRecord, QueryRecord, SidecarRecord } from "./schema.js";

export interface EligibilityResult {
  wireEligible: boolean;
  evaluationEligible: boolean;
  eligible: boolean;
  reason?: string;
}

/**
 * Applies production Bazaar filters and evaluation-only constraints separately.
 * Payment filters must all match the same `accepts` option.
 */
export function evaluateEligibility(
  query: QueryRecord,
  catalog: CatalogRecord,
  sidecar: SidecarRecord,
): EligibilityResult {
  const input = (catalog.wire.extensions.bazaar.info as Record<string, unknown>)?.input as
    | Record<string, unknown>
    | undefined;

  if (query.filters.type !== undefined && input?.type !== query.filters.type) {
    return {
      wireEligible: false,
      evaluationEligible: true,
      eligible: false,
      reason: `type=${String(input?.type)} does not satisfy ${query.filters.type}`,
    };
  }
  if (query.filters.extensions !== undefined && !(query.filters.extensions in catalog.wire.extensions)) {
    return {
      wireEligible: false,
      evaluationEligible: true,
      eligible: false,
      reason: `missing extension ${query.filters.extensions}`,
    };
  }

  const paymentFilters = Object.entries(query.filters)
    .filter(([key, wanted]) => wanted !== undefined && !["type", "extensions"].includes(key));
  if (paymentFilters.length > 0 && !catalog.wire.accepts.some(option =>
    paymentFilters.every(([key, wanted]) => option[key as keyof typeof option] === wanted))) {
    return {
      wireEligible: false,
      evaluationEligible: true,
      eligible: false,
      reason: "no single payment option satisfies all structured payment filters",
    };
  }

  if (query.evaluation_constraints.max_price_usd !== undefined
    && sidecar.price_usd_snapshot.value > query.evaluation_constraints.max_price_usd) {
    return {
      wireEligible: true,
      evaluationEligible: false,
      eligible: false,
      reason: "evaluation-only price constraint",
    };
  }
  if (query.evaluation_constraints.category !== undefined
    && sidecar.category !== query.evaluation_constraints.category) {
    return {
      wireEligible: true,
      evaluationEligible: false,
      eligible: false,
      reason: "evaluation-only category constraint",
    };
  }
  if (query.evaluation_constraints.source_class !== undefined
    && sidecar.source_class !== query.evaluation_constraints.source_class) {
    return {
      wireEligible: true,
      evaluationEligible: false,
      eligible: false,
      reason: "evaluation-only source-class constraint",
    };
  }
  if (query.evaluation_constraints.freshness !== undefined
    && sidecar.freshness !== query.evaluation_constraints.freshness) {
    return {
      wireEligible: true,
      evaluationEligible: false,
      eligible: false,
      reason: "evaluation-only freshness constraint",
    };
  }

  return { wireEligible: true, evaluationEligible: true, eligible: true };
}
