/**
 * Generates the frozen Step 4 task packs: 9 sequential waves × 10 fresh agents × 10 records.
 * This script prepares prompts only. It never launches agents or creates authored records.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import {
  DISTRACTOR_AGENTS_PER_WAVE,
  DISTRACTOR_RECORDS_PER_SHARD,
  DISTRACTOR_UPTO_NUMBERS,
  DISTRACTOR_WAVES,
  FIRST_DISTRACTOR_NUMBER,
  distractorAssignment,
  distractorProviderId,
  distractorResourceId,
  padNumber,
} from "../distractor-config.js";

const STAGING = import.meta.dirname;
const ROOT = resolve(STAGING, "..");
const OUTPUT = resolve(STAGING, "distractor-prompts");
const BRIEF = resolve(STAGING, "BRIEF-distractors.md");
const FORBIDDEN = resolve(ROOT, "forbidden-capabilities.md");

const UPTO_NUMBERS = new Set<number>(DISTRACTOR_UPTO_NUMBERS);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

type ManifestRecord = {
  wave: number;
  agent: number;
  prompt_path: string;
  resource_ids: string[];
  run_id: string;
  shard_id: string;
  prompt_hash: string;
  file_sha256: string;
};

async function main(): Promise<void> {
  const [brief, forbidden, families, schema] = await Promise.all([
    readFile(BRIEF, "utf8"),
    readFile(FORBIDDEN, "utf8"),
    readFile(resolve(ROOT, "spec/families.md"), "utf8"),
    readFile(resolve(ROOT, "schema/schema-v2.ts"), "utf8"),
  ]);
  const sharedPackHash = sha256(`${brief}\0${forbidden}\0${families}\0${schema}`);
  const manifest: ManifestRecord[] = [];

  for (let wave = 1; wave <= DISTRACTOR_WAVES; wave++) {
    const waveDirectory = resolve(OUTPUT, `wave-${padNumber(wave, 2)}`);
    await mkdir(waveDirectory, { recursive: true });

    for (let agent = 1; agent <= DISTRACTOR_AGENTS_PER_WAVE; agent++) {
      const globalShard = (wave - 1) * DISTRACTOR_AGENTS_PER_WAVE + agent;
      const start = FIRST_DISTRACTOR_NUMBER + (globalShard - 1) * DISTRACTOR_RECORDS_PER_SHARD;
      const numbers = Array.from({ length: DISTRACTOR_RECORDS_PER_SHARD }, (_, index) => start + index);
      const ids = numbers.map(distractorResourceId);
      const exampleProvider = distractorProviderId(numbers[0]!);
      const { runId, shardId } = distractorAssignment(start);
      const outputDirectory = `staging/distractors/${runId}/`;
      const upto = numbers.filter(number => UPTO_NUMBERS.has(number)).map(distractorResourceId);
      const assignment = numbers
        .map(number => `| \`${distractorResourceId(number)}\` | \`${distractorProviderId(number)}\` | ${UPTO_NUMBERS.has(number) ? "exact + upto" : "exact only"} |`)
        .join("\n");
      const hashBasis = JSON.stringify({
        shared_pack_sha256: sharedPackHash,
        wave,
        agent,
        resource_ids: ids,
        provider_ids: numbers.map(distractorProviderId),
        run_id: runId,
        shard_id: shardId,
        output_directory: outputDirectory,
        upto_ids: upto,
      });
      const promptHash = `sha256:${sha256(hashBasis)}`;
      const waveDispatchRule = wave === 1
        ? "This is the first wave; start it only with ten fresh contexts."
        : `Dispatch wave ${wave} only after every wave ${wave - 1} context has been discarded.`;

      const prompt = `# Step 4 distractor authoring — wave ${wave}, agent ${agent}

You are one fresh, isolated authoring context in wave ${wave} of 9. Author exactly 10 original HTTP
distractor listings for Stellar Bazaar v2. This prompt prepares corpus records only; do not create
queries, qrels, judgments, reviews, or merged catalog files.

## Frozen inputs

Read these files in full before writing:

1. \`handwritten-evals/staging/BRIEF-distractors.md\`
2. \`handwritten-evals/forbidden-capabilities.md\`
3. \`handwritten-evals/spec/families.md\`
4. The wire/catalog/sidecar schemas in \`handwritten-evals/schema/schema-v2.ts\`

Do not read any other path under \`handwritten-evals/staging/\`, including sibling shards, labeled
resource shards, other waves, or their prompts. Do not read the merged catalog, queries, qrels,
retrieval output, ranking code, or another author's work.

${waveDispatchRule}
This context is new for this wave and must be discarded after this shard. Do not preserve a
template for any later wave.

## Exact assignment

- Run id: \`${runId}\`
- Shard id: \`${shardId}\`
- Prompt/task-pack hash: \`${promptHash}\`
- Output directory: \`handwritten-evals/${outputDirectory}\`
- Wire output: \`wire.jsonl\`, exactly 10 lines in id order
- Sidecar output: \`sidecar.jsonl\`, exactly 10 lines in id order

Use the following ids, providers, and scheme assignments exactly:

| resource_id | provider_id and hostname prefix | payment schemes |
|---|---|---|
${assignment}

${upto.length > 0
  ? `Only ${upto.map(id => `\`${id}\``).join(", ")} in this shard may contain an \`upto\` option. Every named exception must contain both \`exact\` and \`upto\`; all other records are exact-only.`
  : "No record in this shard may contain an `upto` option. All 10 are exact-only."}

The hostname for each record is its assigned provider followed by
\`.stellar-bazaar.example\`. For this shard's first record, \`${exampleProvider}\`, the URL begins
\`https://${exampleProvider}.stellar-bazaar.example/\`.

## Meaning and originality requirements

Choose the ten topic areas yourself. They are intentionally not prescribed per slot. Each must be
a plausible, buyer-useful marketplace listing while satisfying none of the 20 family in-scope
definitions and none of FC-01 through FC-10. Topical proximity is allowed; capability overlap is
not. If a reasonable grader could call a listing relevant to any labeled family, replace it.

The ten topic areas must be genuinely different from one another. Do not create variants by
changing names, locations, prices, paths, or adjectives in a shared design. Do not reuse sentence
frames, tag sets, brands with numeric suffixes, or request/response schemas. The v1
\`CDP-shaped weather 001\` through \`030\` pattern is explicitly forbidden.

Write original prose and schemas. Do not copy or lightly rewrite CDP marketplace material.

## Non-negotiable record rules

- Every sidecar uses \`authorship: "agent"\`, \`resource_type: "http"\`,
  \`is_distractor: true\`, \`is_sparse: false\`, \`adversarial_kind: null\`,
  \`family: null\`, and \`family_slot: null\`.
- Omit \`axes\`, \`mcp\`, \`source_class\`, and \`adversarial\` keys.
- Use \`generation.provider: "anthropic"\`; record the actual exact model/revision and actual
  generation timestamp; use the run id, shard id, and prompt hash above exactly.
- Use \`derived_from.kind: "agent_generated"\`, \`generation_id: "${runId}"\`, and a real
  rationale explaining the independent capability and why it is outside all families and forbidden
  capabilities.
- Use \`review_status: "pending"\`, \`reviewed_at: null\`, and \`owner_note: null\`.
- Use \`is_live: false\`, \`settlement_verified: false\`, \`asset_decimals: 7\`, and the fixed
  snapshot basis from the brief.
- Use only the fixed Stellar USDC assets and fixture \`payTo\` from the brief. Compute stroop
  amounts exactly and make the snapshot value equal the minimum payment option.
- Include substantive, independently written service names, descriptions, and tags. Use
  \`.example\` URLs and \`{ "bazaar": {} }\` only.
- Do not provide, hint at, tag, or resemble any forbidden capability, including synonyms that are
  not in the deterministic signature list.

Before finishing, parse both JSONL files, confirm exactly 10 matching ids, re-read all prose against
the 20 family boundaries and ten forbidden capabilities, and verify no two records in the shard are
near-duplicates. Stop after writing this shard; do not inspect or launch any other agent.
`;

      const promptPath = resolve(waveDirectory, `agent-${padNumber(agent, 2)}.md`);
      await writeFile(promptPath, prompt);
      manifest.push({
        wave,
        agent,
        prompt_path: relative(STAGING, promptPath),
        resource_ids: ids,
        run_id: runId,
        shard_id: shardId,
        prompt_hash: promptHash,
        file_sha256: sha256(prompt),
      });
    }
  }

  const manifestText = `${manifest.map(record => JSON.stringify(record)).join("\n")}\n`;
  await writeFile(resolve(OUTPUT, "manifest.jsonl"), manifestText);
  await writeFile(
    resolve(OUTPUT, "SHA256SUMS"),
    `${manifest.map(record => `${record.file_sha256}  ${record.prompt_path}`).join("\n")}\n`,
  );
  await writeFile(
    resolve(OUTPUT, "README.md"),
    `# Step 4 distractor prompts\n\nGenerated by \`../generate-distractor-prompts.ts\`. Dispatch waves 01-09 sequentially. Within each wave, run its ten prompts in fresh contexts, then discard all ten contexts before starting the next wave. Never give an author another prompt or any shard output.\n\nPrompt count: ${manifest.length}. Resource coverage: \`res-0101\` through \`res-1000\`.\n`,
  );

  console.log(
    `generated ${manifest.length} prompts covering ` +
    `${distractorResourceId(FIRST_DISTRACTOR_NUMBER)}-` +
    `${distractorResourceId(FIRST_DISTRACTOR_NUMBER + manifest.length * DISTRACTOR_RECORDS_PER_SHARD - 1)}`,
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
