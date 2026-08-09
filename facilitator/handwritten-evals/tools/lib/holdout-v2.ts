/** Filesystem isolation for BUILD-PLAN §12.1 release judgments. */

import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";

export const RELEASE_QRELS_ENV_NAME = "STELLAR_BAZAAR_RELEASE_QRELS_PATH";

export const SealedReleaseQrelsPathSchema = z.string().min(1).refine(
  value => isAbsolute(value),
  "must be an absolute path outside the handwritten-evals tree",
);

function containedBy(parent: string, child: string): boolean {
  const result = relative(resolve(parent), resolve(child));
  return result === "" || (!isAbsolute(result) && result !== ".." && !result.startsWith(`..${sep}`));
}

/** Validates a planned output path without reading the holdout file. */
export function assertSealedHoldoutArtifactPath(rootInput: string, pathInput: string, label = "holdout artifact"): string {
  const root = resolve(rootInput);
  const path = resolve(SealedReleaseQrelsPathSchema.parse(pathInput));
  if (containedBy(root, path)) {
    throw new Error(`${path}: ${label} must be stored outside the handwritten-evals tree`);
  }
  return path;
}

/** Backward-compatible specific name used by report runners. */
export function assertSealedReleaseQrelsPath(rootInput: string, pathInput: string): string {
  return assertSealedHoldoutArtifactPath(rootInput, pathInput, "release qrels");
}

/** Resolves an existing sealed file and rejects symlink escapes back into the repository tree. */
export async function resolveSealedReleaseQrelsPath(
  rootInput: string,
  environmentPath: string | undefined,
): Promise<string> {
  if (!environmentPath) {
    throw new Error(
      `release judgments are sealed; set ${RELEASE_QRELS_ENV_NAME} to an absolute path outside the handwritten-evals tree`,
    );
  }
  const root = resolve(rootInput);
  const path = assertSealedReleaseQrelsPath(root, environmentPath);
  const [realRoot, realPath] = await Promise.all([realpath(root), realpath(path)]);
  if (containedBy(realRoot, realPath)) {
    throw new Error(`${path}: release qrels resolve inside the handwritten-evals tree`);
  }
  return realPath;
}
