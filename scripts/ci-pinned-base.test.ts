import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pinnedBase, prefetchPinnedBase } from "./ci-pinned-base";

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
});
