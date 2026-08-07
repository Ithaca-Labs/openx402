-- Query-level search telemetry, including empty result sets, and explicit
-- fetch-after-search feedback. A session spans cursor pages; each page appends
-- the exact internal resource/version ids returned to the client.

CREATE TABLE IF NOT EXISTS search_sessions (
  id uuid PRIMARY KEY,
  query_hash text NOT NULL,
  query_text text,
  returned_resource_ids bigint[] NOT NULL DEFAULT '{}',
  returned_version_ids bigint[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS search_sessions_time_idx ON search_sessions(created_at DESC);

CREATE TABLE IF NOT EXISTS search_resource_fetches (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES search_sessions(id) ON DELETE CASCADE,
  resource_id bigint NOT NULL REFERENCES catalog_resources(id),
  version_id bigint NOT NULL REFERENCES catalog_resource_versions(id),
  returned_position integer NOT NULL CHECK (returned_position > 0),
  fetched_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS search_resource_fetches_session_idx
  ON search_resource_fetches(session_id, fetched_at);
CREATE INDEX IF NOT EXISTS search_resource_fetches_resource_idx
  ON search_resource_fetches(resource_id, fetched_at DESC);

INSERT INTO schema_migrations(version) VALUES (6) ON CONFLICT DO NOTHING;
