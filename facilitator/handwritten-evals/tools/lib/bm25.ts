/**
 * Okapi BM25 — evaluation-only comparability baseline. BUILD-PLAN §10.
 *
 * Why this exists:
 *
 *   "Production uses PostgreSQL `ts_rank_cd`, which is **not** BM25 — a
 *    different scoring function. Add a real BM25 run as a comparability
 *    baseline."
 *
 * `ts_rank_cd` is a cover-density rank: it rewards query terms appearing close
 * together and normalizes by document length only if asked, with no IDF term
 * and no term-frequency saturation. BM25 has both. Papers report BM25; this
 * repository's lexical arm is not BM25, so without this file the benchmark has
 * no number anyone outside the project can calibrate against.
 *
 * Constraints, all satisfied here (§10):
 *
 *   - **Permissively licensed.** Original implementation written for this
 *     repository, under the repository's Apache-2.0 licence. No third-party
 *     code is vendored, so there is no licence to audit and nothing to
 *     attribute. The algorithm itself (Robertson & Walker 1994) is not
 *     copyrightable.
 *   - **Evaluation-only.** Nothing in this file is imported by `src/`. It has
 *     no path into the request path and no place in a deployment.
 *   - **No production dependency, database extension, or datastore.** Zero npm
 *     dependencies, zero I/O; the whole index is a plain in-memory object built
 *     from catalog text. There is no `pg_search`, no `rum`, no Elasticsearch,
 *     and none is needed for a corpus of 1,000 short documents.
 *
 * BM25 participates in pooling (§8, Pass 2, system five of five) but is never a
 * deployment target.
 *
 * ## Scoring
 *
 *     score(D, Q) = sum over q in Q of
 *         IDF(q) * ( f(q,D) * (k1 + 1) ) / ( f(q,D) + k1 * (1 - b + b * |D| / avgdl) )
 *
 *     IDF(q) = ln( 1 + (N - n(q) + 0.5) / (n(q) + 0.5) )
 *
 * The `1 +` inside the log is the Lucene variant. The classic Robertson-Sparck
 * Jones form goes negative for terms appearing in more than half the corpus,
 * which at N=1000 with a small vocabulary would let a common term *subtract*
 * from a document's score. That is a well-known pathology and not something a
 * baseline should reproduce.
 *
 * Defaults k1 = 1.2, b = 0.75 — the standard TREC operating point.
 */

export interface Bm25Params {
  /** Term-frequency saturation. Higher = more credit for repeats. Default 1.2. */
  k1?: number;
  /** Length normalization, 0 = none, 1 = full. Default 0.75. */
  b?: number;
}

export interface Bm25Document {
  id: string;
  text: string;
}

export interface Bm25Hit {
  id: string;
  score: number;
  /** Distinct query terms that matched. Useful when eyeballing pool contributions. */
  matchedTerms: string[];
}

/**
 * Tokenizer.
 *
 * Lowercase, then split on anything that is not a letter, digit or underscore.
 * Deliberately does NOT stem: production indexes with `to_tsvector('simple')`
 * (see `migrations/002_catalog.sql`), which lowercases and splits but applies
 * no stemmer or stopword list. Matching that keeps the comparison about the
 * *scoring function*, which is the stated point of the baseline, rather than
 * confounding it with an analysis-chain difference.
 *
 * Unicode-aware so non-ASCII catalog text is not silently shredded.
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}_]+/gu)) {
    tokens.push(match[0]);
  }
  return tokens;
}

interface Posting {
  /** Index into `this.ids`. */
  doc: number;
  /** Raw term frequency in that document. */
  frequency: number;
}

export class Bm25Index {
  readonly k1: number;
  readonly b: number;

  private readonly ids: string[] = [];
  private readonly idSet = new Set<string>();
  private readonly lengths: number[] = [];
  private readonly postings = new Map<string, Posting[]>();
  private totalLength = 0;
  private averageLength = 0;

  constructor(documents: Iterable<Bm25Document> = [], params: Bm25Params = {}) {
    this.k1 = params.k1 ?? 1.2;
    this.b = params.b ?? 0.75;
    if (this.k1 < 0) throw new RangeError(`k1 must be >= 0, got ${this.k1}`);
    if (this.b < 0 || this.b > 1) throw new RangeError(`b must be in [0,1], got ${this.b}`);
    for (const document of documents) this.add(document);
  }

  get size(): number {
    return this.ids.length;
  }

  get averageDocumentLength(): number {
    return this.averageLength;
  }

  /** Documents containing the term. 0 for an unseen term. */
  documentFrequency(term: string): number {
    return this.postings.get(term)?.length ?? 0;
  }

  add(document: Bm25Document): void {
    if (this.idSet.has(document.id)) {
      throw new Error(`duplicate document id in BM25 index: ${document.id}`);
    }
    const doc = this.ids.length;
    const tokens = tokenize(document.text);
    this.ids.push(document.id);
    this.idSet.add(document.id);
    this.lengths.push(tokens.length);

    const frequencies = new Map<string, number>();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    for (const [term, frequency] of frequencies) {
      let list = this.postings.get(term);
      if (!list) {
        list = [];
        this.postings.set(term, list);
      }
      list.push({ doc, frequency });
    }

    this.totalLength += tokens.length;
    this.averageLength = this.totalLength / this.ids.length;
  }

  /**
   * IDF with the Lucene `ln(1 + ...)` smoothing. Always positive, so a common
   * term can never reduce a document's score.
   */
  idf(term: string): number {
    const n = this.documentFrequency(term);
    if (n === 0) return 0;
    return Math.log(1 + (this.size - n + 0.5) / (n + 0.5));
  }

  /** BM25 score of one document for one query. Exposed for hand-checking tests. */
  scoreDocument(query: string, id: string): number {
    const doc = this.ids.indexOf(id);
    if (doc === -1) return 0;
    let total = 0;
    for (const term of new Set(tokenize(query))) {
      const posting = this.postings.get(term)?.find(entry => entry.doc === doc);
      if (!posting) continue;
      total += this.idf(term) * this.saturate(posting.frequency, this.lengths[doc]!);
    }
    return total;
  }

  private saturate(frequency: number, length: number): number {
    const norm = this.averageLength === 0 ? 1 : length / this.averageLength;
    return (frequency * (this.k1 + 1)) / (frequency + this.k1 * (1 - this.b + this.b * norm));
  }

  /**
   * Rank documents for a query.
   *
   * Ties break by document id ascending. A stable, content-independent
   * tie-break matters here: BM25 produces exact ties constantly on short
   * catalog text, and an insertion-order tie-break would make the run depend on
   * catalog file ordering — which would then leak into the pool.
   *
   * Documents scoring 0 (no query term present) are never returned; padding a
   * ranking with non-matching documents is the v1 descending-id tail defect.
   */
  search(query: string, topK = 20): Bm25Hit[] {
    const terms = [...new Set(tokenize(query))];
    const scores = new Map<number, number>();
    const matched = new Map<number, string[]>();

    for (const term of terms) {
      const list = this.postings.get(term);
      if (!list) continue;
      const idf = this.idf(term);
      for (const posting of list) {
        const contribution = idf * this.saturate(posting.frequency, this.lengths[posting.doc]!);
        if (contribution === 0) continue;
        scores.set(posting.doc, (scores.get(posting.doc) ?? 0) + contribution);
        const list2 = matched.get(posting.doc);
        if (list2) list2.push(term);
        else matched.set(posting.doc, [term]);
      }
    }

    const hits: Bm25Hit[] = [];
    for (const [doc, score] of scores) {
      if (score <= 0) continue;
      hits.push({ id: this.ids[doc]!, score, matchedTerms: (matched.get(doc) ?? []).sort() });
    }
    hits.sort((left, right) =>
      right.score - left.score || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    return hits.slice(0, topK);
  }

  /** Convenience for pooling: just the ranked ids. */
  rank(query: string, topK = 20): string[] {
    return this.search(query, topK).map(hit => hit.id);
  }
}

/**
 * Minimal shape of a v2 catalog record's wire block, as far as this baseline
 * cares. Structurally typed so no production schema is imported — importing
 * `src/search/release/schema.ts` would couple an evaluation-only tool to the
 * service build.
 */
export interface CatalogTextSource {
  resource?: {
    serviceName?: string | undefined;
    description?: string | undefined;
    tags?: readonly string[] | undefined;
    url?: string | undefined;
  } | undefined;
  accepts?: ReadonlyArray<{ scheme?: string | undefined; network?: string | undefined }> | undefined;
}

/**
 * Compose indexable text from a catalog wire record.
 *
 * Mirrors the field selection of `src/bazaar/document.ts` — service name,
 * description, tags, resource URL and payment terms — without importing it, so
 * BM25 sees the same evidence the production lexical arm sees. The URL is
 * included because `.example` hostnames carry the capability slug, exactly as
 * the production document does.
 *
 * The catalog carries no text of its own beyond these fields; sparse records
 * (§4) legitimately produce a near-empty document, and that is the graceful
 * degradation the `cold_start` query class is there to measure.
 */
export function catalogText(record: CatalogTextSource): string {
  const lines: string[] = [];
  const resource = record.resource;
  if (resource?.serviceName) lines.push(`Service: ${resource.serviceName}`);
  if (resource?.description) lines.push(`Description: ${resource.description}`);
  if (resource?.url) lines.push(`Resource: ${resource.url}`);
  if (resource?.tags && resource.tags.length > 0) lines.push(`Tags: ${resource.tags.join(", ")}`);
  for (const option of record.accepts ?? []) {
    lines.push(`Payment: ${option.network ?? ""}, ${option.scheme ?? ""}`.trimEnd());
  }
  return lines.join("\n");
}

/** Builds an index straight from catalog records. */
export function buildCatalogIndex(
  records: Iterable<{ resource_id: string; wire: CatalogTextSource }>,
  params: Bm25Params = {},
): Bm25Index {
  const documents: Bm25Document[] = [];
  for (const record of records) {
    documents.push({ id: record.resource_id, text: catalogText(record.wire) });
  }
  return new Bm25Index(documents, params);
}
