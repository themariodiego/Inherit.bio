import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pinnedBase, pinnedBaseContext, prefetchPinnedBase } from "./ci-pinned-base";

const DIGEST = "c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392";
const PINNED = `FROM public.ecr.aws/docker/library/node:22-bookworm-slim@sha256:${DIGEST}`;

describe("pinned CI base images", () => {
  it("reads the exact pinned base of both committed runtime Dockerfiles", () => {
    expect(pinnedBase(readFileSync("scripts/ci-browser/Dockerfile", "utf8"))).toEqual({
      repository: "node", tag: "22-bookworm-slim", digest: `sha256:${DIGEST}`,
      primary: `public.ecr.aws/docker/library/node:22-bookworm-slim@sha256:${DIGEST}`,
      mirror: `mirror.gcr.io/library/node@sha256:${DIGEST}`,
    });
    expect(pinnedBase(readFileSync("workers/prepared-worker/Dockerfile", "utf8")).mirror)
      .toBe("mirror.gcr.io/library/node@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20");
  });

  it.each([
    ["a tag without a digest", "FROM public.ecr.aws/docker/library/node:22-bookworm-slim"],
    ["another registry", `FROM docker.io/library/node:22-bookworm-slim@sha256:${DIGEST}`],
    ["a non-official repository", `FROM public.ecr.aws/example/node:22@sha256:${DIGEST}`],
    ["an uppercase digest", PINNED.toUpperCase().replace("FROM PUBLIC.ECR.AWS/DOCKER/LIBRARY/NODE:22-BOOKWORM-SLIM", "FROM public.ecr.aws/docker/library/node:22-bookworm-slim")],
    ["a short digest", "FROM public.ecr.aws/docker/library/node:22-bookworm-slim@sha256:c3de60bf"],
    ["two stages", `${PINNED}\nFROM ${PINNED.slice(5)}`],
    ["no FROM", "RUN true"],
  ])("refuses %s", (_, dockerfile) => {
    expect(() => pinnedBase(dockerfile)).toThrow(/ci_pinned_base:/);
  });

  it("uses the pinned registry first and asks the mirror only after it fails, always by the same digest", () => {
    const base = pinnedBase(PINNED), asked: string[] = [];
    expect(prefetchPinnedBase(base, reference => { asked.push(reference); return true; })).toBe("primary");
    expect(asked).toEqual([base.primary]);
    asked.length = 0;
    expect(prefetchPinnedBase(base, reference => { asked.push(reference); return reference === base.mirror; })).toBe("mirror");
    expect(asked).toEqual([base.primary, base.mirror]);
    expect(asked.every(reference => reference.endsWith(`@sha256:${DIGEST}`))).toBe(true);
    expect(() => prefetchPinnedBase(base, () => false)).toThrow("ci_pinned_base:unavailable");
  });

  it("maps the exact pinned FROM to the exact reference that was pulled", () => {
    const base = pinnedBase(PINNED);
    expect(pinnedBaseContext(base, "primary")).toBe(`${base.primary}=docker-image://${base.primary}`);
    expect(pinnedBaseContext(base, "mirror")).toBe(`${base.primary}=docker-image://mirror.gcr.io/library/node@sha256:${DIGEST}`);
  });

  it("exports the mirror context to later steps when the pinned registry refuses", () => {
    const root = mkdtempSync(join(tmpdir(), "ci-pinned-base-"));
    try {
      const pulls = join(root, "pulls"), env = join(root, "github-env");
      writeFileSync(join(root, "docker"), `#!/bin/sh\necho "$2" >> "${pulls}"\ncase "$2" in public.ecr.aws/*) exit 1;; esac\nexit 0\n`);
      chmodSync(join(root, "docker"), 0o755);
      writeFileSync(env, "");
      const run = spawnSync(process.execPath, ["--import", "tsx", "scripts/ci-pinned-base.run.mts", "scripts/ci-browser/Dockerfile"], {
        encoding: "utf8", env: { ...process.env, PATH: `${root}:${process.env.PATH}`, GITHUB_ENV: env },
      });
      expect(run.status, run.stderr).toBe(0);
      const base = pinnedBase(readFileSync("scripts/ci-browser/Dockerfile", "utf8"));
      expect(readFileSync(pulls, "utf8").trim().split("\n")).toEqual([base.primary, base.mirror]);
      expect(readFileSync(env, "utf8")).toBe(`INHERIT_PINNED_BASE_CONTEXT=${pinnedBaseContext(base, "mirror")}\n`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("prefetches immediately before every CI build of the runtime image and passes its context", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8").split("\n").map(line => line.trim());
    const builds = workflow.flatMap((line, index) => line.includes("--file scripts/ci-browser/Dockerfile") ? [index] : []);
    expect(builds).toHaveLength(3);
    for (const index of builds) {
      expect(workflow[index]).toBe('run: docker build --build-context "$INHERIT_PINNED_BASE_CONTEXT" --tag inherit-ci-browser:local --file scripts/ci-browser/Dockerfile scripts/ci-browser');
      expect(workflow[index - 2]).toBe("run: pnpm exec tsx scripts/ci-pinned-base.run.mts scripts/ci-browser/Dockerfile");
    }
  });

  it.each(["mirror", "primary"] as const)("builds the prepared worker from the same digest when the %s pull serves", source => {
    const root = mkdtempSync(join(tmpdir(), "ci-prepared-worker-"));
    try {
      const calls = join(root, "calls");
      const refuse = source === "mirror" ? 'case "$1:$2" in pull:public.ecr.aws/*) exit 1;; esac\n' : "";
      writeFileSync(join(root, "docker"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${calls}"\n${refuse}exit 0\n`);
      chmodSync(join(root, "docker"), 0o755);
      const run = spawnSync("sh", ["scripts/ci-prepared-worker-build.sh"], {
        encoding: "utf8", env: { ...process.env, PATH: `${root}:${process.env.PATH}` },
      });
      expect(run.status, run.stderr).toBe(0);
      const base = pinnedBase(readFileSync("workers/prepared-worker/Dockerfile", "utf8"));
      expect(readFileSync(calls, "utf8").trim().split("\n")).toEqual([
        `pull ${base.primary}`, ...(source === "mirror" ? [`pull ${base.mirror}`] : []),
        `build --build-context ${pinnedBaseContext(base, source)} --file workers/prepared-worker/Dockerfile --tag inherit-prepared-worker:ci .`,
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to build the prepared worker when neither pull serves the digest", () => {
    const root = mkdtempSync(join(tmpdir(), "ci-prepared-worker-"));
    try {
      writeFileSync(join(root, "docker"), "#!/bin/sh\n[ \"$1\" = pull ] && exit 1\nexit 0\n");
      chmodSync(join(root, "docker"), 0o755);
      const run = spawnSync("sh", ["scripts/ci-prepared-worker-build.sh"], {
        encoding: "utf8", env: { ...process.env, PATH: `${root}:${process.env.PATH}` },
      });
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("ci_pinned_base:unavailable");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
