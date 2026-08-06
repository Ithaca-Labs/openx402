#!/usr/bin/env node

/** CLI for the BUILD-PLAN Step 6 immutable dataset freeze. */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { freezeDatasetV2 } from "./manifest-v2.js";

export interface FreezeManifestCliOptions {
  root: string;
  frozenAt?: string;
}

export function parseFreezeManifestArgs(argv: string[]): FreezeManifestCliOptions {
  let root = resolve(import.meta.dirname, "..");
  let frozenAt: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    if (argument === "--root") {
      const value = argv[++index];
      if (!value) throw new Error("--root requires a path");
      root = resolve(value);
    } else if (argument === "--frozen-at") {
      const value = argv[++index];
      if (!value) throw new Error("--frozen-at requires an ISO timestamp");
      frozenAt = value;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return frozenAt === undefined ? { root } : { root, frozenAt };
}

export async function runFreezeManifestCli(argv: string[]): Promise<void> {
  const result = await freezeDatasetV2(parseFreezeManifestArgs(argv));
  console.log(`frozen: ${result.manifest.counts.resources.total} resources, ${result.manifest.counts.queries.total} queries`);
  console.log(`manifest: ${result.manifestPath}`);
  console.log(`release index: ${result.releaseQueryIndexPath} (IDs + hashes only; no judgments)`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runFreezeManifestCli(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
