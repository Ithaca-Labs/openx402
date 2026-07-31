CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS managed_keys (
  network text NOT NULL,
  role text NOT NULL CHECK (role IN ('sponsor', 'channel')),
  address text NOT NULL,
  ciphertext bytea NOT NULL,
  nonce bytea NOT NULL,
  tag bytea NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (network, address)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_sponsor_per_network
  ON managed_keys(network) WHERE role = 'sponsor' AND active;

CREATE TABLE IF NOT EXISTS channel_accounts (
  network text NOT NULL,
  address text NOT NULL,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'leased', 'unresolved', 'disabled')),
  lease_owner text,
  lease_until timestamptz,
  fencing_token bigint NOT NULL DEFAULT 0,
  settlement_record_id bigint,
  last_sequence bigint,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (network, address)
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  id bigserial PRIMARY KEY,
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  fingerprint text NOT NULL,
  scheme text NOT NULL CHECK (scheme IN ('exact', 'upto')),
  network text NOT NULL,
  actual_amount numeric(39,0),
  payer text,
  status text NOT NULL DEFAULT 'verified' CHECK (status IN (
    'verified', 'preparing', 'submitting', 'pending', 'success', 'failed', 'unknown'
  )),
  worker_id text,
  worker_lease_until timestamptz,
  channel_address text,
  fencing_token bigint,
  envelope_xdr text,
  transaction_hash text,
  estimated_fee_stroops numeric(30,0),
  response_json jsonb,
  error_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, idempotency_key)
);

ALTER TABLE channel_accounts
  DROP CONSTRAINT IF EXISTS channel_accounts_settlement_record_id_fkey;
ALTER TABLE channel_accounts
  ADD CONSTRAINT channel_accounts_settlement_record_id_fkey
  FOREIGN KEY (settlement_record_id) REFERENCES idempotency_records(id);

CREATE INDEX IF NOT EXISTS idempotency_unresolved_idx
  ON idempotency_records(network, status)
  WHERE status IN ('preparing', 'submitting', 'pending', 'unknown');

CREATE TABLE IF NOT EXISTS sponsor_daily_usage (
  usage_day date NOT NULL,
  scope text NOT NULL,
  sponsored_stroops numeric(30,0) NOT NULL DEFAULT 0,
  PRIMARY KEY (usage_day, scope)
);

CREATE TABLE IF NOT EXISTS simulation_windows (
  window_start timestamptz NOT NULL,
  scope text NOT NULL,
  simulations integer NOT NULL DEFAULT 0,
  PRIMARY KEY (window_start, scope)
);

CREATE TABLE IF NOT EXISTS settlement_audit (
  id bigserial PRIMARY KEY,
  settlement_record_id bigint REFERENCES idempotency_records(id),
  event text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
