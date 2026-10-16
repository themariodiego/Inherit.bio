import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { EmbryoTransportError } from "./ingest-lines";
import { chunkBinding, chunkRejection, headerRejection, mappingRequired, reservationFragments, tableChunkBinding, tableLocus,
  validateChunk, validateTableChunk, zeroizeChunk } from "./ingest-chunk";
import { embryoVcfChunks } from "./vcf-transport";
import { embryoTableChunks } from "./table-transport";
import { resolveTableRsid } from "./table-reference";

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

/**
 * ADR 0037: the table half. Chunks come from the real browser table rewrite
 * over a synthetic table; the rsIDs are sites of the shipped coordinate
 * reference (`data/ref/build-discriminating-sites.json`), so resolving them
 * is a real lookup.
 */
describe("binding and validating a laboratory-table chunk", () => {
  const table = { ...authority, format: "pgt_table" as const };
  const SOURCE_TABLE = "Sample,SNP,Genotype,Sex\nPRIVATE_A,rs116422505,TC,XX\nPRIVATE_B,rs116422505,CC,XY\nPRIVATE_C,rs12139609,AG,XX\nPRIVATE_A,rs999999999999,AA,XX\n";
  async function tableChunk(source = SOURCE_TABLE, overrides: Partial<{ challenge: string; revision: number }> = {}) {
    const [chunk] = await Array.fromAsync(embryoTableChunks(new Blob([source]), {
      challenge: CHALLENGE, revision: authority.transportRevision, build: "GRCh38", sampleCount: 3, handles: HANDLES,
      mapping: { complete: true, identifier: { field: "sample", column: 0 }, genotype: 2, locus: { kind: "rsid", column: 1 } },
      ...overrides,
    }));
    return chunk;
  }

  it("binds only a table session with a resolved build, an issued transport and a recorded locus", async () => {
    const bytes = await tableChunk();
    const binding = tableChunkBinding(bytes, table, "rsid", resolveTableRsid);
    expect(binding).toMatchObject({ challenge: CHALLENGE, build: "GRCh38", locusKind: "rsid", sampleCount: 3 });
    expect(HANDLES.map((handle) => binding!.resolveHandle(handle))).toEqual([0, 1, 2]);
    for (const [changed, locus] of [[{ build: null }, "rsid"], [{ challengeHash: null }, "rsid"], [{ format: "vcf" as const }, "rsid"],
      [{ challengeHash: sha("x") }, "rsid"], [{}, null]] as const) {
      expect(tableChunkBinding(bytes, { ...table, ...changed }, locus, resolveTableRsid)).toBeNull();
    }
    expect(tableChunkBinding(await tableChunk(SOURCE_TABLE, { revision: authority.transportRevision + 1 }), table, "rsid", resolveTableRsid)).toBeNull();
    expect(tableChunkBinding(await browserChunk(), table, "rsid", resolveTableRsid)).toBeNull();
    expect(chunkBinding(bytes, table)).toBeNull();
  });

  it("resolves each rsID from the reference store in the resolved build, and refuses one it does not hold", async () => {
    const bytes = await tableChunk();
    const binding = tableChunkBinding(bytes, table, "rsid", resolveTableRsid)!;
    // rs999999999999 is not in the store: the whole chunk is refused, never guessed.
    expect(() => validateTableChunk(bytes, binding)).toThrow("unrecognised_format");
    const held = await tableChunk(SOURCE_TABLE.replace("PRIVATE_A,rs999999999999,AA,XX\n", ""));
    const validated = validateTableChunk(held, tableChunkBinding(held, table, "rsid", resolveTableRsid)!);
    expect(validated.fragments.map((fragment) => new TextDecoder().decode(fragment.bytes))).toEqual([
      "##inheritTableFragment=1\n##reference=GRCh38\nchrom\tpos\trsid\tgenotype\n1\t22133085\trs116422505\tT/C\n",
      "##inheritTableFragment=1\n##reference=GRCh38\nchrom\tpos\trsid\tgenotype\n1\t22133085\trs116422505\tC/C\n",
      "##inheritTableFragment=1\n##reference=GRCh38\nchrom\tpos\trsid\tgenotype\n1\t22134498\trs12139609\tA/G\n",
    ]);
    expect(validated).toMatchObject({ recordCount: 3, byteCount: held.byteLength, sha256: sha(held) });
    // The same rsID resolves to its GRCh37 coordinate in a GRCh37 session.
    expect(resolveTableRsid(116422505, "GRCh37")).toEqual({ chrom: 1, pos: 22459578 });
    expect(resolveTableRsid(999999999999, "GRCh38")).toBeNull();
    expect(reservationFragments(validated).map((fragment) => fragment.ordinal)).toEqual([0, 1, 2]);
  });

  it("answers mapping_required with a constant body and no referrer", async () => {
    const response = mappingRequired();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "mapping_required" });
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("reads the recorded locus kind through credentials only, and refuses anything outside its vocabulary", async () => {
    const credentials = { p_account_id: COHORT, p_auth_session_id: COHORT, p_ingest_session_id: COHORT,
      p_cookie_hash: "a".repeat(64), p_origin: "https://inherit.example", p_test_jurisdiction: true as const };
    const seen: unknown[] = [];
    expect(await tableLocus(credentials, async (args) => { seen.push(args); return { data: "chrom-pos", error: null }; })).toBe("chrom-pos");
    expect(seen).toEqual([credentials]);
    expect(await tableLocus(credentials, async () => ({ data: null, error: null }))).toBeNull();
    await expect(tableLocus(credentials, async () => ({ data: "sample", error: null }))).rejects.toThrow();
    await expect(tableLocus(credentials, async () => ({ data: null, error: { code: "42501" } }))).rejects.toThrow();
  });
});
