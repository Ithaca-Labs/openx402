# Task pack: author distractor resources — shared protocol

You are one isolated authoring agent for Step 4 of the Stellar Bazaar v2 search benchmark. Your
prompt assigns exactly 10 resource ids, one run id, one shard id, one staging directory, provider
ids, and the one allowed `upto` exception if your shard has one.

Distractors are unjudged corpus padding, not judged-irrelevant records. Each listing may be useful,
specific, and professionally written. It is a distractor only because its capability satisfies
none of the 20 `spec/families.md` in-scope definitions. Topical proximity is welcome; actual
capability overlap is forbidden.

## Required reading and isolation

Before writing, read this file, `../forbidden-capabilities.md`, `spec/families.md`, and
`schema/schema-v2.ts`'s `WireSchema`, `CatalogRecordSchema`, and `SidecarRecordSchema`. Treat them as
the frozen task pack.

- Do not read any other directory under `staging/`, including any distractor or resource output.
- Do not read `catalog/`, `queries/`, `qrels/`, retrieval runs, or ranking code.
- Do not reuse an earlier wave's context. Each wave uses ten fresh contexts; discard the context
  after this shard. Never read another wave's prompt or output.
- Write only to the exact `staging/distractors/<run-id>/` directory in your assignment.
- Do not grade, query, merge, or review the records.

## Hard anti-template rule

Design each of your 10 listings independently. Do not start from one shared listing and change
names, locations, prices, paths, or adjectives. Do not use repeated sentence frames, parallel tag
sets, numbered brand names, or a common request/response schema. No two records in your shard may
be near-duplicates or variants of the same topic. The v1 failure `CDP-shaped weather 001` through
`030` is the reason this is a release-blocking constraint.

Use ten genuinely different real-world topic areas. Creative choice belongs to you, but every
choice must pass both tests before authoring: it is outside every family in `spec/families.md`, and
it is outside every forbidden capability below. A plausible listing that provides even one
family's in-scope capability is mislabeled and must be replaced.

## Licensing and fixture status

Write original prose and original schemas. Do not copy or lightly rewrite CDP marketplace prose,
tags, endpoint names, or request/response schemas. Derive only general marketplace conventions.
These are benchmark fixtures, not live services: `is_live: false` and
`settlement_verified: false`; never claim an endpoint is real or reachable.

## Output

Write exactly two JSONL files, 10 single-line JSON objects each, in the assigned directory:

- `wire.jsonl`: `CatalogRecordSchema` records `{resource_id, wire}` in resource-id order.
- `sidecar.jsonl`: matching `SidecarRecordSchema` records in the same order.

No comments, blank records, arrays around the records, trailing commas, or pretty-printed objects.

## Chosen distractor distributions

- **Resource type: HTTP only.** This package deliberately chooses all 900 distractors as
  `resource_type: "http"`, because all 14,669 sampled live listings were HTTP. Do not create MCP
  distractors and never include an `mcp` key.
- **Scheme: 891 exact-only, 9 exact+upto.** Every distractor is exact-only except these fixed,
  irregularly spread ids: `res-0147`, `res-0189`, `res-0358`, `res-0416`, `res-0493`, `res-0642`,
  `res-0788`, `res-0917`, `res-0994`. Those nine must carry both one `exact` and one `upto` option.
  No other distractor may carry `upto`. This is 99% exact-only and avoids an author-selected
  pattern.
- **Sparse/adversarial: none.** Set `is_sparse: false`, include substantive original copy, and set
  `adversarial_kind: null`. Distractors are not planted grade-0 traps.

## Provider policy

Provider assignment is deterministic and requires no cross-wave coordination. For numeric resource
id `N`, use provider number `((N - 1) mod 120) + 1`, zero-padded to three digits. Thus `res-0101`
uses `provider-101`, `res-0120` uses `provider-120`, `res-0121` uses `provider-001`, and
`res-1000` uses `provider-040`. The prompt enumerates all 10 mappings; copy them exactly.

The wire hostname must use that same provider id:
`https://provider-XXX.stellar-bazaar.example/<original-path>`. Reuse of a provider across unrelated
listings means a marketplace seller has multiple products; it is not permission to clone prose.

## Wire record shape

```json
{
  "resource_id": "res-0101",
  "wire": {
    "x402Version": 2,
    "resource": {
      "url": "https://provider-101.stellar-bazaar.example/<original-path>",
      "serviceName": "32 characters maximum",
      "description": "original buyer-facing description, 4000 characters maximum",
      "tags": ["one-to-five", "specific", "tags"],
      "mimeType": "application/json"
    },
    "accepts": [],
    "extensions": { "bazaar": {} }
  }
}
```

Hostname must end in `.example`. `serviceName` is at most 32 characters; tags are at most five,
each at most 32 characters. `mimeType` is optional and should describe the actual response. Do not
invent Bazaar extension schemas: use exactly `{ "bazaar": {} }`.

### Payment entries

Every `accepts` entry has this exact structure:

```json
{
  "scheme": "exact",
  "network": "stellar:testnet",
  "asset": "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  "amount": "20000",
  "payTo": "GAOH2NR3A3R2VS6TUE6L75A3OMJ4UKJWEHHNL5GIIEQTS5RVZEK5LAP4",
  "maxTimeoutSeconds": 60,
  "extra": { "areFeesSponsored": false }
}
```

- Testnet USDC: `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`.
- Pubnet USDC: `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75`.
- Use the exact fixture `payTo` above on every record.
- `amount = price_usd * 10_000_000`, as an integer decimal string. Example: `0.002` USDC is
  `"20000"`; zero is `"0"`.
- Choose prices only from `0`, `0.001`, `0.002`, `0.003`, `0.005`, `0.01`, `0.02`, `0.05`, `0.1`,
  `0.15` USDC.
- Exact-only records use one or two entries, one per chosen network, all with `scheme: "exact"`.
- The nine named exception ids use both `exact` and `upto`; the `upto` amount is a plausible cap
  larger than the exact amount. `accepts` has at most three entries.
- `price_usd_snapshot.value` equals the minimum amount across all options divided by 10,000,000.

## Distractor sidecar shape

The current schema requires the provenance and review fields below. The package additionally
requires that distractors omit `axes` and `mcp`; the merger checks these omissions explicitly.

```json
{
  "resource_id": "res-0101",
  "authorship": "agent",
  "resource_type": "http",
  "is_distractor": true,
  "is_sparse": false,
  "adversarial_kind": null,
  "provider_id": "provider-101",
  "generation": {
    "provider": "anthropic",
    "model": "your exact model identifier or revision",
    "prompt_hash": "the exact hash assigned in your prompt",
    "run_id": "the exact run id assigned in your prompt",
    "shard_id": "the exact shard id assigned in your prompt",
    "temperature": 0.7,
    "generated_at": "actual ISO 8601 UTC generation timestamp"
  },
  "derived_from": {
    "kind": "agent_generated",
    "generation_id": "same value as run_id",
    "rationale": "Name the independently designed capability and explain why it is outside all 20 families and all ten forbidden capabilities."
  },
  "review_status": "pending",
  "reviewed_at": null,
  "owner_note": null,
  "family": null,
  "family_slot": null,
  "category": "specific-topic-slug",
  "is_live": false,
  "settlement_verified": false,
  "asset_decimals": 7,
  "price_usd_snapshot": {
    "value": 0.002,
    "as_of": "same timestamp as generated_at",
    "basis": "fixed_fixture_minimum_option_value"
  }
}
```

`temperature` is optional in the schema; if the run exposes it, record the actual value, otherwise
omit the key. `source_last_updated` is optional and should be omitted for fictional fixtures. Do
not include `axes`, `mcp`, `source_class`, or `adversarial`. `family` and `family_slot` are JSON
`null`, not omitted. `category` is a concise topic slug, not a family label.

## Forbidden capabilities — embedded verbatim

The following is the full frozen content of `forbidden-capabilities.md`. No distractor may provide,
hint at, advertise, tag, or be plausibly mistaken for providing any item. Avoid synonyms and close
substitutes even when they would evade the deterministic signatures.

---

# Forbidden capabilities for Step 4 distractors

These ten capabilities are reserved for the ten Step 5 `no_result` cases. They must be absent from
all distractor metadata and must remain absent from the complete 1,000-record corpus. Authors must
avoid the capability itself, close substitutes, hints, and scanner signatures. Deterministic
matching is a necessary syntax gate; the later independent full-catalog audit remains mandatory.

## FC-01 — Wallet key custody and transaction signing

**Definition.** A service that stores or controls wallet private keys and signs blockchain
transactions or arbitrary wallet payloads on a buyer's behalf.

**Boundary basis.** F13 explicitly excludes generic key management and wallet signing; F1 only
reads chain state, and no other family provides key custody or transaction signing.

**Scanner signatures.** `wallet signing`; `wallet signer`; `transaction signing`; `sign
transaction`; `private key custody`; `key custody`; `custodial key management`.

## FC-02 — Transactional email delivery

**Definition.** An outbound delivery API that sends transactional or bulk email through SMTP or a
managed mail transport.

**Boundary basis.** F20 returns published article feeds and F9 generates text, but neither sends
messages; no family includes email transport or delivery.

**Scanner signatures.** `email delivery`; `send email`; `transactional email`; `outbound email
api`; `smtp relay`; `bulk email`.

## FC-03 — SMS and telephony message delivery

**Definition.** A communications API that sends SMS/text messages or initiates carrier voice calls
to telephone numbers.

**Boundary basis.** F19 analyzes or converts language and F20 exposes article feeds, but no family
delivers messages over telephone networks.

**Scanner signatures.** `sms delivery`; `send sms`; `transactional sms`; `text messaging api`;
`telephony api`; `voice call api`.

## FC-04 — Object storage and file hosting

**Definition.** A managed service that persists, retrieves, hosts, backs up, or restores buyer-owned
files or blobs.

**Boundary basis.** F12 fetches a named public URL and F16 parses supplied documents, but neither
stores or hosts buyer files; no family is a storage service.

**Scanner signatures.** `object storage`; `blob storage`; `file hosting`; `s3 compatible`; `backup
restore`; `managed file storage`.

## FC-05 — Managed relational database queries

**Definition.** A hosted relational database service that executes buyer-supplied SQL or provides
managed PostgreSQL/MySQL data storage.

**Boundary basis.** F1 reads blockchain state and F14 sells precomputed aggregates, while neither
accepts arbitrary SQL or hosts a general relational database; no other family does so.

**Scanner signatures.** `managed sql`; `sql query api`; `execute sql`; `database query api`;
`postgres hosting`; `mysql hosting`; `relational database`.

## FC-06 — Hosted code execution sandbox

**Definition.** A service that compiles or executes buyer-supplied program code inside a hosted or
sandboxed runtime.

**Boundary basis.** F9 may plan tool calls and generate text, but it does not execute programs; none
of the remaining families provides a compiler or general code runtime.

**Scanner signatures.** `code execution`; `execute code`; `run code`; `sandboxed runtime`;
`compiler api`; `code runner`.

## FC-07 — Generative image synthesis

**Definition.** A model endpoint that creates or edits raster images from text prompts, masks, or
reference images.

**Boundary basis.** F11 searches existing images, F16 reads or classifies documents/images, and F9
generates language tokens; none creates or edits images.

**Scanner signatures.** `image generation`; `generate image`; `text to image`; `image synthesis`;
`image editing model`; `diffusion image`.

## FC-08 — Speech-to-text transcription

**Definition.** An audio-processing service that converts spoken audio into a written transcript.

**Boundary basis.** F16 extracts text from documents/images and F19 operates on written language,
but neither accepts speech audio; no family includes automatic speech recognition.

**Scanner signatures.** `speech transcription`; `audio transcription`; `speech to text`;
`automatic speech recognition`; `asr transcription`; `transcribe audio`.

## FC-09 — Text-to-speech synthesis

**Definition.** An audio-generation service that renders written text as synthetic spoken audio or
a selected voice.

**Boundary basis.** F9 generates text and F19 transforms written language, but no family produces
spoken audio or synthetic voices.

**Scanner signatures.** `text to speech`; `speech synthesis`; `synthetic voice`; `voice
generation`; `tts api`; `generate speech`.

## FC-10 — Video transcoding and streaming packaging

**Definition.** A media-processing service that re-encodes uploaded video or packages it into
streaming renditions such as HLS or adaptive-bitrate outputs.

**Boundary basis.** F12 captures web screenshots and F16 processes documents/images, but no family
encodes video or prepares streaming media.

**Scanner signatures.** `video transcoding`; `transcode video`; `video encoding`; `adaptive
bitrate`; `hls packaging`; `streaming rendition`.

## Machine-readable scanner signatures

`tools/merge-distractors.ts` parses the JSON block between the markers below. Keep the human
sections and this block synchronized; the merger fails if ids, names, or signatures differ.

<!-- FORBIDDEN_SIGNATURES_START -->
```json
[
  {"id":"FC-01","name":"Wallet key custody and transaction signing","signatures":["wallet signing","wallet signer","transaction signing","sign transaction","private key custody","key custody","custodial key management"]},
  {"id":"FC-02","name":"Transactional email delivery","signatures":["email delivery","send email","transactional email","outbound email api","smtp relay","bulk email"]},
  {"id":"FC-03","name":"SMS and telephony message delivery","signatures":["sms delivery","send sms","transactional sms","text messaging api","telephony api","voice call api"]},
  {"id":"FC-04","name":"Object storage and file hosting","signatures":["object storage","blob storage","file hosting","s3 compatible","backup restore","managed file storage"]},
  {"id":"FC-05","name":"Managed relational database queries","signatures":["managed sql","sql query api","execute sql","database query api","postgres hosting","mysql hosting","relational database"]},
  {"id":"FC-06","name":"Hosted code execution sandbox","signatures":["code execution","execute code","run code","sandboxed runtime","compiler api","code runner"]},
  {"id":"FC-07","name":"Generative image synthesis","signatures":["image generation","generate image","text to image","image synthesis","image editing model","diffusion image"]},
  {"id":"FC-08","name":"Speech-to-text transcription","signatures":["speech transcription","audio transcription","speech to text","automatic speech recognition","asr transcription","transcribe audio"]},
  {"id":"FC-09","name":"Text-to-speech synthesis","signatures":["text to speech","speech synthesis","synthetic voice","voice generation","tts api","generate speech"]},
  {"id":"FC-10","name":"Video transcoding and streaming packaging","signatures":["video transcoding","transcode video","video encoding","adaptive bitrate","hls packaging","streaming rendition"]}
]
```
<!-- FORBIDDEN_SIGNATURES_END -->

---

## Final self-check

- All 10 topics are genuinely different and independently designed.
- No listing provides any F1-F20 in-scope capability.
- No listing provides, hints at, or resembles FC-01 through FC-10.
- Every provider id and hostname matches the prompt's mapping.
- Only the nine globally named ids contain `upto`; all others are exact-only.
- Every sidecar is HTTP, distractor, non-sparse, non-adversarial, family-null, and has no `axes` or
  `mcp` key.
- All provenance values are actual and match the assigned prompt.
- Both files contain exactly 10 valid single-line JSON records in id order.
