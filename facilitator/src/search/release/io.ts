import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { z } from "zod";

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export function encodeJsonl(records: unknown[]): string {
  return `${records.map(record => canonicalJson(record)).join("\n")}\n`;
}

export async function readJsonl<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T[]> {
  const text = await readFile(path, "utf8");
  const records: T[] = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch (error) {
      throw new Error(`${path}:${index + 1}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    const result = schema.safeParse(parsed);
    if (!result.success) throw new Error(`${path}:${index + 1}: ${result.error.message}`);
    records.push(result.data);
  }
  return records;
}

export function rejectDuplicates<T>(records: T[], key: (record: T) => string, label: string): void {
  const seen = new Set<string>();
  for (const record of records) {
    const value = key(record);
    if (seen.has(value)) throw new Error(`duplicate ${label}: ${value}`);
    seen.add(value);
  }
}

export function seededOrder<T>(records: T[], seed: string, key: (record: T) => string): T[] {
  return [...records].sort((left, right) => {
    const a = sha256(`${seed}\0${key(left)}`);
    const b = sha256(`${seed}\0${key(right)}`);
    return a.localeCompare(b) || key(left).localeCompare(key(right));
  });
}
