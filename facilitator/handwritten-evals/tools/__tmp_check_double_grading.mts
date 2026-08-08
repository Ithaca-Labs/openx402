import { readFile } from "node:fs/promises";
import { validateDoubleGrading } from "./grading-pipeline.js";

const manifestPath = process.argv[2]!;
const importAPath = process.argv[3]!;
const importBPath = process.argv[4]!;

const [manifest, a, b] = await Promise.all([
  JSON.parse(await readFile(manifestPath, "utf8")),
  JSON.parse(await readFile(importAPath, "utf8")),
  JSON.parse(await readFile(importBPath, "utf8")),
]);

try {
  const result = validateDoubleGrading(a, b, manifest);
  const disagreements = result.pairs.filter(pair => pair.a.grade !== pair.b.grade);
  console.log(`OK: ${result.pairs.length} pairs validated, ${disagreements.length} disagreements`);
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
