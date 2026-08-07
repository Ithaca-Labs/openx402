/** Generates isolated Step 5 query-authoring prompts. Never launches agents. */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { QUERY_AGENTS, QUERY_ASSIGNMENTS, QUERIES_PER_AGENT } from "../query-config.js";

const STAGING = import.meta.dirname;
const ROOT = resolve(STAGING, "..");
const OUTPUT = resolve(STAGING, "query-prompts");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function json(value: unknown): string { return JSON.stringify(value); }

async function main(): Promise<void> {
  const [brief, families, forbidden, schema] = await Promise.all([
    readFile(resolve(STAGING, "BRIEF-queries.md"), "utf8"),
    readFile(resolve(ROOT, "spec/families.md"), "utf8"),
    readFile(resolve(ROOT, "forbidden-capabilities.md"), "utf8"),
    readFile(resolve(ROOT, "schema/schema-v2.ts"), "utf8"),
  ]);
  const sharedHash = sha256(`${brief}\0${families}\0${forbidden}\0${schema}`);
  await mkdir(OUTPUT, { recursive: true });
  const manifest: unknown[] = [];

  for (let agent = 1; agent <= QUERY_AGENTS; agent += 1) {
    const assignments = QUERY_ASSIGNMENTS.filter(item => item.agent === agent);
    if (assignments.length !== QUERIES_PER_AGENT) throw new Error(`agent ${agent}: assignment count`);
    const runId = assignments[0]!.runId;
    const shardId = assignments[0]!.shardId;
    const hashBasis = JSON.stringify({ sharedHash, agent, runId, shardId, assignments });
    const promptHash = `sha256:${sha256(hashBasis)}`;
    const rows = assignments.map(item => [
      item.queryId, item.split, item.queryClass, item.phrasingRegister,
      item.family === null ? "null" : `F${item.family} — ${item.familyName}`,
      item.capability, json(item.filters), json(item.evaluationConstraints),
      item.mcpSubtype ?? "—", item.mcpBrief ?? "—", item.forbiddenId ?? "—",
      item.forbiddenCapability ?? "—", item.trap ?? "—",
    ].map(value => `| ${String(value).replaceAll("|", "\\|")} `).join("") + "|").join("\n");
    const prompt = `# Step 5 query authoring — isolated agent ${String(agent).padStart(2, "0")}

Author exactly ${QUERIES_PER_AGENT} buyer query records. Do not author resources, query answers, candidates, grades,
qrels, reviews, or retrieval output. This context is fresh; discard it after writing the shard.

Read in full: \`handwritten-evals/staging/BRIEF-queries.md\`,
\`handwritten-evals/spec/families.md\`, \`handwritten-evals/forbidden-capabilities.md\`, and the
\`QueryRecordSchema\` section of \`handwritten-evals/schema/schema-v2.ts\`.

Do not read catalog/sidecar files, resource or distractor shards, sibling query prompts/outputs,
queries, qrels, runs, pool files, retrieval code, or ranking output. The table below is the complete
buyer-use-case task pack; there are no placeholders to resolve elsewhere.

- run_id: \`${runId}\`
- shard_id: \`${shardId}\`
- prompt_hash: \`${promptHash}\`
- output: \`handwritten-evals/staging/queries/${runId}/queries.jsonl\`

Use every table value exactly. \`—\` means omit that optional field. The capability cell is an
authoring brief, not query text. Never expose benchmark metadata in the query.

| id | split | class | register | family | buyer capability | filters | evaluation_constraints | MCP subtype | MCP facts | forbidden id | forbidden_capability | trap |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
${rows}

For every record use provider \`anthropic\`, the actual exact model/revision and timestamp,
\`generation_id: "${runId}"\`, \`review_status: "pending"\`, \`reviewed_at: null\`, and
\`owner_note: null\`. Write a real, specific use-case rationale. For adversarial assignments add a
specific trap rationale. Validate the ${QUERIES_PER_AGENT} JSONL lines, then stop. Never inspect or launch another
authoring context.
`;
    const path = resolve(OUTPUT, `agent-${String(agent).padStart(2, "0")}.md`);
    await writeFile(path, prompt);
    manifest.push({ agent, prompt_path: relative(STAGING, path), query_ids: assignments.map(item => item.queryId),
      run_id: runId, shard_id: shardId, prompt_hash: promptHash, file_sha256: sha256(prompt) });
  }
  await writeFile(resolve(OUTPUT, "manifest.jsonl"), `${manifest.map(item => JSON.stringify(item)).join("\n")}\n`);
  await writeFile(resolve(OUTPUT, "README.md"), `# Step 5 query prompts\n\n${QUERY_AGENTS} isolated prompts, ${QUERIES_PER_AGENT} queries each. Dispatch each in a fresh context and discard it afterward. Never expose catalogs, retrieval output, or sibling work.\n`);
  console.log(`generated ${QUERY_AGENTS} prompts covering qry-001..qry-100`);
}

main().catch(error => { console.error(error); process.exit(1); });
