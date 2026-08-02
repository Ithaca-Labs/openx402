/**
 * Weighted reciprocal rank fusion.
 *
 * For a document `d` appearing at 1-based rank `r_b(d)` in retrieval branch `b`
 * with weight `w_b`:
 *
 *     score(d) = Σ_b  w_b / (k + r_b(d))
 *
 * `k` is `search.rrf_k` (default 20 for this service). Only rank positions
 * enter the formula: a
 * `ts_rank_cd` value and a cosine distance are on incomparable scales and are
 * never added, multiplied or normalized against each other. A document missing
 * from a branch simply contributes nothing for that branch.
 *
 * Ties are broken by descending resource id, which is unique and immutable, so
 * two runs over the same snapshot always produce the same order.
 */

export interface FusionInput {
  resourceId: number;
  versionId: number;
}

export interface FusionBranch<T extends FusionInput> {
  name: string;
  weight: number;
  /** Candidates in the branch's own order, best first. */
  candidates: T[];
}

export interface FusedResult {
  resourceId: number;
  versionId: number;
  score: number;
  /** 1-based rank in each branch that returned this document. */
  ranks: Record<string, number>;
}

export function fuse<T extends FusionInput>(
  branches: Array<FusionBranch<T>>,
  rrfK: number,
): FusedResult[] {
  const fused = new Map<number, FusedResult>();
  for (const branch of branches) {
    if (branch.weight <= 0) continue;
    // A database branch normally returns one row per resource, but providers
    // and evaluation fixtures can contain duplicates. Deduplicate before rank
    // assignment so a duplicate cannot consume a rank or contribute twice.
    const seen = new Set<number>();
    let rank = 0;
    for (const candidate of branch.candidates) {
      if (seen.has(candidate.resourceId)) continue;
      seen.add(candidate.resourceId);
      rank += 1;
      const existing = fused.get(candidate.resourceId);
      const contribution = branch.weight / (rrfK + rank);
      if (existing) {
        // A resource can surface through several branches; keep the version the
        // first branch chose so the returned row matches the ranked document.
        existing.score += contribution;
        existing.ranks[branch.name] = rank;
        continue;
      }
      fused.set(candidate.resourceId, {
        resourceId: candidate.resourceId,
        versionId: candidate.versionId,
        score: contribution,
        ranks: { [branch.name]: rank },
      });
    }
  }
  return [...fused.values()].sort(compare);
}

/** Deterministic ordering: score descending, then resource id descending. */
export function compare(left: FusedResult, right: FusedResult): number {
  if (right.score !== left.score) return right.score - left.score;
  return right.resourceId - left.resourceId;
}

/**
 * Caps how many results a single origin may occupy, so one seller registering
 * many near-identical routes cannot fill the page. Order is otherwise preserved.
 */
export function applyOriginDiversity(
  results: FusedResult[],
  origins: Map<number, string>,
  limit: number,
): FusedResult[] {
  if (limit <= 0) return results;
  const seen = new Map<string, number>();
  const kept: FusedResult[] = [];
  const overflow: FusedResult[] = [];
  for (const result of results) {
    const origin = origins.get(result.resourceId) ?? String(result.resourceId);
    const count = seen.get(origin) ?? 0;
    if (count >= limit) {
      overflow.push(result);
      continue;
    }
    seen.set(origin, count + 1);
    kept.push(result);
  }
  // Over-represented origins are demoted, never dropped: a filtered query that
  // legitimately matches one origin must still return its results.
  return [...kept, ...overflow];
}
