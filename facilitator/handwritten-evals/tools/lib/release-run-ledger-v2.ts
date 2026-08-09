#!/usr/bin/env node

/**
 * Release holdout access log (BUILD-PLAN §12.1, MVP scope — see sixth revision note).
 *
 * A release runner must append `started` before it reads release inputs, then append exactly one
 * `completed` or `failed` event. This is a plain append-only log: timestamp, actor, reason. The
 * original hash-chained, lock-serialized, doubly-acknowledged version was deferred past MVP —
 * there was no real release set to protect it against yet. Restore that hardening once multiple
 * teams are actually running release evals against a real, frozen dataset.
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  DATASET_MANIFEST_PATH,
  DatasetManifestV2Schema,
  hashFile,
  RELEASE_QUERY_INDEX_PATH,
  RELEASE_RUN_LEDGER_PATH,
  ReleaseQueryIndexV2Schema,
  sha256Bytes,
  type DatasetManifestV2,
  type ReleaseQueryIndexV2,
} from "./manifest-v2.js";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const relativeArtifactPath = z.string().min(1).refine(
  value => !isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`),
  "must be a path below the handwritten-evals root",
);

export const RELEASE_RUN_PHASES = ["started", "completed", "failed"] as const;
export const RELEASE_RUN_PURPOSES = ["milestone", "final"] as const;
export const FINAL_RELEASE_REPORT_PATH = "reports/final-v2.json";

/** Immutable report path for one recorded holdout run. */
export function versionedReleaseReportPath(runId: string, purpose: ReleaseRunPurpose): string {
  const parsedRunId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/).parse(runId);
  const parsedPurpose = z.enum(RELEASE_RUN_PURPOSES).parse(purpose);
  return `reports/releases/${parsedPurpose}-${parsedRunId}-v2.json`;
}

/** Preserved pre-signoff report; never accepted by the release ledger or release gates. */
export function releaseReportDraftPath(runId: string, purpose: ReleaseRunPurpose): string {
  const parsedRunId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/).parse(runId);
  const parsedPurpose = z.enum(RELEASE_RUN_PURPOSES).parse(purpose);
  return `reports/drafts/${parsedPurpose}-${parsedRunId}-v2.json`;
}

/** Paths created together by the report generator. */
export function releaseReportOutputPaths(runId: string, purpose: ReleaseRunPurpose): string[] {
  const versioned = versionedReleaseReportPath(runId, purpose);
  return purpose === "final" ? [versioned, FINAL_RELEASE_REPORT_PATH] : [versioned];
}

/** Compatibility path recorded as `report.path`; the immutable path is always recorded separately. */
export function releaseReportCompletionPath(runId: string, purpose: ReleaseRunPurpose): string {
  return purpose === "final" ? FINAL_RELEASE_REPORT_PATH : versionedReleaseReportPath(runId, purpose);
}

export const ReleaseRunLedgerEntryV2Schema = z.object({
  recorded_at: z.string().datetime(),
  phase: z.enum(RELEASE_RUN_PHASES),
  run_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/),
  purpose: z.enum(RELEASE_RUN_PURPOSES),
  actor: z.string().min(1).max(200),
  reason: z.string().min(1).max(1_000),
  dataset_manifest_path: z.literal(DATASET_MANIFEST_PATH),
  dataset_manifest_sha256: sha256,
  release_query_index_sha256: sha256,
  report: z.object({
    /** Compatibility path consumed by release gates; final runs retain the canonical final path. */
    path: relativeArtifactPath,
    sha256,
    /** Run-specific immutable copy. Absent only on ledger entries created before this field existed. */
    versioned_path: relativeArtifactPath.optional(),
    versioned_sha256: sha256.optional(),
  }).strict().nullable(),
  failure_reason: z.string().min(1).max(2_000).nullable(),
}).strict().superRefine((value, context) => {
  if (value.phase === "completed" && value.report === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["report"], message: "completed events require a final report hash" });
  }
  if (value.phase !== "completed" && value.report !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["report"], message: "only completed events carry a report" });
  }
  if (value.report) {
    const versionedFields = value.report.versioned_path !== undefined
      || value.report.versioned_sha256 !== undefined;
    if (versionedFields && (value.report.versioned_path === undefined || value.report.versioned_sha256 === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["report"],
        message: "versioned report path and hash must be recorded together",
      });
    }
    if (value.report.versioned_path !== undefined) {
      const expectedVersionedPath = versionedReleaseReportPath(value.run_id, value.purpose);
      const expectedPrimaryPath = releaseReportCompletionPath(value.run_id, value.purpose);
      if (value.report.path !== expectedPrimaryPath) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["report", "path"],
          message: `expected completion report path ${expectedPrimaryPath}`,
        });
      }
      if (value.report.versioned_path !== expectedVersionedPath) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["report", "versioned_path"],
          message: `expected immutable report path ${expectedVersionedPath}`,
        });
      }
      if (value.report.versioned_sha256 !== value.report.sha256) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["report", "versioned_sha256"],
          message: "canonical and immutable report bytes must match",
        });
      }
    }
  }
  if (value.phase === "failed" && value.failure_reason === null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["failure_reason"], message: "failed events require a reason" });
  }
  if (value.phase !== "failed" && value.failure_reason !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["failure_reason"], message: "only failed events carry a failure reason" });
  }
});

export type ReleaseRunLedgerEntryV2 = z.infer<typeof ReleaseRunLedgerEntryV2Schema>;
export type ReleaseRunPhase = typeof RELEASE_RUN_PHASES[number];
export type ReleaseRunPurpose = typeof RELEASE_RUN_PURPOSES[number];

export interface VerifiedFrozenDataset {
  manifest: DatasetManifestV2;
  manifestSha256: string;
  releaseQueryIndex: ReleaseQueryIndexV2;
}

export interface RecordReleaseRunOptions {
  root: string;
  phase: ReleaseRunPhase;
  runId: string;
  purpose: ReleaseRunPurpose;
  actor: string;
  reason: string;
  reportPath?: string;
  failureReason?: string;
  recordedAt?: string;
  ledgerPath?: string;
}

function rootRelativePath(root: string, path: string): string {
  const absoluteRoot = resolve(root);
  const absolutePath = resolve(absoluteRoot, path);
  const result = relative(absoluteRoot, absolutePath);
  if (!result || result === ".." || result.startsWith(`..${sep}`) || isAbsolute(result)) {
    throw new Error(`${path}: must name a file below the handwritten-evals root`);
  }
  return result.split(sep).join("/");
}

/** Plain parse of the append-only log. No hash chain to verify (MVP scope — see file header). */
export async function readReleaseRunLedger(
  path: string,
  _rootInput?: string,
): Promise<ReleaseRunLedgerEntryV2[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const entries: ReleaseRunLedgerEntryV2[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      throw new Error(`${path}:${index + 1}: invalid JSON: ${(error as Error).message}`);
    }
    const parsed = ReleaseRunLedgerEntryV2Schema.safeParse(raw);
    if (!parsed.success) throw new Error(`${path}:${index + 1}: ${parsed.error.message}`);
    entries.push(parsed.data);
  }
  return entries;
}

/** Validates the freeze and proves that no frozen byte has changed. */
export async function verifyFrozenDataset(rootInput: string): Promise<VerifiedFrozenDataset> {
  const root = resolve(rootInput);
  const manifestPath = resolve(root, DATASET_MANIFEST_PATH);
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = DatasetManifestV2Schema.parse(JSON.parse(manifestText));
  for (const [relativePath, expected] of Object.entries(manifest.hashes)) {
    rootRelativePath(root, relativePath);
    const actual = await hashFile(resolve(root, relativePath));
    if (actual.sha256 !== expected) throw new Error(`${relativePath}: differs from frozen SHA-256`);
  }
  const releaseIndexText = await readFile(resolve(root, RELEASE_QUERY_INDEX_PATH), "utf8");
  const releaseQueryIndex = ReleaseQueryIndexV2Schema.parse(JSON.parse(releaseIndexText));
  const releaseIndexHash = sha256Bytes(releaseIndexText);
  if (releaseIndexHash !== manifest.release_holdout.query_index_sha256) {
    throw new Error(`${RELEASE_QUERY_INDEX_PATH}: does not match manifest release holdout hash`);
  }
  return { manifest, manifestSha256: sha256Bytes(manifestText), releaseQueryIndex };
}

function validateTransition(entries: ReleaseRunLedgerEntryV2[], options: RecordReleaseRunOptions): void {
  const runEntries = entries.filter(entry => entry.run_id === options.runId);
  if (options.phase === "started") {
    if (runEntries.length > 0) throw new Error(`${options.runId}: run_id already exists in release ledger`);
    return;
  }
  const started = runEntries.filter(entry => entry.phase === "started");
  const terminal = runEntries.filter(entry => entry.phase !== "started");
  if (started.length !== 1) throw new Error(`${options.runId}: terminal event requires exactly one prior started event`);
  if (terminal.length > 0) throw new Error(`${options.runId}: release run already has a terminal event`);
  if (started[0]!.purpose !== options.purpose) throw new Error(`${options.runId}: purpose differs from started event`);
}

/**
 * Appends one plain log entry. There is intentionally no update/delete API — append-only, but not
 * hash-chained or lock-serialized at MVP scope (see file header).
 */
export async function recordReleaseRunEvent(options: RecordReleaseRunOptions): Promise<ReleaseRunLedgerEntryV2> {
  if (options.phase === "completed" && !options.reportPath) throw new Error("completed event requires --report");
  if (options.phase === "failed" && !options.failureReason) throw new Error("failed event requires --failure-reason");
  if (options.phase !== "completed" && options.reportPath) throw new Error("--report is valid only for completed events");
  if (options.phase !== "failed" && options.failureReason) throw new Error("--failure-reason is valid only for failed events");

  const root = resolve(options.root);
  const ledgerPath = resolve(root, options.ledgerPath ?? RELEASE_RUN_LEDGER_PATH);
  rootRelativePath(root, ledgerPath);
  await mkdir(dirname(ledgerPath), { recursive: true });

  const frozen = await verifyFrozenDataset(root);
  const entries = await readReleaseRunLedger(ledgerPath, root);
  validateTransition(entries, options);
  const started = entries.find(entry => entry.run_id === options.runId && entry.phase === "started");
  if (started && started.dataset_manifest_sha256 !== frozen.manifestSha256) {
    throw new Error(`${options.runId}: frozen manifest differs from the started event`);
  }
  let report: ReleaseRunLedgerEntryV2["report"] = null;
  if (options.reportPath) {
    const path = rootRelativePath(root, options.reportPath);
    const expectedVersionedPath = versionedReleaseReportPath(options.runId, options.purpose);
    const expectedPrimaryPath = releaseReportCompletionPath(options.runId, options.purpose);
    if (path !== expectedPrimaryPath) {
      throw new Error(
        `${options.runId}: ${options.purpose} completion must use --report ${expectedPrimaryPath}`,
      );
    }
    const [primary, versioned] = await Promise.all([
      hashFile(resolve(root, path)),
      hashFile(resolve(root, expectedVersionedPath)),
    ]);
    if (primary.sha256 !== versioned.sha256) {
      throw new Error(`${options.runId}: canonical and immutable release report bytes differ`);
    }
    report = {
      path,
      sha256: primary.sha256,
      versioned_path: expectedVersionedPath,
      versioned_sha256: versioned.sha256,
    };
  }
  const entry = ReleaseRunLedgerEntryV2Schema.parse({
    recorded_at: options.recordedAt ?? new Date().toISOString(),
    phase: options.phase,
    run_id: options.runId,
    purpose: options.purpose,
    actor: options.actor,
    reason: options.reason,
    dataset_manifest_path: DATASET_MANIFEST_PATH,
    dataset_manifest_sha256: frozen.manifestSha256,
    release_query_index_sha256: frozen.manifest.release_holdout.query_index_sha256,
    report,
    failure_reason: options.failureReason ?? null,
  });
  await appendFile(ledgerPath, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  return entry;
}

type ReleaseLedgerCliOptions = RecordReleaseRunOptions;

export function parseReleaseRunLedgerArgs(argv: string[]): ReleaseLedgerCliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]!;
    if (!flag.startsWith("--")) throw new Error(`unexpected argument: ${flag}`);
    const value = argv[++index];
    if (!value) throw new Error(`${flag} requires a value`);
    values.set(flag, value);
  }
  const required = (flag: string): string => {
    const value = values.get(flag);
    if (!value) throw new Error(`missing ${flag}`);
    return value;
  };
  const phase = z.enum(RELEASE_RUN_PHASES).parse(required("--phase"));
  const purpose = z.enum(RELEASE_RUN_PURPOSES).parse(required("--purpose"));
  const known = new Set([
    "--root", "--phase", "--run-id", "--purpose", "--actor", "--reason",
    "--report", "--failure-reason", "--recorded-at",
  ]);
  for (const flag of values.keys()) if (!known.has(flag)) throw new Error(`unknown argument: ${flag}`);
  const root = values.get("--root") ?? resolve(import.meta.dirname, "../..");
  return {
    root,
    phase,
    runId: required("--run-id"),
    purpose,
    actor: required("--actor"),
    reason: required("--reason"),
    ...(values.has("--report") ? { reportPath: values.get("--report")! } : {}),
    ...(values.has("--failure-reason") ? { failureReason: values.get("--failure-reason")! } : {}),
    ...(values.has("--recorded-at") ? { recordedAt: values.get("--recorded-at")! } : {}),
  };
}

export async function runReleaseRunLedgerCli(argv: string[]): Promise<void> {
  const options = parseReleaseRunLedgerArgs(argv);
  const entry = await recordReleaseRunEvent(options);
  console.log(`release holdout ${entry.phase}: ${entry.run_id} (${entry.recorded_at})`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runReleaseRunLedgerCli(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
