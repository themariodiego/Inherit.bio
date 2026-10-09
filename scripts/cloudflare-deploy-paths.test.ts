import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Use the same installed YAML/glob libraries as the existing CI workflow tests.
// GitHub applies ordered exclusions per file, then runs if any file is included.
const require = createRequire(import.meta.url);
const localRequire = createRequire(require.resolve("eslint"));
const yaml = localRequire("js-yaml") as { load(value: string): unknown };
const minimatch = localRequire("minimatch") as {
  Minimatch: new (pattern: string, options: { dot: boolean; nonegate: boolean; nocomment: boolean }) => {
    match(name: string): boolean;
  };
};
const workflow = yaml.load(readFileSync(".github/workflows/deploy-cloudflare.yml", "utf8")) as {
  on: { push: { paths: string[] } };
};
const paths = workflow.on.push.paths;
function deploys(files: string[]): boolean {
  return files.some(file => {
    let included = false;
    for (const pattern of paths) {
      const excluded = pattern.startsWith("!");
      const matcher = new minimatch.Minimatch(excluded ? pattern.slice(1) : pattern,
        { dot: true, nonegate: true, nocomment: true });
      if (matcher.match(file)) included = !excluded;
    }
    return included;
  });
}

describe("Cloudflare deployment input paths", () => {
  it.each([
    "data/ci/browser-duration-profile.json",
    "data/ci/browser-duration-profile-v2.json",
    "data/ci/future/run/duration.json",
  ])("does not deploy for CI timing data alone: %s", file => {
    expect(deploys([file])).toBe(false);
  });

  it.each([
    ".dockerignore",
    ".github/workflows/deploy-cloudflare.yml",
    "data/citations.json",
    "data/ref/chain/hg19ToHg38.over.chain.gz",
    "data/ci-product.json",
    "package.json",
    "pnpm-lock.yaml",
    "scripts/cloudflare-deploy-guard.ts",
    "scripts/prepared-worker.run.mts",
    "scripts/server-only-shim.mjs",
    "src/lib/uploads/own-preparation-worker.ts",
    "tsconfig.json",
    "workers/prepared-artifacts/wrangler.json",
    "workers/prepared-worker/Dockerfile",
  ])("still deploys for a product or deployment input: %s", file => {
    expect(deploys([file])).toBe(true);
  });

  it.each([
    "src/lib/uploads/own-preparation-worker.ts",
    "data/citations.json",
  ])("does not suppress a product change mixed with timing data: %s", file => {
    expect(deploys(["data/ci/browser-duration-profile-v2.json", file])).toBe(true);
    expect(deploys([file, "data/ci/browser-duration-profile-v2.json"])).toBe(true);
  });
});
