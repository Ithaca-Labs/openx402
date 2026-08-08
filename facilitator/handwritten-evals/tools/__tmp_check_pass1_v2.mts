import { readFile } from "node:fs/promises";
import { validatePass1SeedImport, Pass1SeedManifestSchema } from "./query-pass1.js";
const manifestPath = "/home/soumy/.claude/jobs/6e0348e9/tmp/pass1-sealed/manifest.json";
const manifest = Pass1SeedManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
const target = process.argv[2];
const imported = JSON.parse(await readFile(target, "utf8"));
try {
  validatePass1SeedImport(imported, manifest);
  console.log(`OK: ${target}`);
} catch (error) {
  console.error(`FAIL: ${target}`, error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
