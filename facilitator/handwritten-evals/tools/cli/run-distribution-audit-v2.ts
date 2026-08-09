#!/usr/bin/env node

/** CLI wrapper for the pure BUILD-PLAN §4/§11 distribution audit. */

import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildDistributionAuditV2 } from "../lib/distribution-audit-v2.js";

async function readJsonl(path: string): Promise<unknown[]> {
  const text = await readFile(path, "utf8");
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line) as unknown];
    } catch (error) {
      throw new Error(`${path}:${index + 1}: invalid JSON: ${(error as Error).message}`);
    }
  });
}

function args(argv: string[]): { root: string; output: string; generatedAt: string } {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("usage: --root PATH --output PATH --generated-at ISO");
    values.set(key, value);
  }
  for (const key of values.keys()) {
    if (!["--root", "--output", "--generated-at"].includes(key)) throw new Error(`unknown argument: ${key}`);
  }
  const root = resolve(values.get("--root") ?? resolve(import.meta.dirname, "../.."));
  return {
    root,
    output: resolve(root, values.get("--output") ?? "reports/distribution-audit-v2.json"),
    generatedAt: values.get("--generated-at") ?? new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const options = args(process.argv.slice(2));
  const [catalog, sidecars] = await Promise.all([
    readJsonl(resolve(options.root, "catalog/catalog-v2.jsonl")),
    readJsonl(resolve(options.root, "catalog/sidecar-v2.jsonl")),
  ]);
  const report = buildDistributionAuditV2(catalog, sidecars, options.generatedAt);
  await mkdir(dirname(options.output), { recursive: true });
  const handle = await open(options.output, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  console.log(`distribution audit: ${report.status}; ${report.checks.filter(check => check.passed).length}/${report.checks.length} checks pass -> ${options.output}`);
  if (report.status !== "pass") process.exitCode = 1;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
