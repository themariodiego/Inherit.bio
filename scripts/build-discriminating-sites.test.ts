import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { inverseChain, verifyReference } from "./build-discriminating-sites";

describe("build reference provenance and coordinate conversion", () => {
  it("verifies every committed pair and both input hashes offline", async () => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network permitted"));
    try { await verifyReference(); expect(network).not.toHaveBeenCalled(); }
    finally { network.mockRestore(); }
  });

  it("inverts positive and negative chain boundaries without an off-by-one", () => {
    const chain = gzipSync("chain 100 1 1000 + 100 110 1 1000 + 200 210 1\n10\n\n"
      + "chain 100 2 1000 + 100 110 2 1000 - 300 310 2\n10\n\n");
    const inverse = inverseChain(chain);
    expect(inverse(1, 200)).toBeNull();
    expect(inverse(1, 201)).toBe(101);
    expect(inverse(1, 210)).toBe(110);
    expect(inverse(1, 211)).toBeNull();
    expect(inverse(2, 690)).toBeNull();
    expect(inverse(2, 691)).toBe(110);
    expect(inverse(2, 700)).toBe(101);
    expect(inverse(2, 701)).toBeNull();
  });

  it("rejects multiple inverse sources and excludes scaffolds and sex chromosomes", () => {
    const inverse = inverseChain(gzipSync(
      "chain 100 1 1000 + 100 110 1 1000 + 200 210 1\n10\n\n"
      + "chain 100 1 1000 + 300 310 1 1000 + 200 210 2\n10\n\n"
      + "chain 100 23 1000 + 100 110 23 1000 + 200 210 3\n10\n\n"
      + "chain 100 GL001 1000 + 100 110 2 1000 + 200 210 4\n10\n\n",
    ));
    expect(inverse(1, 205)).toBeNull();
    expect(inverse(23, 205)).toBeNull();
    expect(inverse(2, 205)).toBeNull();
  });
});
