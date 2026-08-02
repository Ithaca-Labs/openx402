# Dependencies and Licensing

Verified: 2026-07-30. This is an architecture allowlist, not a substitute for
the release SBOM. Exact versions and every transitive/runtime component become
certifiable only after lockfiles, model revisions, WASM, and image digests
exist. A release with any unclassified component fails; it is not shipped with a
license caveat.

The project code, seller SDK, examples, and contract will use Apache-2.0.

## Verified reference inputs

| Input | Pinned revision/version | License | Use |
| --- | --- | --- | --- |
| x402 Foundation repository and `@x402/core` | `ee1b148de4a8`, package 2.20.0 | Apache-2.0 ([local license](../x402/LICENSE)) | Protocol, schemas, E2E |
| `@x402/stellar` | 2.20.0 at x402 baseline | Apache-2.0 | Canonical mechanism base |
| Stellar x402 repository | `7a96df856f53` | Apache-2.0 ([local license](../x402-stellar/LICENSE)) | Facilitator patterns/tests |
| `@stellar/stellar-sdk` | 16.0.1 in baseline | Apache-2.0 | XDR, RPC, signing |
| OpenZeppelin Stellar Contracts | `56d6e5b91aed` | MIT ([local license](../stellar-contracts/LICENSE)) | Smart-account/policy patterns |
| x402scan | `fd93913adc2d` | no root license found | Read-only product reference; no source or dependency is copied |

The missing x402scan license is why it is treated strictly as an observed
feature/data reference. No code, schema migration, package, or asset is imported
from it.

OpenZeppelin Relayer and its x402 plugin are excluded. Their AGPL-3.0-or-later
license violates the required dependency policy, independent of technical fit.

## Planned direct runtime dependencies

Exact patch versions are selected and frozen in Phase 0 after compatibility and
transitive review. The candidate projects have these verified declared
licenses:

| Component | Purpose | Declared license | Disposition |
| --- | --- | --- | --- |
| Node.js 22 runtime | Facilitator runtime | MIT plus bundled third-party notices | Allowed only after binary SBOM/notice review |
| Express 5 | HTTP adapter, matching Stellar examples | MIT | Candidate |
| Zod 3.24.2 | Canonical x402 schemas | MIT | Required transitively by `@x402/core` |
| Ajv 8 | Bazaar JSON Schema validation | MIT | Candidate |
| `pg` 8 | PostgreSQL driver | MIT | Candidate |
| PostgreSQL 17 | Sole datastore | PostgreSQL License | Required |
| pgvector | Vector type/HNSW in PostgreSQL | PostgreSQL License ([license](https://github.com/pgvector/pgvector/blob/master/LICENSE)) | Required when semantic search enabled |
| `@huggingface/transformers` 3 | Tokenization/model adapter | Apache-2.0 ([repository](https://github.com/huggingface/transformers.js)) | Optional local semantic profile |
| ONNX Runtime Node | CPU inference | MIT ([license](https://github.com/microsoft/onnxruntime/blob/main/LICENSE)) | Optional local semantic profile |
| Pino 9 | Structured logs | MIT | Candidate |
| prom-client 15 | Prometheus metrics | Apache-2.0 | Candidate |
| OpenTelemetry API/SDK | Optional tracing | Apache-2.0 | Candidate |
| Argon2 | API-key hashing/local keystore KDF | MIT | Candidate |
| YAML 2 | Configuration | ISC | Candidate |
| Soroban SDK | Contract SDK | Apache-2.0 ([Stellar repository listing](https://github.com/stellar)) | Required |

The service avoids an ORM, broker client, Elasticsearch/OpenSearch client,
external vector client, and hosted model SDK. SQL migrations and provider
adapters keep the required dependency graph smaller and easier to audit.

Provider adapters use standard HTTP and are dynamically configured. Optional
hosted services are not required for boot, settlement, or lexical search and
their proprietary SDKs are not linked into the default artifact.

## Model weights

| Model | Immutable release requirement | Declared weight license | Decision |
| --- | --- | --- | --- |
| `BAAI/bge-m3` | pin revision, every file checksum, tokenizer, ONNX export, model card/license | MIT; 1024-dimensional model ([model/ONNX record](https://huggingface.co/BAAI/bge-m3/blob/main/onnx/model.onnx)) | Default local embedding |
| `BAAI/bge-reranker-v2-m3` | pin revision/files/checksums and compatible local export | Apache-2.0 ([model card](https://huggingface.co/BAAI/bge-reranker-v2-m3)) | Optional reranker; off in self-host default |
| NVIDIA Nemotron family | review one named revision, not a family name | Varies | Provider interface only; no bundled/default model |

The current `Nemotron-3-Embed-1B-NVFP4` uses OpenMDW-1.1, not a permissive OSI
license, and a current Nemotron ColEmbed variant uses CC-BY-NC-4.0
([OpenMDW model](https://huggingface.co/nvidia/Nemotron-3-Embed-1B-NVFP4),
[non-commercial model license](https://huggingface.co/nvidia/nemotron-colembed-4b-v2/blob/main/LICENSE)).
Both are denied. "NVIDIA" is never treated as a license classification; a future
operator adapter activates only for a named model/revision independently
approved by the same allowlist.

Model manifests are part of the signed release and include upstream URL,
revision, file list, SHA-256, total size, architecture, dimension, tokenizer,
pooling, normalization, license identifier/text hash, and SBOM relationship.
Remote replacement of a file with the same model name fails checksum validation.

## License policy

The automatic allowlist is limited to permissive OSI licenses approved by
project counsel, initially:

`Apache-2.0`, `MIT`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `0BSD`,
`PostgreSQL`, `Zlib`, `Unicode-3.0`, and compatible public-domain grants.

Denied without exception:

`AGPL-*`, `GPL-*`, `LGPL-*`, `SSPL-*`, `BUSL-*`, Commons Clause,
Elastic License, non-commercial/field-of-use licenses, OpenMDW, unreviewed
custom model licenses, missing/unknown licenses, and dependencies that download
unscanned executable code or weights at runtime.

Dual-licensed components are accepted only when the lock/SBOM records an allowed
choice and notices satisfy it. A permissive top-level package does not excuse a
denied bundled binary or transitive package.

## Container and build path

Application dependencies are not the entire distribution. CI scans:

- npm and Cargo production and build lockfiles;
- Soroban WASM constituent crates;
- Node, ONNX, native addons, and their third-party notices;
- the facilitator and PostgreSQL/pgvector runtime filesystem packages;
- model/tokenizer/config files;
- migration and helper binaries;
- Compose images and their base layers.

Published runtime images are minimal, digest-pinned, and contain no package
manager or shell. The build targets musl/permissively licensed runtime
components and copies only the required artifacts into the final image. A
standard distro image that introduces a denied runtime package is not used just
because it is convenient. PostgreSQL/pgvector receives the same treatment.

Build tools are inventoried separately. Compiler runtime exceptions and
generated-output terms are reviewed and recorded; an unapproved build tool
cannot silently become a runtime artifact.

## Release gates

For every release, CI:

1. resolves immutable npm/Cargo locks and disallows git branches or floating
   model revisions;
2. generates SPDX JSON and CycloneDX SBOMs for source, WASM, each image, and
   model bundle;
3. scans license metadata and actual license/notice files;
4. rejects denied, unknown, missing, or changed licenses;
5. compares the dependency graph and model file list to the reviewed baseline;
6. performs vulnerability and provenance checks independently of licensing;
7. attaches license texts/notices, SBOMs, checksums, and signed attestations to
   the release;
8. verifies the clean, offline installation uses exactly those artifacts.

A human reviewer resolves metadata ambiguity by reading the upstream license;
adding an allowlist override requires a recorded legal rationale and cannot
override the explicit denied families.

## Architecture status

The references, proposed direct projects, and two default BAAI model licenses
above are verified. There is intentionally no claim that a not-yet-created
lockfile has fully reviewed transitives. Phase 0 must produce that locked graph
before implementation dependencies are admitted, and the conformance release
cannot pass without the complete generated SBOM and zero denied/unknown items.
