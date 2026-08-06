/**
 * Step 3 merge/validation — BUILD-PLAN §9 step 3, §11 gates.
 *
 * Reads all `staging/resources/run-resources-NN/{wire,sidecar}.jsonl` shards, validates every
 * record against the real v2 schema, cross-checks sidecar against wire, checks pairwise axis
 * differentiation within each family, checks MCP tuple uniqueness, and checks the intentional
 * `duplicate_provider` exception. Writes `catalog/catalog-v2.jsonl` and `catalog/sidecar-v2.jsonl`
 * only if everything passes. This script performs no authoring — syntax and cross-record
 * consistency only.
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  axisDifferences,
  CatalogRecordSchema,
  checkSidecarAgainstWire,
  FAMILY_COUNT,
  MIN_AXIS_DIFFERENCES,
  RESOURCES_PER_FAMILY,
  SidecarRecordSchema,
  type Axes,
  type CatalogRecord,
  type SidecarRecord,
} from "../schema/schema-v2.js";

const ROOT = resolve(import.meta.dirname, "..");
const STAGING = resolve(ROOT, "staging/resources");
const CATALOG_DIR = resolve(ROOT, "catalog");

let errors: string[] = [];

function fail(message: string): void {
  errors.push(message);
}

async function loadJsonl(path: string): Promise<unknown[]> {
  const text = await readFile(path, "utf8");
  return text
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        fail(`${path}:${index + 1}: invalid JSON — ${(error as Error).message}`);
        return null;
      }
    })
    .filter(value => value !== null);
}

async function main(): Promise<void> {
  const runDirs = (await readdir(STAGING, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();

  const catalogRecords: CatalogRecord[] = [];
  const sidecarRecords: SidecarRecord[] = [];

  for (const run of runDirs) {
    const wireRaw = await loadJsonl(resolve(STAGING, run, "wire.jsonl"));
    const sidecarRaw = await loadJsonl(resolve(STAGING, run, "sidecar.jsonl"));

    if (wireRaw.length !== 10) fail(`${run}: expected 10 wire records, got ${wireRaw.length}`);
    if (sidecarRaw.length !== 10) fail(`${run}: expected 10 sidecar records, got ${sidecarRaw.length}`);

    for (const raw of wireRaw) {
      const parsed = CatalogRecordSchema.safeParse(raw);
      if (!parsed.success) {
        fail(`${run} wire ${(raw as { resource_id?: string })?.resource_id ?? "?"}: ${parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
        continue;
      }
      catalogRecords.push(parsed.data);
    }

    for (const raw of sidecarRaw) {
      const parsed = SidecarRecordSchema.safeParse(raw);
      if (!parsed.success) {
        fail(`${run} sidecar ${(raw as { resource_id?: string })?.resource_id ?? "?"}: ${parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
        continue;
      }
      sidecarRecords.push(parsed.data);
    }
  }

  // --- resource_id uniqueness and count -----------------------------------------------------
  const catalogIds = catalogRecords.map(r => r.resource_id);
  const sidecarIds = sidecarRecords.map(r => r.resource_id);
  const dupCatalog = catalogIds.filter((id, i) => catalogIds.indexOf(id) !== i);
  const dupSidecar = sidecarIds.filter((id, i) => sidecarIds.indexOf(id) !== i);
  if (dupCatalog.length > 0) fail(`duplicate resource_id in catalog: ${[...new Set(dupCatalog)].join(", ")}`);
  if (dupSidecar.length > 0) fail(`duplicate resource_id in sidecar: ${[...new Set(dupSidecar)].join(", ")}`);
  if (catalogRecords.length !== 100) fail(`expected 100 catalog records, got ${catalogRecords.length}`);
  if (sidecarRecords.length !== 100) fail(`expected 100 sidecar records, got ${sidecarRecords.length}`);

  const expectedIds = Array.from({ length: 100 }, (_, i) => `res-${String(i + 1).padStart(4, "0")}`);
  for (const id of expectedIds) {
    if (!catalogIds.includes(id)) fail(`missing catalog record ${id}`);
    if (!sidecarIds.includes(id)) fail(`missing sidecar record ${id}`);
  }

  // --- sidecar vs wire cross-check ----------------------------------------------------------
  const catalogById = new Map(catalogRecords.map(r => [r.resource_id, r]));
  for (const sidecar of sidecarRecords) {
    const wire = catalogById.get(sidecar.resource_id);
    if (!wire) continue;
    for (const error of checkSidecarAgainstWire(sidecar, wire.wire)) fail(error);
  }

  // --- family/slot coverage and pairwise axis differentiation (§3, §11) --------------------
  for (let family = 1; family <= FAMILY_COUNT; family++) {
    const members = sidecarRecords
      .filter(r => r.family === family)
      .sort((a, b) => (a.family_slot ?? 0) - (b.family_slot ?? 0));
    if (members.length !== RESOURCES_PER_FAMILY) {
      fail(`family ${family}: expected ${RESOURCES_PER_FAMILY} labeled resources, got ${members.length}`);
      continue;
    }
    const slots = members.map(m => m.family_slot);
    if (new Set(slots).size !== RESOURCES_PER_FAMILY) fail(`family ${family}: duplicate family_slot values`);

    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i]!.axes as Axes | undefined;
        const b = members[j]!.axes as Axes | undefined;
        if (!a || !b) continue;
        const diffs = axisDifferences(a, b);
        if (diffs.length < MIN_AXIS_DIFFERENCES) {
          fail(
            `family ${family} slots ${members[i]!.family_slot}/${members[j]!.family_slot} ` +
            `(${members[i]!.resource_id}/${members[j]!.resource_id}): only ${diffs.length} axis diff(s) [${diffs.join(",")}], need >=${MIN_AXIS_DIFFERENCES}`,
          );
        }
      }
    }
  }

  // --- MCP tuple uniqueness across all 15 slots (§4) -----------------------------------------
  const mcpRecords = sidecarRecords.filter(r => r.resource_type === "mcp");
  if (mcpRecords.length !== 15) fail(`expected 15 MCP resources, got ${mcpRecords.length}`);
  const tuples = mcpRecords.map(r => `${r.mcp?.server_name}::${r.mcp?.tool_name}`);
  const dupTuples = tuples.filter((t, i) => tuples.indexOf(t) !== i);
  if (dupTuples.length > 0) fail(`duplicate MCP (server_name, tool_name) tuple: ${[...new Set(dupTuples)].join(", ")}`);
  const mcpFamilies = new Set(mcpRecords.map(r => r.family));
  if (mcpFamilies.size < 8) fail(`MCP spread across only ${mcpFamilies.size} families, need >=8`);

  // --- adversarial coverage (§4, §11) --------------------------------------------------------
  const adversarial = sidecarRecords.filter(r => r.adversarial_kind !== null);
  const distinctKinds = new Set(adversarial.map(r => r.adversarial_kind));
  if (adversarial.length < 14 || adversarial.length > 16) fail(`adversarial count ${adversarial.length}, expected ~15`);
  if (distinctKinds.size < 6) fail(`only ${distinctKinds.size} distinct adversarial kinds, need >=6`);

  // --- sparse coverage --------------------------------------------------------------------
  const sparse = sidecarRecords.filter(r => r.is_sparse);
  if (sparse.length < 9 || sparse.length > 11) fail(`sparse count ${sparse.length}, expected ~10`);

  // --- duplicate_provider exception: res-0078 must share provider_id with an honest resource ---
  const dupProviderTrap = sidecarRecords.find(r => r.adversarial_kind === "duplicate_provider");
  if (dupProviderTrap) {
    const sharedWith = sidecarRecords.filter(
      r => r.provider_id === dupProviderTrap.provider_id && r.resource_id !== dupProviderTrap.resource_id,
    );
    if (sharedWith.length === 0) {
      fail(`${dupProviderTrap.resource_id}: duplicate_provider trap does not actually share provider_id ${dupProviderTrap.provider_id} with any other resource`);
    }
  } else {
    fail("no resource carries adversarial_kind duplicate_provider");
  }

  // --- scheme/network distribution sanity (§4) ------------------------------------------------
  const schemeCounts = { exact_only: 0, exact_and_upto: 0, upto_only: 0 };
  for (const r of sidecarRecords) {
    if (r.axes) schemeCounts[r.axes.scheme_set] += 1;
  }
  console.log(`scheme distribution: exact_only=${schemeCounts.exact_only} exact_and_upto=${schemeCounts.exact_and_upto} upto_only=${schemeCounts.upto_only} (target 70/22/8)`);

  const httpCount = sidecarRecords.filter(r => r.resource_type === "http").length;
  const mcpCount = sidecarRecords.filter(r => r.resource_type === "mcp").length;
  console.log(`resource_type distribution: http=${httpCount} mcp=${mcpCount} (target 85/15)`);

  if (errors.length > 0) {
    console.error(`\n${errors.length} validation failure(s):\n`);
    for (const error of errors) console.error(`  FAIL  ${error}`);
    process.exit(1);
  }

  catalogRecords.sort((a, b) => a.resource_id.localeCompare(b.resource_id));
  sidecarRecords.sort((a, b) => a.resource_id.localeCompare(b.resource_id));

  await writeFile(
    resolve(CATALOG_DIR, "catalog-v2.jsonl"),
    catalogRecords.map(r => JSON.stringify(r)).join("\n") + "\n",
  );
  await writeFile(
    resolve(CATALOG_DIR, "sidecar-v2.jsonl"),
    sidecarRecords.map(r => JSON.stringify(r)).join("\n") + "\n",
  );

  console.log(`\nmerged ${catalogRecords.length} labeled resources into catalog/catalog-v2.jsonl and catalog/sidecar-v2.jsonl`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
