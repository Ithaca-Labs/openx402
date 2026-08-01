# Raw generation output

This directory is intentionally empty in version control. Regeneration writes:

- `foreign_cdp_reference.jsonl`: the complete paginated CDP response after deduplication;
- `cdp-sample-v1.jsonl`: the deterministic 150-record source sample; and
- `openrouter/`: cached raw generation and judging responses.

The CDP files are ignored because the public API documentation does not grant a
clear redistribution licence. They do not inherit this repository's Apache-2.0
licence. Run `npm run benchmark:fetch-cdp` followed by
`npm run benchmark:generate` to recreate them and the derived fixtures. The
committed manifests contain the source URL, timestamps, response metadata,
sampling seed, and SHA-256 hashes needed to audit a regeneration.

