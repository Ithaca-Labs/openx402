import { readFile } from "node:fs/promises";
import { UnpooledAuditImportSchema } from "./unpooled-audit.js";

const manifest = JSON.parse(await readFile("/home/soumy/.claude/jobs/6e0348e9/tmp/unpooled-audit-sealed/manifest.json", "utf8"));
const target = process.argv[2];
const raw = JSON.parse(await readFile(target, "utf8"));
const imported = UnpooledAuditImportSchema.parse(raw);
const batch = manifest.batches.find((b: any) => b.pack_id === imported.pack_id);
if (!batch) throw new Error(`unknown pack_id ${imported.pack_id}`);
const expected = new Set(batch.assignments.map((a: any) => `${a.task_id}\0${a.candidate_id}`));
const actual = new Set(imported.judgments.map(j => `${j.task_id}\0${j.candidate_id}`));
if (actual.size !== imported.judgments.length) throw new Error("duplicate judgment in import");
if (expected.size !== actual.size) throw new Error(`expected ${expected.size} judgments, got ${actual.size}`);
for (const key of expected) if (!actual.has(key)) throw new Error(`missing judgment for ${key}`);
for (const key of actual) if (!expected.has(key)) throw new Error(`unexpected judgment for ${key}`);
if (JSON.stringify(imported.auditor) !== JSON.stringify(batch.auditor)) throw new Error("auditor provenance mismatch");
console.log(`OK: ${target} (${imported.judgments.length} judgments, pack ${imported.pack_id})`);
