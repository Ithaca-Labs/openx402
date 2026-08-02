import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  probeEcosystemDataset,
  refreshEcosystemDataset,
  seedEcosystemQueries,
  type EcosystemProbeResult,
  type EcosystemRefreshResult,
} from "../ecosystem/dataset.js";
import { evaluateEcosystemRun, type EcosystemEvaluationReport } from "../ecosystem/evaluate.js";
import { judgeEcosystemWithOpenRouter, type EcosystemJudgeResult } from "../ecosystem/judge.js";
import { readRecommendationRun, validateEcosystemDataset } from "../ecosystem/validate.js";
import { validateReleaseDataset } from "../release/validate.js";

export interface EvaluationProgramOptions {
  releaseRoot: string;
  ecosystemRoot: string;
  refreshEcosystem?: boolean;
  probeEcosystem?: boolean;
  probeLimit?: number;
  recommendationRun?: string;
  output?: string;
  judge?: "none" | "openrouter";
}

export interface EvaluationProgramReport {
  program: "x402-evaluation-v1";
  generated_at: string;
  status: "complete" | "incomplete";
  controlled: {
    status: "complete" | "provisional";
    resources: number;
    queries: number;
    judgments: number;
    pending_judgments: number;
    provisional_judgments: number;
    judge_counts: Record<string, number>;
    judge_invoked: boolean;
    latest_measurement?: string;
  };
  live: {
    status: "complete" | "partial_judgments" | "awaiting_judgments" | "awaiting_recommendations";
    resources: number;
    queries: number;
    judgments: number;
    judge_counts: Record<string, number>;
    outcomes: number;
    sources: string[];
    source_errors: Array<{ source: string; error: string }>;
    snapshot_generated_at: string;
    liveness: { observed: number; passed: number; failed: number; unknown: number };
    refresh?: EcosystemRefreshResult;
    probe?: EcosystemProbeResult;
    evaluation?: EcosystemEvaluationReport;
    judge?: EcosystemJudgeResult;
  };
  blockers: string[];
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function latestControlledMeasurement(root: string): Promise<string | undefined> {
  for (const relative of ["reports/release-v1.json", "reports/provisional-v1.json"]) {
    if (await exists(resolve(root, relative))) return relative;
  }
  return undefined;
}

const execFileAsync = promisify(execFile);

async function judgeControlledCohort(root: string): Promise<void> {
  const modulePath = fileURLToPath(import.meta.url);
  const compiled = modulePath.endsWith(".js");
  const cli = resolve(dirname(modulePath), `../../cli/judge-release-qrels.${compiled ? "js" : "ts"}`);
  const command = compiled ? process.execPath : resolve(dirname(modulePath), "../../../node_modules/.bin/tsx");
  await execFileAsync(command, [cli, root], { env: process.env, maxBuffer: 16 * 1024 * 1024 });
}

/**
 * Runs the complete evaluation workflow while preserving the different
 * provenance of controlled and live evidence in one report.
 */
export async function runEvaluationProgram(options: EvaluationProgramOptions): Promise<EvaluationProgramReport> {
  let release = await validateReleaseDataset(options.releaseRoot);
  let controlledJudgeInvoked = false;
  if (options.judge === "openrouter" && release.qrels.some(value => value.judge === "pending")) {
    controlledJudgeInvoked = true;
    await judgeControlledCohort(options.releaseRoot);
    release = await validateReleaseDataset(options.releaseRoot);
  }
  let refresh: EcosystemRefreshResult | undefined;
  let probe: EcosystemProbeResult | undefined;
  if (options.refreshEcosystem ?? true) {
    refresh = await refreshEcosystemDataset(options.ecosystemRoot);
    await seedEcosystemQueries(options.releaseRoot, options.ecosystemRoot);
  }
  if (options.probeEcosystem ?? true) {
    probe = await probeEcosystemDataset(options.ecosystemRoot, { limit: options.probeLimit ?? 500 });
  }
  let judge: EcosystemJudgeResult | undefined;
  if (options.judge === "openrouter") judge = await judgeEcosystemWithOpenRouter(options.ecosystemRoot);
  const ecosystem = await validateEcosystemDataset(options.ecosystemRoot);
  const liveness = {
    observed: ecosystem.resources.filter(value => value.operational.liveness !== "unknown").length,
    passed: ecosystem.resources.filter(value => value.operational.liveness === "pass").length,
    failed: ecosystem.resources.filter(value => value.operational.liveness === "fail").length,
    unknown: ecosystem.resources.filter(value => value.operational.liveness === "unknown").length,
  };
  const runPath = resolve(options.recommendationRun ?? `${options.ecosystemRoot}/runs/recommendations-v1.jsonl`);
  const blockers: string[] = [];
  let liveStatus: EvaluationProgramReport["live"]["status"];
  let evaluation: EcosystemEvaluationReport | undefined;
  if (ecosystem.judgments.length === 0) {
    liveStatus = "awaiting_judgments";
    blockers.push("live cohort has no pooled relevance judgments");
  } else if (!(await exists(runPath))) {
    liveStatus = "awaiting_recommendations";
    blockers.push("live cohort has no recommendation run");
  } else {
    const runs = await readRecommendationRun(runPath);
    evaluation = evaluateEcosystemRun(
      ecosystem.resources,
      ecosystem.queries,
      ecosystem.judgments,
      runs,
      ecosystem.outcomes,
    );
    liveStatus = ecosystem.manifest.judging?.complete === false ? "partial_judgments" : "complete";
    if (liveStatus === "partial_judgments") {
      blockers.push(`live cohort has ${ecosystem.manifest.judging!.persisted_pairs}/${ecosystem.manifest.judging!.expected_pairs} pooled judgments`);
    }
  }

  const pending = release.qrels.filter(value => value.judge === "pending").length;
  const provisional = release.qrels.filter(value => value.provisional).length;
  const controlledStatus = pending === 0 && provisional === 0 ? "complete" : "provisional";
  const controlledMeasurement = await latestControlledMeasurement(options.releaseRoot);
  const controlledJudgeCounts = Object.fromEntries([...new Set(release.qrels.map(value => value.judge))]
    .sort().map(name => [name, release.qrels.filter(value => value.judge === name).length]));
  const liveJudgeCounts = Object.fromEntries([...new Set(ecosystem.judgments.map(value => value.judge))]
    .sort().map(name => [name, ecosystem.judgments.filter(value => value.judge === name).length]));
  if (pending > 0) blockers.push(`controlled cohort has ${pending} pending judgments`);
  if (provisional > 0) blockers.push(`controlled cohort has ${provisional} provisional judgments`);

  const report: EvaluationProgramReport = {
    program: "x402-evaluation-v1",
    generated_at: new Date().toISOString(),
    status: controlledStatus === "complete" && liveStatus === "complete" ? "complete" : "incomplete",
    controlled: {
      status: controlledStatus,
      resources: release.catalog.length,
      queries: release.queries.length,
      judgments: release.qrels.length,
      pending_judgments: pending,
      provisional_judgments: provisional,
      judge_counts: controlledJudgeCounts,
      judge_invoked: controlledJudgeInvoked,
      ...(controlledMeasurement ? { latest_measurement: controlledMeasurement } : {}),
    },
    live: {
      status: liveStatus,
      resources: ecosystem.resources.length,
      queries: ecosystem.queries.length,
      judgments: ecosystem.judgments.length,
      judge_counts: liveJudgeCounts,
      outcomes: ecosystem.outcomes.length,
      sources: ecosystem.manifest.sources,
      source_errors: ecosystem.manifest.source_errors,
      snapshot_generated_at: ecosystem.manifest.generated_at,
      liveness,
      ...(refresh ? { refresh } : {}),
      ...(probe ? { probe } : {}),
      ...(evaluation ? { evaluation } : {}),
      ...(judge ? { judge } : {}),
    },
    blockers,
  };
  const output = resolve(options.output ?? `${options.releaseRoot}/reports/evaluation-program-v1.json`);
  await mkdir(resolve(output, ".."), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export async function readEvaluationProgramReport(path: string): Promise<EvaluationProgramReport> {
  return JSON.parse(await readFile(path, "utf8")) as EvaluationProgramReport;
}
