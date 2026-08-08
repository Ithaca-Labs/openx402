import { readFile } from "node:fs/promises";
import { validatePass1SeedImport } from "./query-pass1.js";

const manifest = JSON.parse(await readFile("/home/soumy/.claude/jobs/6e0348e9/tmp/pass1-sealed/manifest.json", "utf8"));
const imported = JSON.parse(await readFile(process.argv[2], "utf8"));
try {
  validatePass1SeedImport(imported, manifest);
  console.log("OK:", process.argv[2]);
} catch (e) {
  console.error("FAIL:", process.argv[2], (e as Error).message);
  process.exitCode = 1;
}
