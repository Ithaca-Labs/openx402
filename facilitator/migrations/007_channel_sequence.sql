-- Channel sequence tracking. A settlement records the source-account sequence
-- its inner transaction consumes, and `channel_accounts.last_sequence` holds
-- the highest sequence a ledger has confirmed for that channel. A later prepare
-- whose sequence is not above it was built on a lagging RPC account view and is
-- doomed with tx_bad_seq, so it is rejected before submission.

ALTER TABLE idempotency_records ADD COLUMN IF NOT EXISTS channel_sequence bigint;

INSERT INTO schema_migrations(version) VALUES (7) ON CONFLICT DO NOTHING;
