import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pinnedBase, pinnedBaseContext, prefetchPinnedBase } from "./ci-pinned-base";

if (process.argv.length !== 3) throw new Error("Usage: ci-pinned-base.run.mts <Dockerfile>");
const base = pinnedBase(readFileSync(process.argv[2], "utf8"));
const source = prefetchPinnedBase(base, reference =>
  spawnSync("docker", ["pull", reference], { stdio: "inherit", timeout: 600_000 }).status === 0);
const context = pinnedBaseContext(base, source);
// Later steps of the same job read it as `docker build --build-context "$INHERIT_PINNED_BASE_CONTEXT"`.
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `INHERIT_PINNED_BASE_CONTEXT=${context}\n`);
console.log(`Pinned base ${base.digest} is local (served by the ${source} registry).`);
console.log(`Build context: ${context}`);
