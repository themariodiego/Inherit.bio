import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), getClaims: vi.fn(), fetch: vi.fn(), remove: vi.fn(), completionFactory: vi.fn() }));
vi.mock("./normalization-database", () => ({ normalizationDatabaseCompletion: mocks.completionFactory }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc, storage: { from: () => mocks } }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: mocks }) }));
import { normalizeSubjectFile } from "./subject-normalization";
import panelFile from "../../../data/ref/read-calling-loci.json";
import { callReadsFile } from "../genome/reads/read-calls";
import { readCallsProvenance, readCallsProvenanceSchema } from "../genome/reads/provenance";
import { readCallsMarker, READ_CALLS_NOTE, READ_CALLS_SOURCE } from "../genome/reads/read-call-vcf";
import type { ReadCallingPanel } from "../genome/reads/panel";

/**
 * Read-calling provenance is written by the server's normalization only, only
 * under TEST-LOCAL, and only for the caller's exact header (ADR 0038). These
 * cases run the real route handler over the real VCF the caller writes from
 * the invented product BAM, with the database and Storage replaced by the
 * same narrow stubs `subject-normalization.test.ts` uses.
 */

const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", sessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const fileId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", claim = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const objectKey = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", objectId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const subjectId = "11111111-1111-4111-8111-111111111111";
const receipt = { fileId, status: "normalization_complete", analysisState: "not_generated" };
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const expectedReadCalls = { version: "inherit-read-calls-v1", input: "BAM", minimumDepth: 10, minimumBaseQuality: 20,
  minimumMappingQuality: 20, heterozygousLow: 0.25, heterozygousHigh: 0.75, homozygousMinimum: 0.9, reviewed: false };

let source: Buffer, manifest: Record<string, unknown>, readCalledVcf: string;
function setSource(text: string) {
  source = Buffer.from(text);
  manifest.sizeBytes = source.length; manifest.rawSha256 = hash(source); manifest.decodedSha256 = hash(source);
}
const send = () => normalizeSubjectFile(new Request(`https://inherit.bio/api/files/${fileId}/process`, { method: "POST",
  headers: { origin: "https://inherit.bio", "sec-fetch-site": "same-origin" } }), fileId);
async function completedProvenance() {
  const response = await send();
  expect(response.status).toBe(200);
  const complete = mocks.rpc.mock.calls.find((call) => call[1].p_operation === "complete")![1].p_payload;
  return complete.provenance as Record<string, unknown>;
}

beforeEach(async () => {
  vi.resetAllMocks(); vi.stubGlobal("fetch", mocks.fetch);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.completionFactory.mockReturnValue(null);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://storage.example.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-key");
  manifest = { status: "authorized", fileId, claim, subjectId, bucket: "genomes", objectKey, objectId,
    sizeBytes: 1, rawSha256: "a".repeat(64), decodedSha256: "b".repeat(64), sourceRevision: 1,
    maximumDecodedBytes: 20_000_000, fileType: "vcf" };
  readCalledVcf ??= (await callReadsFile({ reads: new Blob([readFileSync("e2e/fixtures/read-calls-product-grch38.bam")]),
    reference: null, panel: panelFile as unknown as ReadCallingPanel })).vcf;
  setSource(readCalledVcf);
  mocks.getUser.mockResolvedValue({ data: { user: { id: accountId } } });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: accountId, session_id: sessionId } } });
  mocks.rpc.mockImplementation(async (name, args) => {
    if (name === "register_own_normalization_positions_v1") return { data: {
      acceptedVariantOrdinals: args.p_entries.flatMap((entry: { variant: unknown }, index: number) => entry.variant ? [index] : []),
      attempted: 0, unmapped: 0 }, error: null };
    return { data: args.p_operation === "begin" || args.p_operation === "check" ? manifest
      : args.p_operation === "complete" ? receipt : true, error: null };
  });
  mocks.fetch.mockImplementation(async (_url, options: RequestInit) => {
    const [, first, last] = /^bytes=(\d+)-(\d+)$/.exec(new Headers(options.headers).get("range")!)!;
    return new Response(new Uint8Array(source.subarray(+first, +last + 1)), { status: 206,
      headers: { "content-range": `bytes ${first}-${last}/${source.length}` } });
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("read-calling provenance in the canonical normalization", () => {
  it("production never writes it, even for the caller's exact file", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    const provenance = await completedProvenance();
    expect(provenance).not.toHaveProperty("readCalls");
    expect(Object.keys(provenance).sort()).toEqual(["attempted", "buildBasis", "chainSha256", "counts", "sourceBuild",
      "sourceSha256", "targetBuild", "variantRowsMapped", "variantRowsUnmapped", "version"]);
  });

  it("TEST-LOCAL writes it for the caller's exact header, with the thresholds used and reviewed false", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
    const provenance = await completedProvenance();
    expect(provenance.readCalls).toEqual(expectedReadCalls);
    expect(provenance).toMatchObject({ version: "listed-calls-v1", sourceBuild: "GRCh38",
      counts: { called: 3, noCall: 1, unsupported: 0, failedFilter: 0, blocks: 0, singleSample: true, buildClaim: true } });
  });

  it("TEST-LOCAL does not write it for an ordinary VCF, or for a header that is not the caller's exact one", async () => {
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
    const ordinary = readCalledVcf.split("\n").filter((line) => !line.startsWith("##inheritReadCalls") && !line.startsWith("##source=")).join("\n");
    for (const text of [ordinary,
      readCalledVcf.replace("MinimumDepth=10", "MinimumDepth=3"),
      readCalledVcf.replace("Reviewed=false", "Reviewed=true"),
      readCalledVcf.replace(READ_CALLS_SOURCE, "##source=someone else"),
      readCalledVcf.replace(READ_CALLS_NOTE, `${READ_CALLS_NOTE}\n${READ_CALLS_NOTE}`)]) {
      mocks.rpc.mockClear();
      setSource(text);
      expect(await completedProvenance()).not.toHaveProperty("readCalls");
    }
  });
});

describe("readCallsProvenance", () => {
  const exact = [READ_CALLS_SOURCE, readCallsMarker("CRAM"), READ_CALLS_NOTE];
  it("answers only under TEST-LOCAL and only for one exact marker, source and note", () => {
    expect(readCallsProvenance(exact, false)).toBeNull();
    expect(readCallsProvenance(exact, true)).toEqual({ ...expectedReadCalls, input: "CRAM" });
    expect(readCallsProvenance([...exact, readCallsMarker("BAM")], true)).toBeNull();
    expect(readCallsProvenance(exact.slice(0, 2), true)).toBeNull();
    expect(readCallsProvenance([READ_CALLS_SOURCE, readCallsMarker("CRAM").replace("CRAM", "FASTQ"), READ_CALLS_NOTE], true)).toBeNull();
  });
  it("has a closed shape that refuses reviewed thresholds and fractions outside [0, 1]", () => {
    expect(readCallsProvenanceSchema.safeParse({ ...expectedReadCalls, reviewed: true }).success).toBe(false);
    expect(readCallsProvenanceSchema.safeParse({ ...expectedReadCalls, heterozygousHigh: 1.5 }).success).toBe(false);
    expect(readCallsProvenanceSchema.safeParse({ ...expectedReadCalls, minimumDepth: -1 }).success).toBe(false);
    expect(readCallsProvenanceSchema.safeParse({ ...expectedReadCalls, extra: 1 }).success).toBe(false);
  });
});
