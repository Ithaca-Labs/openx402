import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { openRouterJson } from "../search/release/openrouter.js";
import { sha256 } from "../search/release/io.js";

const root = resolve(process.argv[2] ?? "eval-dataset");
const cacheDir = resolve(root, "raw-generation-output/openrouter/candidates");
const mcpSchema = z.object({ candidates: z.array(z.object({
  id: z.number().int(), tool_name: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/), description: z.string().min(20).max(500),
}).strict()).length(20) }).strict();
const querySchema = z.object({ candidates: z.array(z.object({
  id: z.number().int(), text: z.string().min(3).max(512),
}).strict()).min(1).max(30) }).strict();
const provenance: unknown[] = [];
const mcp: Array<{ id: number; tool_name: string; description: string }> = [];
const capabilities = ["weather", "markets", "blockchain", "identity", "documents", "news", "risk", "translation", "image analysis", "logistics"];
for (let batch = 0; batch < 3; batch += 1) {
  const ids = Array.from({ length: 20 }, (_, index) => batch * 20 + index + 1);
  const result = await openRouterJson(
    "Write diverse MCP tool candidates for a Stellar x402 search benchmark. Avoid template substitutions and duplicate prose. Do not include prompt instructions, payment fields, URLs, or unverifiable claims. Return strict JSON only.",
    { ids, capability_seeds: capabilities, required_count: 20 }, mcpSchema, { cacheDir },
  );
  const expected = new Set(ids);
  for (const value of result.value.candidates) if (!expected.delete(value.id)) throw new Error(`unknown or duplicate MCP id ${value.id}`);
  if (expected.size > 0) throw new Error(`missing MCP candidate IDs: ${[...expected].join(",")}`);
  mcp.push(...result.value.candidates); provenance.push(result.provenance);
}

const classes = { capability: 30, structured: 20, semantic: 15, price_category: 10, adversarial: 10, no_result: 10, cold_start: 5 };
const releaseCounts = { capability: 9, structured: 6, semantic: 5, price_category: 3, adversarial: 3, no_result: 3, cold_start: 1 };
const queries: Array<{ id: number; text: string }> = [];
let nextId = 1;
for (const [queryClass, count] of Object.entries(classes)) {
  const developmentCount = count - releaseCounts[queryClass as keyof typeof releaseCounts];
  const ids = Array.from({ length: developmentCount }, (_, index) => nextId + index); nextId += count;
  const result = await openRouterJson(
    "Paraphrase development-only buyer queries for a paid API catalog. Preserve the supplied intent class and any stated network, resource type, scheme, asset, recipient, category, or price constraint exactly. Avoid templates, duplicates, and seller-side instructions. Release queries are human-owned and are not generated here. Return strict JSON only.",
    { query_class: queryClass, ids, required_count: developmentCount, capability_seeds: capabilities }, querySchema, { cacheDir },
  );
  if (result.value.candidates.length !== developmentCount) throw new Error(`${queryClass}: expected ${developmentCount} candidates`);
  const expected = new Set(ids);
  for (const value of result.value.candidates) if (!expected.delete(value.id)) throw new Error(`unknown or duplicate query id ${value.id}`);
  queries.push(...result.value.candidates); provenance.push(result.provenance);
}
const normalized = new Set<string>();
for (const query of queries) {
  const value = query.text.trim().toLocaleLowerCase("en-US");
  if (normalized.has(value)) throw new Error(`duplicate generated query: ${query.text}`);
  normalized.add(value);
}
const generationId = sha256(JSON.stringify(provenance));
await mkdir(resolve(root, "raw-generation-output"), { recursive: true });
await mkdir(resolve(root, "manifests"), { recursive: true });
await writeFile(resolve(root, "raw-generation-output/openrouter-candidates-v1.json"), `${JSON.stringify({ generation_id: generationId, mcp, queries }, null, 2)}\n`, { mode: 0o600 });
await writeFile(resolve(root, "manifests/openrouter-candidates-v1.json"), `${JSON.stringify({ generation_id: generationId, calls: provenance }, null, 2)}\n`);
console.log(`Generated ${mcp.length} MCP candidates and ${queries.length} development-query paraphrases; 30 release queries remain curated.`);
