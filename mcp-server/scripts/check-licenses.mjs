import { readFile } from "node:fs/promises";

const allowed = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "ISC",
  "MIT",
  "Unlicense",
]);

const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
if (lock.lockfileVersion !== 3 || typeof lock.packages !== "object") {
  throw new Error("package-lock.json must use lockfileVersion 3 and include package metadata");
}

const rejected = [];
const counts = new Map();
for (const [path, metadata] of Object.entries(lock.packages)) {
  if (!path.includes("node_modules/")) continue;
  // Workspace symlinks carry their metadata in their own lock entry.
  if (metadata.link === true) continue;

  const name = path.split("node_modules/").at(-1);
  const license = metadata.license;
  if (typeof license !== "string" || !allowed.has(license)) {
    rejected.push(`${name}: ${license ?? "missing"}`);
    continue;
  }
  counts.set(license, (counts.get(license) ?? 0) + 1);
}

if (rejected.length > 0) {
  throw new Error(`Disallowed or unknown dependency licenses:\n${rejected.join("\n")}`);
}

const summary = [...counts.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([license, count]) => `${license}=${count}`)
  .join(", ");
const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
console.log(`Checked ${total} locked packages: ${summary}`);
