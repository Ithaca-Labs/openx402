-- Weighted lexical fields and phrase-aware query support.
--
-- The readable `document` remains the sole input to semantic providers and
-- rerankers. These three text columns are a deterministic lexical projection;
-- identifiers are weighted above descriptive text, which is weighted above
-- seller tags, examples and payment metadata.

DROP INDEX IF EXISTS catalog_search_tsv_idx;
ALTER TABLE catalog_search_documents DROP COLUMN IF EXISTS tsv;

ALTER TABLE catalog_search_documents
  ADD COLUMN IF NOT EXISTS lexical_high text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lexical_medium text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lexical_low text NOT NULL DEFAULT '';

-- Preserve the searchability of rows written by versions before this migration.
-- New catalog writes replace these compatibility values with compiler output.
UPDATE catalog_search_documents d
SET lexical_high = concat_ws(' ', v.service_name, v.tool_name, v.route_template, r.resource_url, v.method),
    lexical_medium = concat_ws(' ', v.description, v.output_type),
    lexical_low = concat_ws(' ', d.document, v.mime_type, v.transport,
      array_to_string(v.tags, ' '),
      (SELECT string_agg(concat_ws(' ', o.scheme, o.network, o.amount::text,
                                   o.asset_symbol, o.asset, o.pay_to), ' ')
         FROM catalog_payment_options o WHERE o.version_id = v.id))
FROM catalog_resource_versions v
, catalog_resources r
WHERE v.id = d.version_id AND r.id = d.resource_id;

ALTER TABLE catalog_search_documents
  ADD COLUMN IF NOT EXISTS tsv_high tsvector GENERATED ALWAYS AS
    (to_tsvector('simple'::regconfig, lexical_high)) STORED,
  ADD COLUMN IF NOT EXISTS tsv_medium tsvector GENERATED ALWAYS AS
    (to_tsvector('simple'::regconfig, lexical_medium)) STORED,
  ADD COLUMN IF NOT EXISTS tsv_low tsvector GENERATED ALWAYS AS
    (to_tsvector('simple'::regconfig, lexical_low)) STORED,
  ADD COLUMN IF NOT EXISTS tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple'::regconfig, lexical_high), 'A') ||
    setweight(to_tsvector('simple'::regconfig, lexical_medium), 'B') ||
    setweight(to_tsvector('simple'::regconfig, lexical_low), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS catalog_search_tsv_idx ON catalog_search_documents USING gin(tsv);
CREATE INDEX IF NOT EXISTS catalog_search_tsv_high_idx ON catalog_search_documents USING gin(tsv_high);
CREATE INDEX IF NOT EXISTS catalog_search_resource_idx ON catalog_search_documents(resource_id);

ALTER TABLE catalog_search_documents ALTER COLUMN compiler_version SET DEFAULT 2;
UPDATE catalog_search_documents SET compiler_version = 2 WHERE compiler_version < 2;

/**
 * Compatibility helper for SQL callers. Runtime search constructs the same
 * expression in TypeScript so Unicode normalization and identifier handling
 * are explicit and testable before the value reaches PostgreSQL.
 */
CREATE OR REPLACE FUNCTION search_or_tsquery(configuration regconfig, raw text)
RETURNS tsquery LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    to_tsquery(
      configuration,
      NULLIF(
        array_to_string(
          ARRAY(
            SELECT quote_literal(token)
            FROM unnest(regexp_split_to_array(lower(raw), '[^[:alnum:]_]+')) AS token
            WHERE length(token) > 0
          ),
          ' | '
        ),
        ''
      )
    ),
    to_tsquery(configuration, 'x402zzzznomatch')
  );
$$;

CREATE OR REPLACE FUNCTION search_phrase_tsquery(configuration regconfig, raw text)
RETURNS tsquery LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(NULLIF(phraseto_tsquery(configuration, raw), ''::tsquery),
                  to_tsquery(configuration, 'x402zzzznomatch'));
$$;

INSERT INTO schema_migrations(version) VALUES (4) ON CONFLICT DO NOTHING;
