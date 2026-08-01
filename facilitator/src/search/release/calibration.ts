import { seededOrder } from "./io.js";
import type { QrelRecord, QueryRecord } from "./schema.js";

export interface CalibrationRow {
  query_id: string;
  resource_id: string;
  agent_grade: number;
  human_grade: number | null;
  human_reviewer: string | null;
  reviewed_at: string | null;
  notes: string | null;
}

/** Deterministically covers classes, eligibility, judge states, and grades. */
export function buildCalibrationSample(
  qrels: QrelRecord[],
  queries: QueryRecord[],
  count = 400,
): CalibrationRow[] {
  const queryById = new Map(queries.map(query => [query.query_id, query]));
  const buckets = new Map<string, QrelRecord[]>();
  for (const row of qrels) {
    const query = queryById.get(row.query_id);
    if (!query) throw new Error(`calibration qrel references unknown query ${row.query_id}`);
    const key = [query.query_class, row.eligible ? "eligible" : "ineligible", row.judge, `grade-${row.grade}`].join("|");
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }

  const orderedBuckets = seededOrder(
    [...buckets.entries()].map(([key, rows]) => ({ key, rows: seededOrder(rows, `calibration:${key}`, row => `${row.query_id}\0${row.resource_id}`) })),
    "calibration-bucket-order-v2",
    bucket => bucket.key,
  );
  const selected: QrelRecord[] = [];
  for (let position = 0; selected.length < Math.min(count, qrels.length); position += 1) {
    let added = false;
    for (const bucket of orderedBuckets) {
      const row = bucket.rows[position];
      if (!row) continue;
      selected.push(row);
      added = true;
      if (selected.length === Math.min(count, qrels.length)) break;
    }
    if (!added) break;
  }

  return selected.map(row => ({
    query_id: row.query_id,
    resource_id: row.resource_id,
    agent_grade: row.grade,
    human_grade: null,
    human_reviewer: null,
    reviewed_at: null,
    notes: "Stratified calibration sample; not human reviewed.",
  }));
}
