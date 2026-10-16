import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pinnedBase, prefetchPinnedBase } from "./ci-pinned-base";

if (process.argv.length !== 3) throw new Error("Usage: ci-pinned-base.run.mts <Dockerfile>");
const base = pinnedBase(readFileSync(process.argv[2], "utf8"));
const source = prefetchPinnedBase(base, reference =>
  spawnSync("docker", ["pull", reference], { stdio: "inherit", timeout: 600_000 }).status === 0);
console.log(`Pinned base ${base.digest} is local (served by the ${source} registry).`);
