# Dependency licence policy

The facilitator is Apache-2.0. Dependencies are restricted to permissive OSI licences; AGPL and GPL dependencies are not accepted. `npm run licenses` verifies every locked production, development, and optional dependency in CI.

| Direct runtime dependency | Version | Licence |
| --- | --- | --- |
| `@stellar/stellar-sdk` | `16.2.0` | Apache-2.0 |
| `@x402/core` | `2.20.0` | Apache-2.0 |
| `@x402/extensions` | `2.20.0` | Apache-2.0 |
| `@x402/stellar` | `2.20.0` | Apache-2.0 |
| `ajv` | `8.20.0` | MIT |
| `express` | `5.1.0` | MIT |
| `helmet` | `8.1.0` | MIT |
| `pg` | `8.16.3` | MIT |
| `yaml` | `2.9.0` | ISC |
| `zod` | `3.25.76` | MIT |

## Optional local model runtime

`@huggingface/transformers` is an **optional peer dependency**, so it is not
installed by default and is not part of the locked production tree. It is only
needed for `search.semantic.provider: local`.

| Package | Version | Licence |
| --- | --- | --- |
| `@huggingface/transformers` | `^4.2.0` | Apache-2.0 |
| `onnxruntime-node` (transitive) | `1.24.x` | MIT |
| `onnxruntime-web` (transitive) | `1.26.x` | MIT |
| `sharp` (transitive) | `^0.34` | Apache-2.0 |
| `@huggingface/jinja` (transitive) | `^0.5` | MIT |

## Model weights

Weights are never bundled or redistributed by this repository; they are fetched
into `search.models.cache_dir` at the operator's request and pinned by immutable
commit sha.

| Purpose | Model | Revision | Licence |
| --- | --- | --- | --- |
| Embedding identity | `BAAI/bge-m3` | `5617a9f61b028005a4858fdac845db406aefb181` | MIT |
| Embedding ONNX export | `Xenova/bge-m3` | `4de13258303883538bd53b696b452bf8099f0858` | MIT |
| Reranking (target, no ONNX export published) | `BAAI/bge-reranker-v2-m3` | `953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e` | Apache-2.0 |

Licences were read from each model card's metadata. No NVIDIA, Nemotron or
hosted-vendor model is referenced, bundled or selected by default.

## PostgreSQL extensions

`pgvector` (PostgreSQL Licence, a permissive BSD-style licence) is optional. It
is not vendored; the Compose file uses the upstream `pgvector/pgvector:pg17`
image. Without it the facilitator runs lexical-only.

The workspace package `packages/bazaar-sdk` (`@openx402/bazaar-sdk`) is Apache-2.0 and depends only on `@x402/core` and `@x402/extensions`, both Apache-2.0. Workspace symlinks are skipped by the checker; their own lock entries are verified.

The PostgreSQL 17 container uses the PostgreSQL licence. No model weights, embedding runtime, external relayer, OpenZeppelin Relayer, or AGPL x402 plugin is part of this service.
