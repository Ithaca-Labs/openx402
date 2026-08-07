import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RELEASE_QRELS_ENV_NAME,
  assertSealedReleaseQrelsPath,
  resolveSealedReleaseQrelsPath,
} from "./holdout-v2.js";
import { runDevelopmentCi } from "./development-ci-v2.js";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

async function fixture(): Promise<{ base: string; root: string; sealed: string }> {
  const base = await mkdtemp(join(tmpdir(), "holdout-v2-"));
  temporary.push(base);
  const root = join(base, "repo", "handwritten-evals");
  const sealed = join(base, "sealed", "release-qrels.jsonl");
  await Promise.all([mkdir(root, { recursive: true }), mkdir(resolve(sealed, ".."), { recursive: true })]);
  await writeFile(sealed, "{}\n");
  return { base, root, sealed };
}

describe("release holdout isolation", () => {
  it("requires an absolute existing release-qrels path outside the benchmark tree", async () => {
    const { root, sealed } = await fixture();
    expect(assertSealedReleaseQrelsPath(root, sealed)).toBe(sealed);
    await expect(resolveSealedReleaseQrelsPath(root, sealed)).resolves.toBe(await realpath(sealed));
    expect(() => assertSealedReleaseQrelsPath(root, "qrels/release.jsonl")).toThrow(/absolute path/);
    expect(() => assertSealedReleaseQrelsPath(root, join(root, "qrels/release.jsonl"))).toThrow(/outside/);
    await expect(resolveSealedReleaseQrelsPath(root, undefined)).rejects.toThrow(RELEASE_QRELS_ENV_NAME);
  });

  it("rejects an outside symlink that resolves back into the benchmark tree", async () => {
    const { base, root } = await fixture();
    const internal = join(root, "hidden.jsonl");
    const link = join(base, "sealed", "link.jsonl");
    await writeFile(internal, "{}\n");
    await symlink(internal, link);
    await expect(resolveSealedReleaseQrelsPath(root, link)).rejects.toThrow(/resolve inside/);
  });

  it("keeps the every-commit runner development-only and activates after freeze", async () => {
    const { root } = await fixture();
    await expect(runDevelopmentCi(root)).resolves.toMatchObject({ status: "not_ready", query_count: 0 });
    const source = await readFile(resolve(import.meta.dirname, "development-ci-v2.ts"), "utf8");
    expect(source).not.toContain("release-v2.jsonl");
    expect(source).not.toContain(RELEASE_QRELS_ENV_NAME);
    const workflow = await readFile(resolve(import.meta.dirname, "../../../.github/workflows/handwritten-evals.yml"), "utf8");
    const packageJson = JSON.parse(await readFile(resolve(import.meta.dirname, "../../package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(workflow).toContain("Run 50-query development benchmark");
    expect(workflow).toContain("npm run benchmark:v2:development-ci");
    expect(packageJson.scripts?.["benchmark:v2:development-ci"]).toBe(
      "tsx handwritten-evals/tools/development-ci-v2.ts",
    );
  });

  it("routes release report tools through the sealed resolver", async () => {
    for (const filename of ["generate-report-v2.ts", "finalize-report-v2.ts"]) {
      const source = await readFile(resolve(import.meta.dirname, filename), "utf8");
      expect(source).not.toContain("qrels/release-v2.jsonl");
      expect(source).toContain("resolveSealedReleaseQrelsPath");
      expect(source).toContain("verifyPoolSnapshot");
    }
  });
});
