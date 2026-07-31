# Dependency licences

The locked Cargo and npm graphs were enumerated from Cargo metadata and the npm
lockfile on 2026-07-31: 221 Cargo packages and 44 npm package entries. No AGPL,
GPL, or LGPL dependency was present.

| Direct dependency | Pinned version/revision | Licence |
| --- | --- | --- |
| `soroban-sdk` | `26.1.1`, `27.0.2` | Apache-2.0 |
| `stellar-accounts` | `56d6e5b91aed828051163cebd92dab6c3ca2fa92` | MIT |
| `@stellar/stellar-sdk` | `16.2.0` | Apache-2.0 |
| `ed25519-dalek` | `2.1.1` | Apache-2.0 OR MIT |

Resolved transitive expressions were permissive Apache-2.0, MIT, BSD, Zlib,
Unicode, Unlicense, or compatible dual-licence combinations. No model or model
weights are used by this repository.

The OpenZeppelin dependency is pinned by Git commit in `Cargo.lock` and
`Cargo.toml`. Release review must rerun the licence inventory after any lockfile
change.
