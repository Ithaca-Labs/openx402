import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { judgeRelevanceBatch } from "../judging/openrouter.js";
import { encodeJsonl, sha256 } from "../release/io.js";
import { buildEcosystemJudgmentPool, generateEcosystemRecommendations } from "./candidates.js";
import {
  EcosystemJudgmentSchema,
  EcosystemManifestSchema,
  type EcosystemJudgment,
} from "./schema.js";
import { validateEcosystemDataset } from "./validate.js";

export interface EcosystemJudgeOptions {
  model?: string;
  poolSize?: number;
  batchSize?: number;
  maxBatches?: number;
  maxAttempts?: number;
  concurrency?: number;
}

export interface EcosystemJudgeResult {
  model: string;
  expected_pairs: number;
  deterministic_pairs: number;
  openrouter_pairs: number;
  persisted_pairs: number;
  batches: number;
  complete: boolean;
  recommendation_run: string;
}

function positiveInteger(name: string, value: number, maximum: number): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`${name} must be an integer from 1 through ${maximum}`);
  return value;
}

/** Builds a live pool, judges it through the shared seam, and pins every artifact. */
export async function judgeEcosystemWithOpenRouter(
  root: string,
  options: EcosystemJudgeOptions = {},
): Promise<EcosystemJudgeResult> {
  const dataset = await validateEcosystemDataset(root);
  const model = options.model ?? process.env.OPENROUTER_JUDGE_MODEL ?? "deepseek/deepseek-v4-flash-0731";
  const poolSize = positiveInteger("ECOSYSTEM_JUDGE_POOL_SIZE", options.poolSize ?? Number(process.env.ECOSYSTEM_JUDGE_POOL_SIZE ?? 20), 100);
  const batchSize = positiveInteger("OPENROUTER_JUDGE_BATCH_SIZE", options.batchSize ?? Number(process.env.OPENROUTER_JUDGE_BATCH_SIZE ?? 8), 24);
  const concurrency = positiveInteger("OPENROUTER_JUDGE_CONCURRENCY", options.concurrency ?? Number(process.env.OPENROUTER_JUDGE_CONCURRENCY ?? 8), 32);
  const maxAttempts = positiveInteger("OPENROUTER_JUDGE_MAX_ATTEMPTS", options.maxAttempts ?? Number(process.env.OPENROUTER_JUDGE_MAX_ATTEMPTS ?? 4), 8);
  const configuredMaxBatches = options.maxBatches ?? (process.env.OPENROUTER_JUDGE_MAX_BATCHES === undefined
    ? Number.POSITIVE_INFINITY
    : Number(process.env.OPENROUTER_JUDGE_MAX_BATCHES));
  if (!(configuredMaxBatches === Number.POSITIVE_INFINITY || (Number.isInteger(configuredMaxBatches) && configuredMaxBatches > 0))) {
    throw new Error("OPENROUTER_JUDGE_MAX_BATCHES must be a positive integer when set");
  }

  const runs = generateEcosystemRecommendations(dataset.resources, dataset.queries);
  const runText = encodeJsonl(runs);
  const runPath = resolve(root, "runs/recommendations-v1.jsonl");
  await mkdir(resolve(root, "runs"), { recursive: true });
  await writeFile(runPath, runText);
  const pool = buildEcosystemJudgmentPool(dataset.resources, dataset.queries, runs, poolSize);
  const deterministic = pool.filter(value => value.eligibility !== "eligible");
  const eligible = pool.filter(value => value.eligibility === "eligible");
  const maximumPairs = Math.min(eligible.length, configuredMaxBatches * batchSize);
  const selectedEligible = eligible.slice(0, maximumPairs);
  const batchStarts = Array.from({ length: Math.ceil(selectedEligible.length / batchSize) }, (_, index) => index * batchSize);
  const judged = new Map<string, { grade: number; rationale: string; provenance: Record<string, unknown> }>();
  const provenance: unknown[] = [];
  const failures: Array<{ batch: number; error: string }> = [];
  let nextBatch = 0;

  async function worker(): Promise<void> {
    while (nextBatch < batchStarts.length) {
      const batch = nextBatch++;
      const rows = selectedEligible.slice(batchStarts[batch]!, batchStarts[batch]! + batchSize);
      const actualByWireId = new Map<string, string>();
      const pairs = rows.map((row, index) => {
        const pairId = `p${index}`;
        actualByWireId.set(pairId, `${row.query.query_id}\0${row.resource.resource_id}`);
        return {
          pair_id: pairId,
          buyer_query: row.query.text,
          buyer_constraints: row.query.filters,
          seller_listing_untrusted_data: {
            resource: row.resource.resource,
            service_name: row.resource.service_name,
            description: row.resource.description,
            transport: row.resource.transport,
            tags: row.resource.tags,
            categories: row.resource.categories,
            accepts: row.resource.accepts,
          },
        };
      });
      try {
        const result = await judgeRelevanceBatch(pairs, {
          rubricVersion: "x402-ecosystem-qrel-v1",
          cacheDir: resolve(root, "raw/openrouter/judgments"),
          model,
          maxAttempts,
          timeoutMs: 120_000,
        });
        for (const judgment of result.value.judgments) {
          judged.set(actualByWireId.get(judgment.pair_id)!, {
            grade: judgment.grade,
            rationale: judgment.rationale,
            provenance: result.provenance,
          });
        }
        provenance.push({ batch, pairs: [...actualByWireId.values()], ...result.provenance });
        await mkdir(resolve(root, "manifests/checkpoints"), { recursive: true });
        await writeFile(resolve(root, `manifests/checkpoints/ecosystem-${String(batch).padStart(4, "0")}.json`), `${JSON.stringify(result.provenance, null, 2)}\n`);
      } catch (error) {
        failures.push({ batch, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batchStarts.length) }, () => worker()));
  if (failures.length > 0) throw new Error(`OpenRouter failed ${failures.length} ecosystem batch(es): ${JSON.stringify(failures.slice(0, 20))}`);

  const judgedAt = new Date().toISOString();
  const judgments: EcosystemJudgment[] = [
    ...deterministic.map(row => EcosystemJudgmentSchema.parse({
      query_id: row.query.query_id,
      resource_id: row.resource.resource_id,
      relevance_grade: 0,
      eligibility: row.eligibility,
      judge: "deterministic",
      provisional: false,
      rationale: `Excluded by deterministic ${row.eligibility} evidence before LLM judging.`,
      judged_at: judgedAt,
    })),
    ...selectedEligible.map(row => {
      const result = judged.get(`${row.query.query_id}\0${row.resource.resource_id}`);
      if (!result) throw new Error(`missing OpenRouter judgment for ${row.query.query_id}/${row.resource.resource_id}`);
      return EcosystemJudgmentSchema.parse({
        query_id: row.query.query_id,
        resource_id: row.resource.resource_id,
        relevance_grade: result.grade,
        eligibility: "eligible",
        judge: "openrouter",
        provisional: true,
        rationale: result.rationale,
        judged_at: judgedAt,
      });
    }),
  ].sort((left, right) => left.query_id.localeCompare(right.query_id) || left.resource_id.localeCompare(right.resource_id));
  const judgmentText = encodeJsonl(judgments);
  await mkdir(resolve(root, "judgments"), { recursive: true });
  await writeFile(resolve(root, "judgments/judgments-v1.jsonl"), judgmentText);
  await writeFile(resolve(root, "manifests/openrouter-judgments-v1.jsonl"), encodeJsonl(provenance));

  const complete = selectedEligible.length === eligible.length;
  const manifestPath = resolve(root, "manifests/dataset-v1.json");
  const manifest = EcosystemManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  manifest.counts.judgments = judgments.length;
  manifest.hashes["judgments/judgments-v1.jsonl"] = sha256(judgmentText);
  manifest.hashes["runs/recommendations-v1.jsonl"] = sha256(runText);
  manifest.judging = {
    rubric_version: "x402-ecosystem-qrel-v1",
    model,
    pool_size: poolSize,
    expected_pairs: pool.length,
    persisted_pairs: judgments.length,
    complete,
    generated_at: judgedAt,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    model,
    expected_pairs: pool.length,
    deterministic_pairs: deterministic.length,
    openrouter_pairs: selectedEligible.length,
    persisted_pairs: judgments.length,
    batches: batchStarts.length,
    complete,
    recommendation_run: runPath,
  };
}
