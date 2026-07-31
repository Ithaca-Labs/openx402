-- Bazaar catalog, discovery and analytics storage.
--
-- Cursor stability contract
-- -------------------------
-- Every row that a discovery response can observe carries `created_version`
-- and, when it can be retired, `retired_version`. Both come from
-- `catalog_next_version()`, which increments a single row under a row lock held
-- until commit. Version assignment order is therefore identical to commit order
-- across every replica, so `catalog_watermark()` is a true snapshot boundary:
-- when a reader sees watermark N, every version <= N is committed and no
-- version <= N can still appear later. A cursor pins that watermark and each
-- page filters `created_version <= snapshot AND (retired_version IS NULL OR
-- retired_version > snapshot)`.

CREATE TABLE IF NOT EXISTS catalog_state (
  id integer PRIMARY KEY CHECK (id = 1),
  last_version bigint NOT NULL DEFAULT 0
);

INSERT INTO catalog_state(id, last_version) VALUES (1, 0) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION catalog_next_version() RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE next_version bigint;
BEGIN
  -- The row lock is held until commit, so sequence order equals commit order.
  UPDATE catalog_state SET last_version = last_version + 1
    WHERE id = 1 RETURNING last_version INTO next_version;
  RETURN next_version;
END;
$$;

CREATE OR REPLACE FUNCTION catalog_watermark() RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT last_version FROM catalog_state WHERE id = 1;
$$;

-- Canonical resources. Identity is the normalized origin + route template or
-- concrete path + uppercase method for HTTP, and the exact normalized
-- resource URL + tool name for MCP.
CREATE TABLE IF NOT EXISTS catalog_resources (
  id bigserial PRIMARY KEY,
  resource_key text NOT NULL UNIQUE,
  type text NOT NULL CHECK (type IN ('http', 'mcp')),
  origin text NOT NULL,
  resource_url text NOT NULL,
  route_template text,
  method text,
  tool_name text,
  -- Ownership anchor: the payTo first observed for this resource. A different
  -- payTo may never silently replace an active listing.
  owner_pay_to text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'stale', 'quarantined', 'disabled', 'tombstoned')),
  active_version_id bigint,
  created_version bigint NOT NULL,
  updated_version bigint NOT NULL,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  last_seen_paid timestamptz,
  quarantine_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_resources_snapshot_idx
  ON catalog_resources(created_version, id DESC);
CREATE INDEX IF NOT EXISTS catalog_resources_status_idx ON catalog_resources(status, last_seen);
CREATE INDEX IF NOT EXISTS catalog_resources_origin_idx ON catalog_resources(origin);
CREATE INDEX IF NOT EXISTS catalog_resources_owner_idx ON catalog_resources(owner_pay_to);

-- Append-only seller declarations. A version is never mutated in place; only
-- its lifecycle columns change.
CREATE TABLE IF NOT EXISTS catalog_resource_versions (
  id bigserial PRIMARY KEY,
  resource_id bigint NOT NULL REFERENCES catalog_resources(id),
  version integer NOT NULL,
  declaration_hash text NOT NULL,
  status text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'active', 'superseded', 'quarantined', 'tombstoned')),
  -- `payment_observed` means this facilitator itself verified or settled a real
  -- payment bound to the declared payTo/asset/network. It is not proof of
  -- origin ownership or of factual accuracy.
  verification text NOT NULL DEFAULT 'unverified'
    CHECK (verification IN ('unverified', 'payment_observed')),
  provenance text NOT NULL DEFAULT 'seller_declared' CHECK (provenance = 'seller_declared'),
  x402_version integer NOT NULL,
  description text,
  service_name text,
  tags text[] NOT NULL DEFAULT '{}',
  icon_url text,
  mime_type text,
  route_template text,
  method text,
  tool_name text,
  transport text,
  bazaar_extension jsonb NOT NULL,
  extensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_schema jsonb,
  input_example jsonb,
  output_type text,
  output_schema jsonb,
  output_example jsonb,
  declared_pay_to text NOT NULL,
  rejected_reason text,
  created_version bigint NOT NULL,
  retired_version bigint,
  observed_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_id, version),
  UNIQUE (resource_id, declaration_hash)
);

CREATE INDEX IF NOT EXISTS catalog_versions_snapshot_idx
  ON catalog_resource_versions(resource_id, created_version, version DESC);
CREATE INDEX IF NOT EXISTS catalog_versions_status_idx ON catalog_resource_versions(status);

ALTER TABLE catalog_resources
  DROP CONSTRAINT IF EXISTS catalog_resources_active_version_fkey;
ALTER TABLE catalog_resources
  ADD CONSTRAINT catalog_resources_active_version_fkey
  FOREIGN KEY (active_version_id) REFERENCES catalog_resource_versions(id);

-- One row per accepted payment option. Several options may reference the same
-- version, so a resource with three accepts entries stays one resource. A
-- changed price retires the previous option row instead of overwriting it, so
-- historical settlements keep pointing at the terms that were actually paid.
CREATE TABLE IF NOT EXISTS catalog_payment_options (
  id bigserial PRIMARY KEY,
  resource_id bigint NOT NULL REFERENCES catalog_resources(id),
  version_id bigint NOT NULL REFERENCES catalog_resource_versions(id),
  option_hash text NOT NULL,
  x402_version integer NOT NULL,
  scheme text NOT NULL,
  network text NOT NULL,
  asset text NOT NULL,
  asset_symbol text,
  asset_decimals integer,
  amount numeric(39,0) NOT NULL,
  pay_to text NOT NULL,
  max_timeout_seconds integer NOT NULL,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_version bigint NOT NULL,
  retired_version bigint,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz,
  UNIQUE (version_id, option_hash)
);

CREATE INDEX IF NOT EXISTS catalog_options_version_idx
  ON catalog_payment_options(version_id, created_version);
CREATE INDEX IF NOT EXISTS catalog_options_filter_idx
  ON catalog_payment_options(network, scheme, asset, pay_to);

-- Every cataloging attempt, including soft-dropped and rejected ones.
CREATE TABLE IF NOT EXISTS catalog_observations (
  id bigserial PRIMARY KEY,
  resource_id bigint REFERENCES catalog_resources(id),
  version_id bigint REFERENCES catalog_resource_versions(id),
  resource_key text,
  resource_url text,
  stage text NOT NULL CHECK (stage IN ('verified', 'settled')),
  outcome text NOT NULL CHECK (outcome IN
    ('indexed', 'refreshed', 'versioned', 'pending', 'rejected', 'quarantined', 'skipped')),
  wire_status text NOT NULL CHECK (wire_status IN ('success', 'processing', 'rejected')),
  rejected_reason text,
  internal_reason text,
  declaration_hash text,
  network text,
  scheme text,
  pay_to text,
  payer text,
  settlement_record_id bigint REFERENCES idempotency_records(id),
  observed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_observations_resource_idx
  ON catalog_observations(resource_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS catalog_observations_time_idx ON catalog_observations(observed_at DESC);

-- Deterministic lexical index. The document text is compiled only from
-- seller-declared fields and normalized payment terms; no generative model
-- participates.
CREATE TABLE IF NOT EXISTS catalog_search_documents (
  version_id bigint PRIMARY KEY REFERENCES catalog_resource_versions(id) ON DELETE CASCADE,
  resource_id bigint NOT NULL REFERENCES catalog_resources(id),
  source_hash text NOT NULL,
  document text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', document)) STORED,
  created_version bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_search_tsv_idx ON catalog_search_documents USING gin(tsv);
CREATE INDEX IF NOT EXISTS catalog_search_resource_idx ON catalog_search_documents(resource_id);

-- Durable cataloging/indexing work for the later search pipeline. Workers claim
-- rows with FOR UPDATE SKIP LOCKED and a fencing token; an expired lease is
-- safe to steal.
CREATE TABLE IF NOT EXISTS catalog_index_jobs (
  id bigserial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('lexical', 'embedding')),
  resource_id bigint NOT NULL REFERENCES catalog_resources(id),
  version_id bigint NOT NULL REFERENCES catalog_resource_versions(id) ON DELETE CASCADE,
  generation integer NOT NULL DEFAULT 1,
  source_hash text NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'leased', 'done', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  lease_owner text,
  lease_until timestamptz,
  fencing_token bigint NOT NULL DEFAULT 0,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, version_id, generation)
);

CREATE INDEX IF NOT EXISTS catalog_jobs_claim_idx
  ON catalog_index_jobs(state, next_run_at) WHERE state IN ('pending', 'leased');

-- Analytics fact table. Written on the same soft-failure path as cataloging, so
-- an analytics failure can never turn a valid payment into an error.
CREATE TABLE IF NOT EXISTS payment_events (
  id bigserial PRIMARY KEY,
  settlement_record_id bigint REFERENCES idempotency_records(id),
  stage text NOT NULL CHECK (stage IN ('verified', 'settled')),
  status text NOT NULL CHECK (status IN ('valid', 'invalid', 'success', 'failed', 'unknown')),
  network text NOT NULL,
  scheme text NOT NULL,
  asset text NOT NULL,
  asset_symbol text,
  asset_decimals integer,
  payer text,
  pay_to text NOT NULL,
  max_amount numeric(39,0) NOT NULL,
  amount numeric(39,0),
  fee_stroops numeric(30,0),
  transaction_hash text,
  facilitator_id text NOT NULL,
  resource_id bigint REFERENCES catalog_resources(id),
  resource_version_id bigint REFERENCES catalog_resource_versions(id),
  payment_option_id bigint REFERENCES catalog_payment_options(id),
  resource_url text,
  error_reason text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_events_time_idx ON payment_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS payment_events_time_brin_idx
  ON payment_events USING brin(occurred_at);
CREATE INDEX IF NOT EXISTS payment_events_payer_idx ON payment_events(payer, occurred_at DESC);
CREATE INDEX IF NOT EXISTS payment_events_pay_to_idx ON payment_events(pay_to, occurred_at DESC);
CREATE INDEX IF NOT EXISTS payment_events_network_idx ON payment_events(network, occurred_at DESC);
CREATE INDEX IF NOT EXISTS payment_events_resource_idx
  ON payment_events(resource_id, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS payment_events_settlement_idx
  ON payment_events(settlement_record_id, stage) WHERE settlement_record_id IS NOT NULL;

-- Pre-aggregated daily rollup so tiny-value, high-count workloads do not scan
-- the fact table for volume charts.
CREATE TABLE IF NOT EXISTS payment_daily_totals (
  usage_day date NOT NULL,
  network text NOT NULL,
  scheme text NOT NULL,
  asset text NOT NULL,
  pay_to text NOT NULL,
  status text NOT NULL,
  transactions bigint NOT NULL DEFAULT 0,
  amount numeric(39,0) NOT NULL DEFAULT 0,
  fee_stroops numeric(30,0) NOT NULL DEFAULT 0,
  PRIMARY KEY (usage_day, network, scheme, asset, pay_to, status)
);

CREATE INDEX IF NOT EXISTS payment_daily_totals_day_idx ON payment_daily_totals(usage_day DESC);
