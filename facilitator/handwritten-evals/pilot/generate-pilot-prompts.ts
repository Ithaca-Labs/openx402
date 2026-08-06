/** Generates concrete Step 1 pilot prompts only. Never launches agents. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = import.meta.dirname;
const OUT = resolve(ROOT, "prompts");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

const roles = [
  { name: "resource-author", run: "pilot-resource-author-01", body: `Author exactly five labeled F1 resources, res-0001..res-0005, one for each frozen capability in order: ledger_entry_lookup, block_header_stream, tx_receipt_lookup, contract_event_log, archive_state_at_ledger. Write staging/resource-author/wire.jsonl and sidecar.jsonl using current CatalogRecordSchema and SidecarRecordSchema, BRIEF-resources.md wire/provenance conventions, and the exact F1 slot axes in spec/families.md. Use providers provider-001..provider-005. Read pilot/forbidden-capabilities.md and provide no outbound email capability. Do not read any pilot sibling output, catalog, queries, qrels, retrieval, or grading artifacts.` },
  { name: "distractor-author", run: "pilot-distractor-author-01", body: `Author exactly ten original HTTP distractors res-0006..res-0015 with providers provider-006..provider-015. Write staging/distractor-author/wire.jsonl and sidecar.jsonl. Follow BRIEF-distractors.md, but use these pilot ids/providers and exact-only payments. Every record must satisfy no family in-scope boundary and must exclude FC-02 per pilot/forbidden-capabilities.md. Ten genuinely different topics; no templates. Do not read any pilot sibling output, catalog, queries, qrels, retrieval, or grading artifacts.` },
  { name: "query-author", run: "pilot-query-author-01", body: `Author exactly six QueryRecordSchema records qry-001..qry-006 in staging/query-author/queries.jsonl. qry-001..qry-005 are capability queries for F1 slots ledger_entry_lookup, block_header_stream, tx_receipt_lookup, contract_event_log, archive_state_at_ledger. qry-006 is a no_result query for exact forbidden_capability \"Transactional email delivery\", family null, expects_no_result true. Use registers terse_agent, verbose_natural, keyword_only, terse_agent, verbose_natural, keyword_only. Read family and forbidden boundaries only. Do not read resources, catalog prose, sibling output, retrieval, qrels, or grades.` },
  { name: "grader-a", run: "pilot-grader-a-01", body: `After deterministic prepare, read only generated/grader-a-pack.json and the rubric in BUILD-PLAN §7. Return generated/grader-a-import.json with one grade and rationale per opaque candidate using the GraderImportSchema contract and your exact run evidence. Do not access source mappings, authors, systems, scores, ranks, grader B, or other pilot output.` },
  { name: "grader-b", run: "pilot-grader-b-01", body: `After deterministic prepare, read only generated/grader-b-pack.json and the rubric in BUILD-PLAN §7. Return generated/grader-b-import.json with one grade and rationale per opaque candidate using the GraderImportSchema contract and your exact run evidence. Do not access source mappings, authors, systems, scores, ranks, grader A, or other pilot output.` },
  { name: "adjudicator", run: "pilot-adjudicator-01", body: `After both grader imports validate, read only generated/adjudicator-pack.json. Resolve every supplied disagreement independently under BUILD-PLAN §7 and return generated/adjudicator-import.json using AdjudicatorImportSchema plus exact run evidence. Do not access source mappings, author identities, systems, ranks, scores, or non-disagreement grades.` },
  { name: "forbidden-auditor", run: "pilot-forbidden-auditor-01", body: `Read only generated/forbidden-audit-pack.json. Audit FC-02 Transactional email delivery against every one of the 15 blinded descriptions. Return generated/forbidden-audit-import.json with an explicit present/absent decision and rationale for all 15 opaque candidates plus exact run evidence. Do not access authors, source ids, queries, systems, rankings, or grades.` },
] as const;

async function main() {
  const [protocol, forbidden] = await Promise.all([readFile(resolve(ROOT, "PILOT-PROTOCOL.md"), "utf8"), readFile(resolve(ROOT, "forbidden-capabilities.md"), "utf8")]);
  await mkdir(OUT, { recursive: true });
  const manifest: unknown[] = [];
  for (const role of roles) {
    const promptHash = `sha256:${sha(`${protocol}\0${forbidden}\0${role.name}\0${role.run}\0${role.body}`)}`;
    const text = `# Pilot ${role.name}\n\nRead pilot/PILOT-PROTOCOL.md in full.\n\nRun id: \`${role.run}\`\nPrompt hash: \`${promptHash}\`\n\n${role.body}\n\nRecord actual model, timestamp, token usage, elapsed seconds, and API cost. Stop after this role.\n`;
    const path = resolve(OUT, `${role.name}.md`);
    await writeFile(path, text);
    manifest.push({ role: role.name, run_id: role.run, prompt_hash: promptHash, prompt_path: `prompts/${role.name}.md`, file_sha256: sha(text) });
  }
  await writeFile(resolve(OUT, "manifest.jsonl"), `${manifest.map(item => JSON.stringify(item)).join("\n")}\n`);
  console.log("generated 7 isolated pilot prompts");
}
main().catch(error => { console.error(error); process.exit(1); });
