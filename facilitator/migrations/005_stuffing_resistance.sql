-- Bound lexical term frequency so repeated seller keywords cannot increase rank.
-- The human document used by embeddings and rerankers remains unchanged.

CREATE OR REPLACE FUNCTION search_unique_lexemes(raw text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(string_agg(token, ' ' ORDER BY first_position), '')
  FROM (
    SELECT lower(token) AS token, min(position) AS first_position
    FROM unnest(regexp_split_to_array(COALESCE(raw, ''), '[^[:alnum:]_]+'))
         WITH ORDINALITY AS words(token, position)
    WHERE token <> ''
    GROUP BY lower(token)
  ) unique_words
$$;

UPDATE catalog_search_documents
SET lexical_high = search_unique_lexemes(lexical_high),
    lexical_medium = search_unique_lexemes(lexical_medium),
    lexical_low = search_unique_lexemes(lexical_low),
    compiler_version = 3
WHERE compiler_version < 3;

ALTER TABLE catalog_search_documents ALTER COLUMN compiler_version SET DEFAULT 3;

INSERT INTO schema_migrations(version) VALUES (5) ON CONFLICT DO NOTHING;
