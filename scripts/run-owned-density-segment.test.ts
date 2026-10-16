import { describe, expect, it } from "vitest";
import { densityOwnedSegmentFrameSchema } from "./run-owned-density-segment.mjs";

const frame = () => ({ version: 1, selection: { routeId: "embryos.index", state: "empty", viewport: "390x844" },
  output: "/home/runner/fresh-owner/capture", freshPublicObservationDirectory: "/home/runner/fresh-owner/native-observations",
  fontManifestPath: "/home/runner/current-font-manifest.json", fontManifestSha256: "a".repeat(64), prepare: false });

describe("closed public owned density segment frame", () => {
  it("admits one complete public selection without credential or borrowed ownership fields", () => {
    const input = frame(); expect(densityOwnedSegmentFrameSchema.parse(input)).toEqual(input);
  });
  it.each([
    (x: ReturnType<typeof frame>) => Object.assign(x, { credential: "private-never-forwarded" }),
    (x: ReturnType<typeof frame>) => Object.assign(x, { nativeClosed: true }),
    (x: ReturnType<typeof frame>) => Object.assign(x.selection, { extra: true }),
    (x: ReturnType<typeof frame>) => { x.selection.viewport = "391x844"; },
    (x: ReturnType<typeof frame>) => { x.output = "relative/capture"; },
    (x: ReturnType<typeof frame>) => { x.output = "/home/runner/fresh-owner/../capture"; },
    (x: ReturnType<typeof frame>) => { x.fontManifestSha256 = "not-a-full-sha"; },
    (x: ReturnType<typeof frame>) => Reflect.deleteProperty(x, "freshPublicObservationDirectory"),
    (x: ReturnType<typeof frame>) => Object.assign(x, { prepare: "true" }),
  ])("refuses unknown authority, incomplete metadata or malformed selection %#", change => {
    const input = frame(); change(input); expect(() => densityOwnedSegmentFrameSchema.parse(input)).toThrow();
  });
});
