/**
 * Unit tests for `bm25.ts`.
 *
 * The scoring assertions restate the BM25 formula with literal arithmetic on a
 * three-document corpus, so a reader can verify the numbers without running
 * anything.
 */

import { describe, expect, it } from "vitest";
import {
  Bm25Index,
  buildCatalogIndex,
  catalogText,
  tokenize,
  type Bm25Document,
} from "../../lib/bm25.js";
import { scoreQuery } from "../../lib/scoring.js";

/**
 * Reference corpus.
 *   d1 "alpha beta"        len 2
 *   d2 "alpha alpha gamma" len 3
 *   d3 "delta"             len 1
 *   N = 3, avgdl = 2
 *   df: alpha 2, beta 1, gamma 1, delta 1
 */
const CORPUS: Bm25Document[] = [
  { id: "d1", text: "alpha beta" },
  { id: "d2", text: "alpha alpha gamma" },
  { id: "d3", text: "delta" },
];

const K1 = 1.2;
const B = 0.75;

function idf(n: number, N = 3): number {
  return Math.log(1 + (N - n + 0.5) / (n + 0.5));
}

function saturate(frequency: number, length: number, avgdl = 2): number {
  return (frequency * (K1 + 1)) / (frequency + K1 * (1 - B + B * (length / avgdl)));
}

describe("tokenize", () => {
  it("lowercases and splits on non-alphanumerics", () => {
    expect(tokenize("On-Chain BLOCK data, v2!")).toEqual(["on", "chain", "block", "data", "v2"]);
  });

  it("keeps digits and underscores as token characters", () => {
    expect(tokenize("max_price_usd 0.05")).toEqual(["max_price_usd", "0", "05"]);
  });

  it("does not stem — matching the production `simple` text search config", () => {
    // `to_tsvector('simple')` (migrations/002_catalog.sql) applies no stemmer,
    // so neither does this. The baseline is about the scoring function, not the
    // analysis chain.
    expect(tokenize("prices")).toEqual(["prices"]);
    expect(tokenize("price")).toEqual(["price"]);
  });

  it("handles non-ASCII text without shredding it", () => {
    expect(tokenize("café Übersetzung 東京")).toEqual(["café", "übersetzung", "東京"]);
  });

  it("returns nothing for empty or punctuation-only text", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("--- ... ///")).toEqual([]);
  });
});

describe("index construction", () => {
  const index = new Bm25Index(CORPUS);

  it("records corpus statistics", () => {
    expect(index.size).toBe(3);
    expect(index.averageDocumentLength).toBe(2); // (2 + 3 + 1) / 3
    expect(index.documentFrequency("alpha")).toBe(2);
    expect(index.documentFrequency("beta")).toBe(1);
    expect(index.documentFrequency("missing")).toBe(0);
  });

  it("rejects duplicate document ids", () => {
    expect(() => new Bm25Index([...CORPUS, { id: "d1", text: "again" }])).toThrow(/duplicate document id/);
  });

  it("validates parameters", () => {
    expect(() => new Bm25Index([], { k1: -1 })).toThrow(RangeError);
    expect(() => new Bm25Index([], { b: 1.5 })).toThrow(RangeError);
  });
});

describe("IDF", () => {
  const index = new Bm25Index(CORPUS);

  it("matches ln(1 + (N - n + 0.5) / (n + 0.5))", () => {
    expect(index.idf("alpha")).toBeCloseTo(Math.log(1.6), 12);
    expect(index.idf("beta")).toBeCloseTo(Math.log(1 + 2.5 / 1.5), 12);
    expect(index.idf("alpha")).toBeCloseTo(0.470004, 5);
    expect(index.idf("beta")).toBeCloseTo(0.980829, 5);
  });

  it("scores a rarer term higher", () => {
    expect(index.idf("beta")).toBeGreaterThan(index.idf("alpha"));
  });

  it("is 0 for an unseen term", () => {
    expect(index.idf("nowhere")).toBe(0);
  });

  it("stays strictly positive for a term in every document", () => {
    // The classic Robertson-Sparck Jones IDF goes negative above df > N/2,
    // which would let a common term subtract from a document's score.
    const everywhere = new Bm25Index([
      { id: "a", text: "common one" },
      { id: "b", text: "common two" },
      { id: "c", text: "common three" },
    ]);
    expect(everywhere.idf("common")).toBeGreaterThan(0);
    expect(everywhere.idf("common")).toBeCloseTo(Math.log(1 + 0.5 / 3.5), 12);
  });
});

describe("document scoring", () => {
  const index = new Bm25Index(CORPUS);

  it("matches the hand-computed BM25 score for a single-term query", () => {
    // d1: f=1, |D|=2, |D|/avgdl = 1  -> sat = 1*2.2 / (1 + 1.2*1)      = 1.0
    // d2: f=2, |D|=3, |D|/avgdl = 1.5 -> sat = 2*2.2 / (2 + 1.2*1.375) = 4.4/3.65
    expect(index.scoreDocument("alpha", "d1")).toBeCloseTo(idf(2) * 1.0, 12);
    expect(index.scoreDocument("alpha", "d1")).toBeCloseTo(0.470004, 5);
    expect(index.scoreDocument("alpha", "d2")).toBeCloseTo(idf(2) * (4.4 / 3.65), 12);
    expect(index.scoreDocument("alpha", "d2")).toBeCloseTo(0.566580, 5);
  });

  it("sums independent term contributions for a multi-term query", () => {
    const expected = idf(2) * saturate(1, 2) + idf(1) * saturate(1, 2);
    expect(index.scoreDocument("alpha beta", "d1")).toBeCloseTo(expected, 12);
  });

  it("scores 0 for a document containing no query term", () => {
    expect(index.scoreDocument("alpha", "d3")).toBe(0);
    expect(index.scoreDocument("alpha", "not-in-index")).toBe(0);
  });

  it("counts a repeated query term once", () => {
    expect(index.scoreDocument("alpha alpha alpha", "d1")).toBeCloseTo(index.scoreDocument("alpha", "d1"), 12);
  });

  it("saturates term frequency — 10 occurrences are worth far less than 10x", () => {
    const saturating = new Bm25Index([
      { id: "once", text: "alpha filler filler filler filler filler filler filler filler filler" },
      { id: "tenfold", text: "alpha alpha alpha alpha alpha alpha alpha alpha alpha alpha" },
    ]);
    const once = saturating.scoreDocument("alpha", "once");
    const tenfold = saturating.scoreDocument("alpha", "tenfold");
    expect(tenfold).toBeGreaterThan(once);
    expect(tenfold).toBeLessThan(once * 3);
  });

  it("normalizes by document length", () => {
    const lengths = new Bm25Index([
      { id: "short", text: "alpha beta" },
      { id: "long", text: `alpha ${"padding ".repeat(50)}` },
    ]);
    expect(lengths.scoreDocument("alpha", "short")).toBeGreaterThan(lengths.scoreDocument("alpha", "long"));
  });

  it("disables length normalization at b = 0", () => {
    const noNorm = new Bm25Index(
      [{ id: "short", text: "alpha beta" }, { id: "long", text: `alpha ${"padding ".repeat(50)}` }],
      { b: 0 },
    );
    expect(noNorm.scoreDocument("alpha", "short")).toBeCloseTo(noNorm.scoreDocument("alpha", "long"), 12);
  });
});

describe("search", () => {
  const index = new Bm25Index(CORPUS);

  it("ranks by score, putting the higher-tf document first", () => {
    const hits = index.search("alpha");
    expect(hits.map(hit => hit.id)).toEqual(["d2", "d1"]);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
    expect(hits[0]!.matchedTerms).toEqual(["alpha"]);
  });

  it("never returns a document that matched no query term", () => {
    // Padding a ranking with non-matching documents is the v1 descending-id
    // tail defect; a baseline must not reproduce it.
    expect(index.rank("alpha")).not.toContain("d3");
    expect(index.rank("nothing here matches")).toEqual([]);
  });

  it("breaks ties by document id ascending, not by insertion order", () => {
    // Insertion-order tie-breaks would make the run depend on catalog file
    // ordering, which then leaks into the pool.
    const tied = new Bm25Index([
      { id: "res-0009", text: "alpha beta" },
      { id: "res-0002", text: "alpha beta" },
      { id: "res-0005", text: "alpha beta" },
    ]);
    expect(tied.rank("alpha beta")).toEqual(["res-0002", "res-0005", "res-0009"]);
  });

  it("respects topK", () => {
    const many = new Bm25Index(
      Array.from({ length: 50 }, (_, index2) => ({ id: `res-${String(index2).padStart(4, "0")}`, text: "alpha" })),
    );
    expect(many.rank("alpha", 20)).toHaveLength(20);
    expect(many.search("alpha", 5)).toHaveLength(5);
  });

  it("reports which query terms matched", () => {
    const hits = index.search("alpha gamma");
    expect(hits[0]!.id).toBe("d2");
    expect(hits[0]!.matchedTerms).toEqual(["alpha", "gamma"]);
  });

  it("prefers the document matching more query terms", () => {
    const hits = index.search("alpha gamma");
    expect(hits.map(hit => hit.id)).toEqual(["d2", "d1"]);
  });

  it("is deterministic across repeated calls", () => {
    expect(index.search("alpha beta gamma")).toEqual(index.search("alpha beta gamma"));
  });
});

describe("catalog integration", () => {
  const records = [
    {
      resource_id: "res-0001",
      wire: {
        resource: {
          serviceName: "Sanctions Screen",
          description: "Screen a Stellar address against OFAC and EU sanctions lists in real time.",
          tags: ["compliance", "sanctions", "screening"],
          url: "https://sanctions-screen.example/v1/check",
        },
        accepts: [{ scheme: "exact", network: "stellar:pubnet" }],
      },
    },
    {
      resource_id: "res-0002",
      wire: {
        resource: {
          serviceName: "Block Height",
          description: "Current Stellar ledger height and close time.",
          tags: ["on-chain", "chain"],
          url: "https://ledger-height.example/v1/height",
        },
        accepts: [{ scheme: "upto", network: "stellar:testnet" }],
      },
    },
    // A sparse record (§4): terse name, no description, no tags.
    { resource_id: "res-0003", wire: { resource: { serviceName: "Geo", url: "https://geo.example/q" } } },
  ];

  it("composes indexable text from the seller-declared fields", () => {
    const text = catalogText(records[0]!.wire);
    expect(text).toContain("Service: Sanctions Screen");
    expect(text).toContain("Description: Screen a Stellar address");
    expect(text).toContain("Tags: compliance, sanctions, screening");
    expect(text).toContain("Resource: https://sanctions-screen.example");
    expect(text).toContain("Payment: stellar:pubnet, exact");
  });

  it("degrades gracefully on a sparse record instead of throwing", () => {
    const text = catalogText(records[2]!.wire);
    expect(text).toBe("Service: Geo\nResource: https://geo.example/q");
    expect(tokenize(text).length).toBeGreaterThan(0);
  });

  it("builds a working index straight from catalog records", () => {
    const index = buildCatalogIndex(records);
    expect(index.size).toBe(3);
    expect(index.rank("sanctions screening for a stellar address")[0]).toBe("res-0001");
    expect(index.rank("current ledger height")[0]).toBe("res-0002");
  });

  it("indexes payment terms, so a scheme term is retrievable", () => {
    const index = buildCatalogIndex(records);
    expect(index.rank("upto")).toEqual(["res-0002"]);
  });

  it("produces a run that scores through scoring.ts", () => {
    // End-to-end: BM25 is system five of the five pooled in §8, so its output
    // has to be scoreable by exactly the same code path as the other four.
    const index = buildCatalogIndex(records);
    const ranking = index.rank("sanctions screening", 10);
    const result = scoreQuery(
      {
        queryId: "qry-001",
        queryClass: "capability",
        judgments: [{ resourceId: "res-0001", grade: 3 }, { resourceId: "res-0002", grade: 0 }],
      },
      { queryId: "qry-001", ranking },
      { cutoffs: [10] },
    );
    expect(result.mrr).toBe(1);
    expect(result.ndcg[10]).toBeCloseTo(1, 12);
    expect(result.violations[10]).toBe(0);
    expect(result.judged[10]).toBe(1);
  });
});

describe("evaluation-only constraints (§10)", () => {
  it("has no runtime dependencies and no I/O", async () => {
    // A structural assertion: the module must not import anything outside
    // itself, so it cannot pull a package or a datastore into a deployment.
    const source = await import("node:fs/promises")
      .then(fs => fs.readFile(new URL("../../lib/bm25.ts", import.meta.url), "utf8"));
    const imports = [...source.matchAll(/^\s*import[\s\S]*?from\s+["']([^"']+)["']/gm)].map(match => match[1]);
    expect(imports).toEqual([]);
    expect(source).not.toMatch(/\brequire\s*\(/);
  });
});
