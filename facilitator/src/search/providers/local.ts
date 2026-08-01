import { createHash } from "node:crypto";
import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  EmbeddingIdentity, EmbeddingProvider, ProviderHealth, RerankIdentity,
  RerankResult, RerankerProvider,
} from "../types.js";
import { ProviderUnavailableError, validateVectors } from "../types.js";

/**
 * In-process ONNX providers.
 *
 * The runtime is `@huggingface/transformers` (Apache-2.0), which bundles
 * `onnxruntime-node` (MIT). It is an **optional peer dependency**: a
 * lexical-only operator must not be forced to install a ~200 MB native runtime,
 * and a self-hosted operator opts in with a single install. The import is
 * therefore dynamic, and its absence is a degraded state with an exact reason,
 * never a crash.
 */

interface TransformersModule {
  pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<unknown>;
  env: Record<string, unknown>;
}

export interface LocalRuntimeConfig {
  /** Directory holding the model cache. Must be writable unless `offline`. */
  cacheDir: string;
  /** When true, nothing is downloaded; a missing artifact is a degraded state. */
  offline: boolean;
  /** ONNX weight precision, e.g. `fp32`, `q8`, `q4`. */
  dtype: string;
}

let cachedModule: TransformersModule | undefined;
let moduleError: string | undefined;

/**
 * Loads the optional runtime once. The specifier is built at run time so that
 * bundlers and `tsc` do not turn the optional peer into a hard requirement.
 */
async function loadRuntime(config: LocalRuntimeConfig): Promise<TransformersModule> {
  if (cachedModule) return cachedModule;
  if (moduleError) throw new ProviderUnavailableError(moduleError);
  const specifier = ["@huggingface", "transformers"].join("/");
  try {
    const loaded = await import(/* @vite-ignore */ specifier) as unknown as TransformersModule;
    loaded.env.cacheDir = config.cacheDir;
    loaded.env.allowLocalModels = true;
    loaded.env.allowRemoteModels = !config.offline;
    cachedModule = loaded;
    return loaded;
  } catch (error) {
    moduleError = `the optional local model runtime is not installed: run \`npm install @huggingface/transformers\` (Apache-2.0, pulls onnxruntime-node) or set search.semantic.provider to disabled or remote. Underlying error: ${
      error instanceof Error ? error.message : String(error)
    }`;
    throw new ProviderUnavailableError(moduleError);
  }
}

/** Hashes the ONNX artifacts actually loaded, so the generation records what ran. */
async function onnxFiles(directory: string, depth = 0): Promise<string[]> {
  if (depth > 5) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await onnxFiles(path, depth + 1));
    else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".onnx")) files.push(path);
  }
  return files;
}

async function artifactChecksum(cacheDir: string, repo: string): Promise<string | undefined> {
  // transformers.js v3 used <cache>/<repo>/onnx; v4 follows the Hugging Face
  // cache convention models--owner--repo/snapshots/<revision>/onnx.
  const roots = [join(cacheDir, repo), join(cacheDir, `models--${repo.replaceAll("/", "--")}`)];
  try {
    let files: string[] = [];
    for (const root of roots) files.push(...await onnxFiles(root).catch(() => []));
    files = [...new Set(files)].sort();
    if (files.length === 0) return undefined;
    const digest = createHash("sha256");
    for (const path of files) {
      const info = await stat(path);
      // Hash the name and size plus the head and tail of the file: a full hash of
      // a multi-gigabyte weight file on every boot is not worth the I/O.
      digest.update(`${path.slice(cacheDir.length)}:${info.size}\n`);
      const handle = await open(path, "r");
      try {
        const sampleSize = Math.min(1 << 20, info.size);
        const head = Buffer.alloc(sampleSize);
        const tail = Buffer.alloc(sampleSize);
        await handle.read(head, 0, sampleSize, 0);
        await handle.read(tail, 0, sampleSize, Math.max(0, info.size - sampleSize));
        digest.update(head); digest.update(tail);
      } finally {
        await handle.close();
      }
    }
    return digest.digest("hex");
  } catch {
    return undefined;
  }
}

export interface LocalEmbeddingConfig extends LocalRuntimeConfig {
  /** Logical identity recorded on every vector, e.g. `BAAI/bge-m3`. */
  modelId: string;
  /** Repository holding the ONNX export, e.g. `Xenova/bge-m3`. */
  repo: string;
  /** Immutable commit sha. Required unless the operator disables pinning. */
  revision: string;
  dimension: number;
  pooling: "cls" | "mean";
  normalization: "l2" | "none";
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly identity: EmbeddingIdentity;
  private extractor: unknown;
  private failure: string | undefined;
  private checksum: string | undefined;

  constructor(private readonly config: LocalEmbeddingConfig) {
    this.identity = {
      modelId: config.modelId,
      modelRevision: config.revision,
      dimension: config.dimension,
      pooling: config.pooling,
      normalization: config.normalization,
      provider: "local",
    };
  }

  async health(): Promise<ProviderHealth> {
    if (this.extractor) {
      return { status: "ready", ...(this.checksum ? { detail: `artifact ${this.checksum.slice(0, 16)}` } : {}) };
    }
    if (this.failure) return { status: "degraded", detail: this.failure };
    return { status: "degraded", detail: "local embedding model has not been loaded yet" };
  }

  /** Loads the model. Called by the indexing worker, never on a request path. */
  async warm(): Promise<ProviderHealth> {
    try {
      await this.load();
      return this.health();
    } catch (error) {
      return { status: "degraded", detail: error instanceof Error ? error.message : String(error) };
    }
  }

  private async load(): Promise<(input: string[], options: Record<string, unknown>) => Promise<{
    tolist(): number[][];
  }>> {
    if (this.extractor) {
      return this.extractor as never;
    }
    const runtime = await loadRuntime(this.config);
    try {
      this.extractor = await runtime.pipeline("feature-extraction", this.config.repo, {
        dtype: this.config.dtype,
        revision: this.config.revision,
        local_files_only: this.config.offline,
      });
    } catch (error) {
      this.failure = `failed to load ${this.config.repo}@${this.config.revision} from ${this.config.cacheDir}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      throw new ProviderUnavailableError(this.failure);
    }
    this.checksum = await artifactChecksum(this.config.cacheDir, this.config.repo);
    if (this.checksum !== undefined) this.identity.checksum = this.checksum;
    this.failure = undefined;
    return this.extractor as never;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await this.load();
    const output = await extractor(texts, {
      pooling: this.config.pooling,
      normalize: this.config.normalization === "l2",
    });
    const vectors = output.tolist();
    // Dimension validation is not optional: a silently different model would
    // poison the index with incomparable vectors.
    validateVectors(vectors, this.config.dimension, texts.length);
    return vectors;
  }
}

export interface LocalRerankerConfig extends LocalRuntimeConfig {
  modelId: string;
  /**
   * Repository holding an ONNX cross-encoder export. Empty by default: see
   * `health()` for why.
   */
  repo: string;
  revision: string;
}

/**
 * Local cross-encoder reranker.
 *
 * The code path is real — `text-classification` over `(query, document)` pairs
 * is the correct API for a BGE cross-encoder — but no ONNX export of
 * `BAAI/bge-reranker-v2-m3` is published in a repository this runtime can load
 * (checked: the upstream repo ships Safetensors only, and neither
 * `Xenova/bge-reranker-v2-m3` nor `onnx-community/bge-reranker-v2-m3` exists).
 * Rather than fake a model, the provider stays degraded until an operator points
 * `search.reranking.repo` at their own export, and search falls back to hybrid.
 */
export class LocalRerankerProvider implements RerankerProvider {
  readonly identity: RerankIdentity;
  private classifier: unknown;
  private failure: string | undefined;

  constructor(private readonly config: LocalRerankerConfig) {
    this.identity = {
      modelId: config.modelId, modelRevision: config.revision, provider: "local",
    };
  }

  async health(): Promise<ProviderHealth> {
    if (this.classifier) return { status: "ready" };
    if (this.config.repo.length === 0) {
      return {
        status: "degraded",
        detail: `no ONNX export of ${this.config.modelId} is published for the local runtime; `
          + "set search.reranking.repo to an ONNX cross-encoder export, or use a remote "
          + "reranker, or leave reranking disabled. Search continues on hybrid results.",
      };
    }
    if (this.failure) return { status: "degraded", detail: this.failure };
    return { status: "degraded", detail: "local reranker has not been loaded yet" };
  }

  async warm(): Promise<ProviderHealth> {
    if (this.config.repo.length === 0) return this.health();
    try {
      await this.load();
      return this.health();
    } catch (error) {
      return { status: "degraded", detail: error instanceof Error ? error.message : String(error) };
    }
  }

  private async load(): Promise<(input: Array<{ text: string; text_pair: string }>) => Promise<
    Array<{ score: number }> | Array<Array<{ score: number }>>
  >> {
    if (this.classifier) return this.classifier as never;
    if (this.config.repo.length === 0) {
      throw new ProviderUnavailableError((await this.health()).detail!);
    }
    const runtime = await loadRuntime(this.config);
    try {
      this.classifier = await runtime.pipeline("text-classification", this.config.repo, {
        dtype: this.config.dtype,
        revision: this.config.revision,
        local_files_only: this.config.offline,
      });
    } catch (error) {
      this.failure = `failed to load reranker ${this.config.repo}@${this.config.revision}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      throw new ProviderUnavailableError(this.failure);
    }
    return this.classifier as never;
  }

  async rerank(query: string, documents: string[]): Promise<RerankResult[]> {
    if (documents.length === 0) return [];
    const classifier = await this.load();
    const scored = await classifier(documents.map(document => ({ text: query, text_pair: document })));
    const flat = Array.isArray(scored[0]) ? (scored as Array<Array<{ score: number }>>).map(entry => entry[0]!) : scored as Array<{ score: number }>;
    if (flat.length !== documents.length) {
      throw new ProviderUnavailableError(
        `reranker returned ${flat.length} scores for ${documents.length} documents`,
      );
    }
    return flat.map((entry, index) => ({ index, score: entry.score }));
  }
}
