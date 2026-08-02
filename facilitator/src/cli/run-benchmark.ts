import { resolve } from "node:path";
import { runEvaluationProgram } from "../search/evaluation/program.js";

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find(value => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const releaseRoot = resolve(flag("release-root") ?? "eval-dataset");
const ecosystemRoot = resolve(flag("ecosystem-root") ?? `${releaseRoot}/ecosystem`);
const judge = flag("judge") ?? "none";
if (judge !== "none" && judge !== "openrouter") throw new Error("--judge must be none or openrouter");
const report = await runEvaluationProgram({
  releaseRoot,
  ecosystemRoot,
  refreshEcosystem: !process.argv.includes("--no-fetch"),
  probeEcosystem: !process.argv.includes("--no-probe"),
  probeLimit: Number(flag("probe-limit") ?? process.env.ECOSYSTEM_PROBE_LIMIT ?? 500),
  judge,
  ...(flag("recommendations") ? { recommendationRun: resolve(flag("recommendations")!) } : {}),
  ...(flag("output") ? { output: resolve(flag("output")!) } : {}),
});
console.log(JSON.stringify(report, null, 2));
