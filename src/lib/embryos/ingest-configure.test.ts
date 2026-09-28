import { describe, expect, it } from "vitest";
import {
  BUILD_EVIDENCE_MAXIMUM_CHARACTERS,
  BUILD_EVIDENCE_MAXIMUM_LINES,
  CONFIGURE_BODY_MAXIMUM_BYTES,
  VCF_TRANSPORT_KEYS,
  configureResult,
  configuredResponse,
  deriveHeaderBuild,
  isPermittedEvidenceLine,
  newTransportChallenge,
  readConfigureBody,
  terminalResponse,
} from "./ingest-configure";

/**
 * The boundary of `api.embryo-ingest-configure` (ADR 0035). Synthetic header
 * lines only: the contig lengths are the public chromosome 1 lengths the
 * product parser already pins, and nothing here is anyone's data.
 */
const GRCH38 = "##contig=<ID=chr1,length=248956422>";
const GRCH37 = "##contig=<ID=1,length=249250621>";
const VALID = {
  format: "vcf",
  buildEvidence: ["##fileformat=VCFv4.2", "##reference=GRCh38", GRCH38],
  sampleCount: 3,
  nonce: "sealed.token",
};

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://inherit.example/api/embryo-ingest/x/configure", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("the configure request body", () => {
  it("accepts the four closed fields", async () => {
    const parsed = await readConfigureBody(post(VALID));
    expect(parsed).toEqual({ ok: true, body: VALID });
  });

  it("accepts zero lines, which the build rule then answers as unknown", async () => {
    expect((await readConfigureBody(post({ ...VALID, buildEvidence: [] }))).ok).toBe(true);
  });

  /** `methodRequestContracts.POST.forbiddenFields`, each on its own. */
  it.each([
    "header", "chromLine", "sampleNames", "sampleLabel", "embryoLabel", "sourceLabel", "labIdentifier",
    "referenceBuild", "build", "sex", "buildThreshold", "inferenceMatchCount", "inferenceAgreement",
  ])("refuses the forbidden field %s as an invalid request", async (field) => {
    expect(await readConfigureBody(post({ ...VALID, [field]: "GRCh38" }))).toEqual({ ok: false, issues: ["body"] });
  });

  /**
   * `forbiddenLines`: anything but `##fileformat`, `##reference` and
   * `##contig`. These are the lines that can name a person or a laboratory.
   * Planted regression: without the prefix check in `readConfigureBody`,
   * every one of these parses as a valid request.
   */
  it.each([
    "#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\tSAMPLE_A\tSAMPLE_B",
    "#CHROM",
    "##SAMPLE=<ID=SAMPLE_A,Description=\"synthetic\">",
    "##PEDIGREE=<Child=SAMPLE_A,Mother=SAMPLE_B>",
    "##source=SyntheticCaller",
    "##INFO=<ID=END,Number=1,Type=Integer,Description=\"End\">",
    "##fileDate=20260928",
    "##contig",
    "##Contig=<ID=chr1,length=248956422>",
    " ##reference=GRCh38",
    "chr1\t1\t.\tA\tG\t.\tPASS\t.\tGT\t0/1",
  ])("refuses the forbidden line %j", async (line) => {
    const parsed = await readConfigureBody(post({ ...VALID, buildEvidence: [...VALID.buildEvidence, line] }));
    expect(parsed).toEqual({ ok: false, issues: ["buildEvidence"] });
  });

  it("refuses a line carrying a control character, so no second line hides inside one", async () => {
    for (const line of ["##reference=GRCh38\n#CHROM", "##reference=GRCh38\r", "##contig=<ID=chr1,\tlength=1>"]) {
      expect(await readConfigureBody(post({ ...VALID, buildEvidence: [line] })))
        .toEqual({ ok: false, issues: ["buildEvidence"] });
    }
  });

  it("bounds the copy at 64 lines of 512 characters", async () => {
    const lines = Array.from({ length: BUILD_EVIDENCE_MAXIMUM_LINES }, () => "##reference=GRCh38");
    expect((await readConfigureBody(post({ ...VALID, buildEvidence: lines }))).ok).toBe(true);
    expect(await readConfigureBody(post({ ...VALID, buildEvidence: [...lines, "##reference=GRCh38"] })))
      .toEqual({ ok: false, issues: ["buildEvidence"] });
    const longest = `##reference=${"x".repeat(BUILD_EVIDENCE_MAXIMUM_CHARACTERS - 12)}`;
    expect((await readConfigureBody(post({ ...VALID, buildEvidence: [longest] }))).ok).toBe(true);
    expect(await readConfigureBody(post({ ...VALID, buildEvidence: [`${longest}x`] })))
      .toEqual({ ok: false, issues: ["buildEvidence"] });
  });

  it.each([0, -1, 1.5, "3", null, 2 ** 53])("refuses the sample count %j", async (sampleCount) => {
    expect(await readConfigureBody(post({ ...VALID, sampleCount }))).toEqual({ ok: false, issues: ["sampleCount"] });
  });

  it("accepts any positive safe count; comparing it to the cohort is the database's terminal decision", async () => {
    for (const sampleCount of [1, 2, 64, 65, Number.MAX_SAFE_INTEGER]) {
      expect((await readConfigureBody(post({ ...VALID, sampleCount }))).ok).toBe(true);
    }
  });

  it("refuses a format other than vcf, and names only closed fields", async () => {
    expect(await readConfigureBody(post({ ...VALID, format: "pgt_table" }))).toEqual({ ok: false, issues: ["format"] });
    const missing = { format: VALID.format, buildEvidence: VALID.buildEvidence, sampleCount: VALID.sampleCount };
    expect(await readConfigureBody(post(missing))).toEqual({ ok: false, issues: ["nonce"] });
    expect(await readConfigureBody(post({ ...missing, format: "gvcf", sampleCount: 0 })))
      .toEqual({ ok: false, issues: ["format", "sampleCount", "nonce"] });
  });

  it("refuses anything that is not one bounded, unencoded JSON object", async () => {
    for (const request of [
      post(VALID, { "content-type": "text/plain" }),
      post(VALID, { "content-encoding": "gzip" }),
      post("{not json"),
      post("[]"),
      post("null"),
      post(JSON.stringify(VALID), { "content-length": String(CONFIGURE_BODY_MAXIMUM_BYTES + 1) }),
      post({ ...VALID, padding: "x".repeat(CONFIGURE_BODY_MAXIMUM_BYTES) }),
    ]) {
      expect(await readConfigureBody(request)).toEqual({ ok: false, issues: ["body"] });
    }
  });

  it("counts the bytes that arrive rather than trusting a declared length", async () => {
    const big = new TextEncoder().encode(JSON.stringify({ ...VALID, nonce: "x".repeat(CONFIGURE_BODY_MAXIMUM_BYTES) }));
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(big); controller.close(); } });
    const request = new Request("https://inherit.example/", {
      method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half",
    } as RequestInit);
    expect(await readConfigureBody(request)).toEqual({ ok: false, issues: ["body"] });
  });

  it("permits exactly the three meta-line kinds", () => {
    expect(["##fileformat=VCFv4.3", "##reference=file:///ref/GRCh37.fa", GRCH38].every(isPermittedEvidenceLine)).toBe(true);
    expect(["##SAMPLE=<ID=A>", "#CHROM", "##fileformat", "reference=GRCh38"].some(isPermittedEvidenceLine)).toBe(false);
  });
});

describe("the build, by the product parser's header rule", () => {
  it.each([
    [["##reference=GRCh38"], "GRCh38"],
    [["##reference=file:///data/hg19.fasta"], "GRCh37"],
    [["##reference=b37"], "GRCh37"],
    [[GRCH38], "GRCh38"],
    [[GRCH37], "GRCh37"],
    [["##fileformat=VCFv4.2", "##contig=<ID=chr1,length=248956422,assembly=GRCh38>", "##contig=<ID=chr2,length=242193529>"], "GRCh38"],
    [["##reference=GRCh38", GRCH38, "##contig=<ID=chrM,length=16569>"], "GRCh38"],
  ] as const)("derives %j as %s", (lines, build) => {
    expect(deriveHeaderBuild({ buildEvidence: [...lines] })).toBe(build);
  });

  it.each([
    [[]],
    [["##fileformat=VCFv4.2"]],
    [["##reference=GRCh38", GRCH37]],
    [["##reference=GRCh37", "##reference=GRCh38"]],
    [["##reference=NCBI36"]],
    [["##reference=GRCh37,hg38"]],
    [["##contig=<ID=chr1,length=1000>"]],
    [["##contig=<ID=chr1,length=248956422,assembly=hg19>"]],
  ] as const)("answers %j as no build", (lines) => {
    expect(deriveHeaderBuild({ buildEvidence: [...lines] })).toBeNull();
  });

  it("zeroizes the submitted lines whatever it decides", () => {
    for (const lines of [["##reference=GRCh38"], ["##reference=NCBI36"]]) {
      const body = { buildEvidence: [...lines] };
      deriveHeaderBuild(body);
      expect(body.buildEvidence).toEqual([]);
    }
  });
});

describe("the configure responses", () => {
  it("answers configured with exactly the five registered keys and no referrer", async () => {
    const response = await configuredResponse({
      build: "GRCh38", challenge: "c".repeat(43), revision: 7, completionNonce: "n.t", csrfToken: "c.t",
    });
    expect(response.status).toBe(200);
    expect(Object.keys(await response.json()).sort()).toEqual([...VCF_TRANSPORT_KEYS].sort());
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("blocks a configured body that would carry any other key", async () => {
    const response = await configuredResponse({
      build: "GRCh38", challenge: "c".repeat(43), revision: 7, completionNonce: "n.t", csrfToken: "c.t", sampleCount: 3,
    } as never);
    expect(response.status).toBe(500);
  });

  it("answers each terminal branch with its constant 422 body", async () => {
    const unknown = terminalResponse("build_unknown");
    expect(unknown.status).toBe(422);
    expect(await unknown.json()).toEqual({
      error: "build_unknown",
      next: { labelCopyId: "upload.build.ask-laboratory", route: "/embryos/request-data" },
    });
    expect(unknown.headers.get("referrer-policy")).toBe("no-referrer");
    for (const branch of ["cohort_single_sample", "sample_count_mismatch"] as const) {
      const response = terminalResponse(branch);
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: branch });
    }
  });

  it("issues a 256-bit base64url challenge, fresh each time", () => {
    const first = newTransportChallenge();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newTransportChallenge()).not.toBe(first);
  });

  it("reads only the three closed database outcomes", () => {
    const cohortId = "a0000000-0000-4000-8000-000000000001";
    expect(configureResult.safeParse({ status: "configured", build: "GRCh37", revision: 9 }).success).toBe(true);
    expect(configureResult.safeParse({ status: "terminal", branch: "cohort_single_sample", cohortId, ingestRevision: 1 }).success).toBe(true);
    expect(configureResult.safeParse({ status: "failure_pending", cohortId, ingestRevision: 1 }).success).toBe(true);
    for (const value of [
      { status: "configured", build: "unknown", revision: 9 },
      { status: "configured", build: "GRCh37", revision: 0 },
      { status: "configured", build: "GRCh37", revision: 9, challenge: "x" },
      { status: "terminal", branch: "mapping", cohortId, ingestRevision: 1 },
      { status: "authorized" },
    ]) expect(configureResult.safeParse(value).success).toBe(false);
  });
});
