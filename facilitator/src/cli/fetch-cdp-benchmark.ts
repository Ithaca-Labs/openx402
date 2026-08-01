import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { encodeJsonl, seededOrder, sha256 } from "../search/release/io.js";

const SOURCE_URL = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";
const rawItem = z.object({ resource: z.string().url(), type: z.string(), accepts: z.array(z.unknown()), lastUpdated: z.string() }).passthrough();
const pageSchema = z.object({
  items: z.array(rawItem),
  pagination: z.object({ limit: z.number(), offset: z.number(), total: z.number() }),
}).passthrough();

const root = resolve(process.argv[2] ?? "eval-dataset");
const seed = process.env.CDP_SAMPLING_SEED ?? "stellar-bazaar-release-v1";
const pageSize = 1000;
const maxResponseBytes = 32 * 1024 * 1024;

async function fetchPage(offset: number): Promise<{ value: z.infer<typeof pageSchema>; bytes: Uint8Array; metadata: Record<string, string> }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(`${SOURCE_URL}?type=http&limit=${pageSize}&offset=${offset}`, { signal: AbortSignal.timeout(30_000) });
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > maxResponseBytes) throw new Error("CDP page exceeded 32 MiB response limit");
      if (!response.ok) throw new Error(`CDP ${response.status}: ${new TextDecoder().decode(bytes).slice(0, 300)}`);
      return {
        value: pageSchema.parse(JSON.parse(new TextDecoder().decode(bytes))), bytes,
        metadata: Object.fromEntries([...response.headers].filter(([key]) => ["content-type", "etag", "last-modified", "x-request-id"].includes(key))),
      };
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise(resolveWait => setTimeout(resolveWait, Math.min(500 * 2 ** attempt, 8_000)));
    }
  }
  throw lastError;
}

const fetchedAt = new Date().toISOString();
const pages: Array<{ offset: number; count: number; sha256: string; response_metadata: Record<string, string> }> = [];
const unique = new Map<string, z.infer<typeof rawItem>>();
let total = Number.POSITIVE_INFINITY;
for (let offset = 0; offset < total; offset += pageSize) {
  const page = await fetchPage(offset);
  total = page.value.pagination.total;
  pages.push({ offset, count: page.value.items.length, sha256: sha256(page.bytes), response_metadata: page.metadata });
  for (const item of page.value.items) {
    const key = sha256(JSON.stringify({ resource: item.resource, type: item.type }));
    if (!unique.has(key)) unique.set(key, item);
  }
}
const all = [...unique.values()];
const categoryPatterns = {
  weather: /weather|climate|forecast|temperature|rain/i,
  finance: /finance|market|stock|price|trading|forex|economic/i,
  blockchain: /blockchain|onchain|token|wallet|transaction|contract|ethereum|solana|stellar/i,
  identity: /identity|kyc|person|customer|credential|passport/i,
  documents: /document|invoice|receipt|pdf|extract|ocr/i,
  news: /news|headline|article|press|journal/i,
  risk: /risk|fraud|compliance|aml|sanction|security/i,
  language: /language|translate|translation|text|speech/i,
  media: /image|video|audio|photo|media|vision/i,
  logistics: /route|shipping|delivery|logistics|travel|map|location/i,
};
const assigned = new Set<string>();
const sample: z.infer<typeof rawItem>[] = [];
const categoryCounts: Record<string, number> = {};
for (const [category, pattern] of Object.entries(categoryPatterns)) {
  const candidates = all.filter(item => {
    const key = `${item.resource}\0${sha256(JSON.stringify(item))}`;
    if (assigned.has(key)) return false;
    const metadata = item as Record<string, unknown>;
    const searchable = [item.resource, metadata.description, metadata.serviceName, ...(Array.isArray(metadata.tags) ? metadata.tags : [])].filter(Boolean).join(" ");
    return pattern.test(searchable);
  });
  const selected = seededOrder(candidates, `${seed}:${category}`, item => `${item.resource}\0${sha256(JSON.stringify(item))}`).slice(0, 15);
  if (selected.length !== 15) throw new Error(`CDP has only ${selected.length} classifiable ${category} records`);
  for (const item of selected) assigned.add(`${item.resource}\0${sha256(JSON.stringify(item))}`);
  sample.push(...selected); categoryCounts[category] = selected.length;
}
if (sample.length !== 150) throw new Error(`CDP returned only ${sample.length} unique records`);
const raw = encodeJsonl(all);
const sampleText = encodeJsonl(sample);
await mkdir(resolve(root, "raw-generation-output"), { recursive: true });
await mkdir(resolve(root, "manifests"), { recursive: true });
await writeFile(resolve(root, "raw-generation-output/foreign_cdp_reference.jsonl"), raw, { mode: 0o600 });
await writeFile(resolve(root, "raw-generation-output/cdp-sample-v1.jsonl"), sampleText);
await writeFile(resolve(root, "manifests/cdp-fetch-v1.json"), `${JSON.stringify({
  source_url: SOURCE_URL, fetched_at: fetchedAt, sampling_seed: seed, pagination: pages,
  reported_total: total, unique_records: all.length, selected_records: sample.length,
  sample_category_counts: categoryCounts,
  raw_sha256: createHash("sha256").update(raw).digest("hex"), sample_sha256: sha256(sampleText),
  redistribution: "unclear; raw snapshot and sample are gitignored, not Apache-2.0, and are used only to derive category/method shape plus provenance hashes",
}, null, 2)}\n`);
console.log(`Fetched ${all.length} unique CDP records across ${pages.length} pages; deterministically selected 150.`);
