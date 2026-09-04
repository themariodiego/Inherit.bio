import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EMBRYO_INGEST_SESSION_LIMITS, INGEST_CHUNK_MAXIMUM_BYTES, megabytesOf } from "./ingest-limits";

const REGISTER = JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs/route-register.json"), "utf8")) as {
  payloadBoundaryContract: {
    ingestChunkMaximumBytes: number;
    embryoIngestSessionLimits: Record<string, number>;
  };
};

describe("ingest limits", () => {
  it("mirror docs/route-register.json#payloadBoundaryContract exactly", () => {
    expect(INGEST_CHUNK_MAXIMUM_BYTES).toBe(REGISTER.payloadBoundaryContract.ingestChunkMaximumBytes);
    expect({ ...EMBRYO_INGEST_SESSION_LIMITS }).toEqual(REGISTER.payloadBoundaryContract.embryoIngestSessionLimits);
  });

  it("render the too_large slot in whole decimal megabytes", () => {
    expect(megabytesOf(EMBRYO_INGEST_SESSION_LIMITS.maximumUncompressedInputBytes)).toBe(200);
    expect(megabytesOf(4_999_999)).toBe(4);
  });
});
