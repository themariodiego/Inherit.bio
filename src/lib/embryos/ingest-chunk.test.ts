import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { EmbryoTransportError } from "./ingest-lines";
import { chunkBinding, chunkRejection, headerRejection, reservationFragments, validateChunk, zeroizeChunk } from "./ingest-chunk";
import { embryoVcfChunks } from "./vcf-transport";

/**
 * The in-memory half of the embryo chunk route. Chunks are produced by the
 * real browser rewrite (`embryoVcfChunks`) from a synthetic three-sample VCF,
 * so the server side is tested against exactly what a browser would send.
 * Every label marked SYNTHETIC or PRIVATE is invented here.
 */
const sha = (value: string | Uint8Array) => crypto.createHash("sha256").update(value).digest("hex");
const CHALLENGE = crypto.randomBytes(32).toString("base64url");
const HANDLES = [0, 1, 2].map(() => crypto.randomBytes(32).toString("base64url"));
const COHORT = "a0000000-0000-4000-8000-000000000001";

const authority = {
  status: "authorized" as const, session: COHORT, cohortId: COHORT, uploadId: COHORT, ingestRevision: 3,
  expiresAt: "2026-09-29T12:00:00+00:00", challengeHash: sha(CHALLENGE), transportRevision: 912_345,
  build: "GRCh38" as const, format: "vcf" as const, sampleCount: 3,
  handles: HANDLES.map((handle, ordinal) => ({ ordinal, hash: sha(handle) })),
};

const COLUMNS = "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSYNTHETIC_A\tSYNTHETIC_B\tSYNTHETIC_C";
const ROWS = [
  "chr1\t1000\trs1\tA\tG\t50\tPASS\t.\tGT:DP\t0/1:10\t1/1:12\t0/0:9",
  "chr2\t2000\t.\tC\tT\t.\tPASS\tPRIVATE_NOTE=1\tGT\t0/0\t0/1\t./.",
  "chrX\t3000\t.\tG\tA\t.\tPASS\t.\tGT\t0/1\t1\t0",
];
const SOURCE = `##fileformat=VCFv4.2\n##reference=GRCh38\n##SAMPLE=<ID=PRIVATE_SAMPLE>\n${COLUMNS}\n${ROWS.join("\n")}\n`;

async function browserChunk(overrides: Partial<{ challenge: string; revision: number; build: "GRCh37" | "GRCh38"; handles: string[] }> = {}) {
  const chunks = await Array.fromAsync(embryoVcfChunks(new Blob([SOURCE]), {
    challenge: CHALLENGE, revision: authority.transportRevision, build: "GRCh38", sampleCount: 3, handles: HANDLES,
    ...overrides,
  }));
  expect(chunks).toHaveLength(1);
  return chunks[0];
}

describe("binding a chunk to the issued challenge", () => {
  it("binds a chunk carrying the issued challenge, revision and handles", async () => {
    const bytes = await browserChunk();
    const binding = chunkBinding(bytes, authority);
    expect(binding).not.toBeNull();
    expect(binding!.challenge).toBe(CHALLENGE);
    expect(HANDLES.map((handle) => binding!.resolveHandle(handle))).toEqual([0, 1, 2]);
    expect(binding!.resolveHandle(crypto.randomBytes(32).toString("base64url"))).toBeNull();
  });

  it("refuses another challenge, another revision, or a session with nothing issued", async () => {
    expect(chunkBinding(await browserChunk({ challenge: crypto.randomBytes(32).toString("base64url") }), authority)).toBeNull();
    expect(chunkBinding(await browserChunk({ revision: authority.transportRevision + 1 }), authority)).toBeNull();
    const bytes = await browserChunk();
    for (const changed of [{ challengeHash: null }, { build: null }, { format: "pgt_table" as const }, { challengeHash: sha("x") }]) {
      expect(chunkBinding(bytes, { ...authority, ...changed })).toBeNull();
    }
  });
});

describe("validating and measuring a whole chunk", () => {
  it("splits every retained autosomal record into one fragment per embryo and measures what the reservation binds", async () => {
    const bytes = await browserChunk();
    const chunk = validateChunk(bytes, chunkBinding(bytes, authority)!);
    expect(chunk.sha256).toBe(sha(bytes));
    expect(chunk.byteCount).toBe(bytes.byteLength);
    // chrX never crosses: the browser discards it, so two records arrive.
    expect(chunk.recordCount).toBe(2);
    expect(chunk.maximumLineBytes).toBeGreaterThan(0);
    expect(chunk.maximumLineBytes).toBeLessThanOrEqual(chunk.byteCount);
    expect(chunk.fragments.map((fragment) => fragment.ordinal)).toEqual([0, 1, 2]);
    for (const fragment of chunk.fragments) {
      const text = new TextDecoder().decode(fragment.bytes);
      expect(fragment.sha256).toBe(sha(fragment.bytes));
      expect(fragment.lines).toBe(text.split("\n").length - 1);
      for (const secret of [CHALLENGE, ...HANDLES, "SYNTHETIC_", "PRIVATE"]) expect(text).not.toContain(secret);
      expect(text).not.toMatch(/^chrX|^X\t/m);
    }
    expect(reservationFragments(chunk)).toEqual(chunk.fragments.map((fragment) => ({
      ordinal: fragment.ordinal, bytes: fragment.bytes.byteLength, lines: fragment.lines, sha256: fragment.sha256,
    })));
  });

  it("refuses a handle this session never issued, before anything is measured", async () => {
    const bytes = await browserChunk({ handles: [HANDLES[0], HANDLES[1], crypto.randomBytes(32).toString("base64url")] });
    expect(() => validateChunk(bytes, chunkBinding(bytes, authority)!)).toThrow("invalid_session");
  });

  it("refuses a record the browser rewrite would never produce", async () => {
    const bytes = await browserChunk();
    const text = new TextDecoder().decode(bytes).replace("\t0/1:10:.:.:.:.", "\t0/1:10:.:.:.:.;PRIVATE");
    const tampered = new TextEncoder().encode(text);
    expect(() => validateChunk(tampered, chunkBinding(tampered, authority)!)).toThrow();
  });

  it("zero-fills the chunk and every fragment buffer", async () => {
    const bytes = await browserChunk();
    const chunk = validateChunk(bytes, chunkBinding(bytes, authority)!);
    zeroizeChunk(bytes, chunk);
    expect(bytes.every((byte) => byte === 0)).toBe(true);
    for (const fragment of chunk.fragments) expect(fragment.bytes.every((byte) => byte === 0)).toBe(true);
  });
});

describe("terminal answers", () => {
  it.each([
    ["too_large", "limit", 413, { error: "too_large" }],
    ["pdf_not_data", "format", 415, { error: "pdf_not_data" }],
    ["unrecognised_format", "format", 422, { error: "invalid_genetic_chunk", issues: ["format"] }],
    ["empty_after_parse", "format", 422, { error: "invalid_genetic_chunk", issues: ["records"] }],
    ["invalid_session", "header", 422, { error: "invalid_genetic_chunk", issues: ["header"] }],
    ["invalid_chunk", "chunk", 422, { error: "invalid_genetic_chunk", issues: ["framing"] }],
  ] as const)("maps %s to failure code %s and its registered %d", async (error, code, status, body) => {
    const rejection = chunkRejection(new EmbryoTransportError(error));
    expect(rejection.code).toBe(code);
    const response = rejection.response();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("records an aborted body as an abort and an unknown error as framing", async () => {
    expect(chunkRejection(new EmbryoTransportError("invalid_chunk"), true).code).toBe("abort");
    expect(chunkRejection(new Error("PRIVATE SOURCE")).code).toBe("chunk");
    expect(JSON.stringify(await chunkRejection(new Error("PRIVATE SOURCE")).response().json())).not.toContain("PRIVATE");
    expect(headerRejection.code).toBe("header");
  });
});
