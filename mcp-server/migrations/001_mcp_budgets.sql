-- mcp-server owns this schema independently of the facilitator's own
-- migrations (facilitator/migrations/*). Both may run against the same
-- physical PostgreSQL instance/database, so every table here is `mcp_`
-- prefixed and tracked in its own `mcp_schema_migrations` table to avoid any
-- collision with the facilitator's tables or migration bookkeeping.

-- One row per official Payment Identifier. `reserve()` inserts it holding the
-- conservative maximum; `reconcile()`/`release()` update it in place under a
-- row lock (`SELECT ... FOR UPDATE`), so concurrent replicas serving the same
-- agent can never double-spend a budget or double-pay the same invocation.
CREATE TABLE mcp_budget_reservations (
  id BIGSERIAL PRIMARY KEY,
  payment_identifier TEXT NOT NULL UNIQUE,
  agent_id TEXT NOT NULL,
  session_id TEXT,
  usage_day DATE NOT NULL,
  resource_ref TEXT NOT NULL,
  network TEXT NOT NULL,
  asset TEXT NOT NULL,
  scheme TEXT NOT NULL,
  reserved_amount NUMERIC(39, 0) NOT NULL CHECK (reserved_amount >= 0),
  settled_amount NUMERIC(39, 0),
  transaction_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'settled', 'unknown', 'released', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX mcp_budget_reservations_agent_idx ON mcp_budget_reservations (agent_id, created_at);
CREATE INDEX mcp_budget_reservations_status_idx ON mcp_budget_reservations (status) WHERE status IN ('reserved', 'unknown');

-- Daily aggregate spend/reservation per agent, the "session/day operator
-- budget" ceiling. Updated in the same transaction as the reservation row so
-- the two stay consistent under concurrent replicas.
CREATE TABLE mcp_budget_usage (
  agent_id TEXT NOT NULL,
  usage_day DATE NOT NULL,
  spent_amount NUMERIC(39, 0) NOT NULL DEFAULT 0 CHECK (spent_amount >= 0),
  reserved_amount NUMERIC(39, 0) NOT NULL DEFAULT 0 CHECK (reserved_amount >= 0),
  PRIMARY KEY (agent_id, usage_day)
);
