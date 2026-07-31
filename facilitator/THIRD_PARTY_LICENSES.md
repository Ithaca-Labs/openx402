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

The workspace package `packages/bazaar-sdk` (`@openx402/bazaar-sdk`) is Apache-2.0 and depends only on `@x402/core` and `@x402/extensions`, both Apache-2.0. Workspace symlinks are skipped by the checker; their own lock entries are verified.

The PostgreSQL 17 container uses the PostgreSQL licence. No model weights, embedding runtime, external relayer, OpenZeppelin Relayer, or AGPL x402 plugin is part of this service.
