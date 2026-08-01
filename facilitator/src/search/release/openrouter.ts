import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { canonicalJson, sha256 } from "./io.js";

const responseSchema = z.object({
  id: z.string().optional(), model: z.string(), provider: z.string().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
}).passthrough();

export interface OpenRouterRecord<T> {
  value: T;
  /** Exact parsed OpenRouter envelope, cached locally under an ignored path. */
  raw_response?: unknown;
  provenance: {
    requested_model: string; returned_model: string; request_id?: string; provider?: string;
    prompt_hash: string; requested_at: string; response_hash: string; cache_path: string;
  };
}

export interface OpenRouterOptions {
  cacheDir: string;
  model?: string;
  maxAttempts?: number;
  minIntervalMs?: number;
  maxResponseBytes?: number;
}

let previousRequest = 0;

async function wait(ms: number): Promise<void> {
  if (ms > 0) await new Promise(resolve => setTimeout(resolve, ms));
}

/** Reproducible, cached OpenRouter JSON call. The API key is read only at call time. */
export async function openRouterJson<T>(
  system: string,
  input: unknown,
  outputSchema: z.ZodType<T>,
  options: OpenRouterOptions,
): Promise<OpenRouterRecord<T>> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required; it is never read from a file or written to cache");
  const model = options.model ?? process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v4-flash";
  const prompt = canonicalJson({ system, input, model, temperature: 0 });
  const promptHash = sha256(prompt);
  const cachePath = `${options.cacheDir}/${promptHash}.json`;
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8")) as OpenRouterRecord<T>;
    return { ...cached, value: outputSchema.parse(cached.value) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const attempts = options.maxAttempts ?? 4;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const interval = options.minIntervalMs ?? 1_100;
    await wait(Math.max(0, previousRequest + interval - Date.now()));
    previousRequest = Date.now();
    const requestedAt = new Date().toISOString();
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model, temperature: 0,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: system }, { role: "user", content: canonicalJson(input) }],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > (options.maxResponseBytes ?? 8 * 1024 * 1024)) throw new Error("OpenRouter response exceeded size limit");
      const rawText = new TextDecoder().decode(bytes);
      if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${rawText.slice(0, 500)}`);
      const envelope = responseSchema.parse(JSON.parse(rawText));
      const content = envelope.choices[0]!.message.content;
      const value = outputSchema.parse(JSON.parse(content));
      const record: OpenRouterRecord<T> = {
        value,
        raw_response: JSON.parse(rawText),
        provenance: {
          requested_model: model,
          returned_model: envelope.model,
          ...(envelope.id ? { request_id: envelope.id } : {}),
          ...(envelope.provider ? { provider: envelope.provider } : {}),
          prompt_hash: promptHash,
          requested_at: requestedAt,
          response_hash: sha256(bytes),
          cache_path: cachePath,
        },
      };
      await mkdir(dirname(cachePath), { recursive: true });
      await writeFile(cachePath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
      return record;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await wait(Math.min(1_000 * 2 ** attempt, 8_000));
    }
  }
  throw lastError;
}
