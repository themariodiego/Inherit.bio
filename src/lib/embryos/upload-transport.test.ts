import crypto from "node:crypto";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { chunkBinding, tableChunkBinding, validateChunk, validateTableChunk } from "./ingest-chunk";
import { deriveHeaderBuild, readConfigureBody } from "./ingest-configure";
import { readCompleteBody } from "./ingest-complete";
import { inspectHeader, readDecisionBody, readInspectBody } from "./ingest-mapping";
import { CSRF_HEADER } from "./operation-token";
import { UPLOAD_CSRF_HEADER, sendEmbryoFile, type MappingAnswer, type MappingQuestion, type UploadProgress } from "./upload-transport";

/**
 * The browser transport against the server's own boundary code. The stand-in
 * `fetch` below answers the three routes by running the real request readers
 * and chunk validators the route files run (`readConfigureBody`,
 * `deriveHeaderBuild`, `chunkBinding`, `validateChunk`, `readCompleteBody`),
 * so what this module sends is checked by exactly what would receive it.
 * Only authority (cookie, session, database) is left out.
 */
const PAIR = fs.readFileSync("e2e/fixtures/embryo-pair-grch38.vcf");
const sha = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const SESSION = "7a000000-0000-4000-8000-00000000c0de";

function server(options: { sampleCount?: number; configureStatus?: number; configureError?: string; chunkStatus?: number } = {}) {
  const handles = [0, 1].map(() => crypto.randomBytes(32).toString("base64url"));
  const challenge = crypto.randomBytes(32).toString("base64url");
  const revision = 4_242;
  const log: { method: string; url: string; headers: Headers }[] = [];
  const stored: { ordinals: number[]; records: number }[] = [];
  let configuredBuild: "GRCh37" | "GRCh38" | null = null;
  let completed: { chunkCount: number; nonce: string } | null = null;
  const session = {
    session: SESSION, uploadId: SESSION,
    sampleHandles: handles.map((handle, ordinal) => ({ ordinal, handle })).reverse(),
    operationNonce: "synthetic-operation-nonce",
    configureRoute: `/api/embryo-ingest/${SESSION}/configure`,
    chunkRoute: `/api/embryo-ingest/${SESSION}/chunks/[sequence]`,
    completeRoute: `/api/embryo-ingest/${SESSION}/complete`,
  };
  const fetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    const request = new Request(new URL(String(url), "https://inherit.example"), init);
    log.push({ method: request.method, url: new URL(request.url).pathname, headers: request.headers });
    const path = new URL(request.url).pathname;
    if (path === session.configureRoute) {
      if (options.configureStatus) {
        return Response.json({ error: options.configureError ?? "build_unknown" }, { status: options.configureStatus });
      }
      const parsed = await readConfigureBody(request);
      if (!parsed.ok) return Response.json({ error: "invalid_request", issues: parsed.issues }, { status: 400 });
      expect(parsed.body.nonce).toBe(session.operationNonce);
      if (parsed.body.format !== "vcf") throw new Error("a VCF upload must send the VCF body");
      expect(parsed.body.sampleCount).toBe(options.sampleCount ?? 2);
      configuredBuild = deriveHeaderBuild(parsed.body);
      return Response.json({ build: configuredBuild, challenge, revision, completionNonce: "synthetic-completion",
        csrfToken: "synthetic-csrf" });
    }
    const chunk = /^\/api\/embryo-ingest\/[^/]+\/chunks\/(\d+)$/.exec(path);
    if (chunk) {
      if (options.chunkStatus) return Response.json({ error: "invalid_genetic_chunk", issues: ["header"] }, { status: options.chunkStatus });
      expect(request.headers.get("content-type")).toBe("application/octet-stream");
      expect(Number(chunk[1])).toBe(stored.length);
      const bytes = new Uint8Array(await request.arrayBuffer());
      const binding = chunkBinding(bytes, {
        status: "authorized", session: SESSION, cohortId: SESSION, uploadId: SESSION, ingestRevision: 1,
        expiresAt: "2026-10-01T00:00:00+00:00", challengeHash: sha(challenge), transportRevision: revision,
        build: configuredBuild, format: "vcf", sampleCount: 2,
        handles: handles.map((handle, ordinal) => ({ ordinal, hash: sha(handle) })),
      });
      expect(binding).not.toBeNull();
      const validated = validateChunk(bytes, binding!);
      stored.push({ ordinals: validated.fragments.map((fragment) => fragment.ordinal), records: validated.recordCount });
      const text = new TextDecoder().decode(bytes);
      for (const withheld of ["SAMPLE1", "SAMPLE2", "##source", "Inherit deterministic"]) expect(text).not.toContain(withheld);
      return new Response(null, { status: 204 });
    }
    if (path === session.completeRoute) {
      expect(request.headers.get(UPLOAD_CSRF_HEADER)).toBe("synthetic-csrf");
      const parsed = await readCompleteBody(request);
      if (!parsed.ok) return Response.json({ error: "invalid_request" }, { status: 400 });
      completed = parsed.body;
      return Response.json({ status: "sanitization_pending", uploadId: SESSION, jobId: SESSION, analysisState: "queued" }, { status: 202 });
    }
    return new Response(null, { status: 404 });
  };
  return { fetch: fetch as typeof globalThis.fetch, session, log, stored, get completed() { return completed; }, get build() { return configuredBuild; } };
}

describe("sendEmbryoFile", () => {
  it("refuses cross-session routes and repeated handles before any request", async () => {
    for (const changed of [ { completeRoute: `/api/embryo-ingest/foreign/complete` }, { configureRoute: "https://foreign.example/configure" },
      { sampleHandles: [{ ordinal: 0, handle: "a".repeat(43) }, { ordinal: 1, handle: "a".repeat(43) }] },
      { sampleHandles: [{ ordinal: 1, handle: "a".repeat(43) }, { ordinal: 2, handle: "b".repeat(43) }] } ]) {
      const fake = server();
      await expect(sendEmbryoFile({ file: new Blob([PAIR]), session: { ...fake.session, ...changed }, fetch: fake.fetch }))
        .rejects.toMatchObject({ failure: "refused", spent: false });
      expect(fake.log).toEqual([]);
    }
  });
  it("refuses malformed configure credentials before any bytes, and an unrelated completion receipt", async () => {
    const fake = server();
    const changed = async (url: string | URL | Request, init?: RequestInit) => {
      const response = await fake.fetch(url, init);
      if (String(url).endsWith("configure")) return Response.json({ ...(await response.json()), revision: 0 });
      return response;
    };
    await expect(sendEmbryoFile({ file: new Blob([PAIR]), session: fake.session, fetch: changed as typeof fetch })).rejects.toMatchObject({ spent: true, failure: "refused" });
    expect(fake.stored).toEqual([]);
    const other = server();
    const unrelated = async (url: string | URL | Request, init?: RequestInit) => String(url).endsWith("complete")
      ? Response.json({ status: "sanitization_pending", uploadId: "99999999-9999-4999-8999-999999999999", jobId: SESSION, analysisState: "queued" }, { status: 202 })
      : other.fetch(url, init);
    await expect(sendEmbryoFile({ file: new Blob([PAIR]), session: other.session, fetch: unrelated as typeof fetch })).rejects.toMatchObject({ spent: true, failure: "refused" });
  });
  it("sends participant-c's file: configure, one chunk per part bound to the issued challenge, then complete", async () => {
    const fake = server();
    const progress: UploadProgress[] = [];
    await sendEmbryoFile({ file: new Blob([PAIR]), session: fake.session, fetch: fake.fetch, onProgress: (step) => progress.push(step) });
    expect(fake.build).toBe("GRCh38");
    expect(fake.stored.length).toBeGreaterThan(0);
    expect(fake.stored.every((chunk) => chunk.ordinals.join() === "0,1")).toBe(true);
    expect(fake.completed).toEqual({ chunkCount: fake.stored.length, nonce: "synthetic-completion" });
    expect(fake.log.map((entry) => entry.method)).toEqual(["POST", ...fake.stored.map(() => "PUT"), "POST"]);
    expect(progress[0]).toEqual({ phase: "reading" });
    expect(progress.at(-1)).toEqual({ phase: "finishing" });
  });

  it("uses the same CSRF header name as the routes", () => {
    expect(UPLOAD_CSRF_HEADER).toBe(CSRF_HEADER);
  });

  it("refuses a file whose sample count differs from the record before any request", async () => {
    const fake = server();
    const three = PAIR.toString("utf8").replace("SAMPLE1\tSAMPLE2", "SAMPLE1\tSAMPLE2\tSAMPLE3");
    await expect(sendEmbryoFile({ file: new Blob([three]), session: fake.session, fetch: fake.fetch }))
      .rejects.toMatchObject({ failure: "sample-count", spent: false });
    expect(fake.log).toEqual([]);
  });

  it("maps the configure route's terminal answers and a refused chunk to closed words", async () => {
    for (const [error, failure] of [["build_unknown", "build-unknown"], ["sample_count_mismatch", "sample-count"],
      ["cohort_single_sample", "sample-count"]] as const) {
      const fake = server({ configureStatus: 422, configureError: error });
      await expect(sendEmbryoFile({ file: new Blob([PAIR]), session: fake.session, fetch: fake.fetch }))
        .rejects.toMatchObject({ failure, spent: true });
    }
    const refused = server({ chunkStatus: 422 });
    await expect(sendEmbryoFile({ file: new Blob([PAIR]), session: refused.session, fetch: refused.fetch }))
      .rejects.toMatchObject({ failure: "not-a-vcf", spent: true });
    expect(refused.log.filter((entry) => entry.url.endsWith("/complete"))).toEqual([]);
  });

  it("refuses a PDF in this browser, and sends nothing", async () => {
    const fake = server();
    await expect(sendEmbryoFile({ file: new Blob(["%PDF-1.7 synthetic"]), session: fake.session, fetch: fake.fetch }))
      .rejects.toMatchObject({ failure: "pdf", spent: false });
    expect(fake.log).toEqual([]);
  });
});

/**
 * ADR 0037: a laboratory table over the same session. The stand-in server
 * runs the real configure, inspection, decision, chunk and completion
 * readers, and plays the database's part from what those readers decided.
 * Every `PRIVATE_` string must stay in this browser.
 */
const TABLE = [
  "#Synthetic laboratory export PRIVATE_LAB", "Embryo,Chromosome,Position,Genotype,Sex,Note",
  "PRIVATE_A,1,1000,AG,XX,PRIVATE_NOTE", "PRIVATE_B,1,1000,GG,XY,PRIVATE_NOTE", "PRIVATE_A,2,2000,CT,XX,",
  "PRIVATE_B,2,2000,CC,XY,", "PRIVATE_A,X,30,A,XX,", "",
].join("\n");

// Values from the file that must never leave the browser. Sex is a forbidden
// column, XX and XY are its values, and the rest are labels and notes.
const WITHHELD = ["Sex", "XX", "XY", "PRIVATE_A", "PRIVATE_B", "PRIVATE_NOTE", "PRIVATE_LAB"];

// A random handle or challenge from the fake server is base64url, so by chance
// it can contain "XX" or "XY". The no-leak test would then report the server's
// own token as a leak. Draw again until the token contains no withheld value.
function serverToken() {
  for (;;) {
    const token = crypto.randomBytes(32).toString("base64url");
    if (!WITHHELD.some((withheld) => token.includes(withheld))) return token;
  }
}

function tableServer(options: { build?: "GRCh37" | "GRCh38" | null; mappingStatus?: number; tamperQuestion?: boolean } = {}) {
  const handles = [0, 1].map(() => serverToken());
  const transportChallenge = serverToken();
  const log: { method: string; url: string; body: string }[] = [];
  const stored: { ordinals: number[]; text: string }[] = [];
  let build: "GRCh37" | "GRCh38" | null = null;
  let locus: "rsid" | "chrom-pos" | null = null;
  let pending: { kind: "columns" | "build"; id: string; nonce: string } | null = null;
  let completed: { chunkCount: number; nonce: string } | null = null;
  const session = {
    session: SESSION, uploadId: SESSION, sampleHandles: handles.map((handle, ordinal) => ({ ordinal, handle })),
    operationNonce: "synthetic-operation-nonce", configureRoute: `/api/embryo-ingest/${SESSION}/configure`,
    chunkRoute: `/api/embryo-ingest/${SESSION}/chunks/[sequence]`, completeRoute: `/api/embryo-ingest/${SESSION}/complete`,
  };
  const mappingRoute = `/api/embryo-ingest/${SESSION}/mapping`;
  const transport = () => Response.json({ kind: "transport", build, challenge: transportChallenge, revision: 4_243,
    completionNonce: "synthetic-completion", csrfToken: "synthetic-csrf" });
  const ask = (kind: "columns" | "build", body: Record<string, unknown>) => {
    pending = { kind, id: serverToken(), nonce: `synthetic-decide-${kind}` };
    return Response.json({ kind, challengeId: pending.id, ...body, expiresAt: "2026-10-16T12:00:00.000Z", nonce: pending.nonce });
  };
  const buildQuestion = () => ask("build", { questionCopyId: "upload.build.question", options: [
    { value: "GRCh37", labelCopyId: "upload.build.grch37" }, { value: "GRCh38", labelCopyId: "upload.build.grch38" },
    { value: "unknown", labelCopyId: "upload.build.unknown", route: "/embryos/request-data" }] });
  const fetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    const request = new Request(new URL(String(url), "https://inherit.example"), init);
    const path = new URL(request.url).pathname;
    log.push({ method: request.method, url: path, body: request.method === "PUT" && path.includes("/chunks/")
      ? new TextDecoder().decode(new Uint8Array(await request.clone().arrayBuffer())) : await request.clone().text() });
    if (path === session.configureRoute) {
      const parsed = await readConfigureBody(request);
      if (!parsed.ok || parsed.body.format !== "pgt_table") return Response.json({ error: "invalid_request" }, { status: 422 });
      expect(parsed.body.nonce).toBe(session.operationNonce);
      build = options.build === undefined ? deriveHeaderBuild(parsed.body) : options.build;
      return Response.json({ nonce: "synthetic-inspection" });
    }
    if (path === mappingRoute && request.method === "POST") {
      if (options.mappingStatus) return Response.json({ error: "not_found" }, { status: options.mappingStatus });
      const parsed = await readInspectBody(request);
      if (!parsed.ok) return Response.json({ error: "invalid_request" }, { status: 422 });
      expect(parsed.body.nonce).toBe("synthetic-inspection");
      const inspection = inspectHeader(parsed.body);
      if (inspection.kind === "terminal") return Response.json({ error: "not_found" }, { status: 404 });
      locus = inspection.locus;
      if (inspection.kind === "columns") {
        const decisions = inspection.decisions.map((decision) => ({ sourceColumn: `Column ${decision.columnIndex + 1}`, ...decision }));
        if (options.tamperQuestion) decisions[0] = { ...decisions[0], columnIndex: decisions[0].columnIndex + 1 };
        return ask("columns", { decisions, maximumDecisions: 4 });
      }
      return build === null ? buildQuestion() : transport();
    }
    if (path === mappingRoute && request.method === "PUT") {
      const decision = await readDecisionBody(request);
      if (!decision || !pending || decision.challengeId !== pending.id || decision.nonce !== pending.nonce
        || decision.kind !== pending.kind) return Response.json({ error: "not_found" }, { status: 404 });
      pending = null;
      if (decision.kind === "build") {
        if (decision.referenceBuild === "unknown") {
          return Response.json({ error: "build_unknown", next: { labelCopyId: "upload.build.ask-laboratory", route: "/embryos/request-data" } }, { status: 422 });
        }
        build = decision.referenceBuild;
        return transport();
      }
      return build === null ? buildQuestion() : transport();
    }
    const chunk = /^\/api\/embryo-ingest\/[^/]+\/chunks\/(\d+)$/.exec(path);
    if (chunk) {
      expect(Number(chunk[1])).toBe(stored.length);
      const bytes = new Uint8Array(await request.arrayBuffer());
      const binding = tableChunkBinding(bytes, {
        status: "authorized", session: SESSION, cohortId: SESSION, uploadId: SESSION, ingestRevision: 1,
        expiresAt: "2026-10-01T00:00:00+00:00", challengeHash: sha(transportChallenge), transportRevision: 4_243,
        build, format: "pgt_table", sampleCount: 2, handles: handles.map((handle, ordinal) => ({ ordinal, hash: sha(handle) })),
      }, locus, () => null);
      expect(binding).not.toBeNull();
      const validated = validateTableChunk(bytes, binding!);
      stored.push({ ordinals: validated.fragments.map((fragment) => fragment.ordinal), text: new TextDecoder().decode(bytes) });
      return new Response(null, { status: 204 });
    }
    if (path === session.completeRoute) {
      expect(request.headers.get(UPLOAD_CSRF_HEADER)).toBe("synthetic-csrf");
      const parsed = await readCompleteBody(request);
      if (!parsed.ok) return Response.json({ error: "invalid_request" }, { status: 400 });
      completed = parsed.body;
      return Response.json({ status: "sanitization_pending", uploadId: SESSION, jobId: SESSION, analysisState: "queued" }, { status: 202 });
    }
    return new Response(null, { status: 404 });
  };
  return { fetch: fetch as typeof globalThis.fetch, session, log, stored, get completed() { return completed; }, get build() { return build; } };
}

function answering(...answers: ((question: MappingQuestion) => MappingAnswer)[]) {
  const asked: MappingQuestion[] = [];
  return { asked, decide: async (question: MappingQuestion) => { asked.push(question); return answers.shift()!(question); } };
}
const grch38 = (): MappingAnswer => ({ kind: "build", referenceBuild: "GRCh38" });

describe("sendEmbryoFile, laboratory table", () => {
  it("asks the build before any chunk when the header states none, then sends canonical chunks and completes", async () => {
    const fake = tableServer();
    const reader = answering(grch38);
    await sendEmbryoFile({ file: new Blob([TABLE.replace(",Note", "").replaceAll(/,PRIVATE_NOTE|,$/gm, "")]),
      session: fake.session, fetch: fake.fetch, decide: reader.decide });
    expect(reader.asked).toEqual([{ kind: "build" }]);
    expect(fake.log.map((entry) => `${entry.method} ${entry.url.split("/").slice(4).join("/")}`)).toEqual([
      "POST configure", "POST mapping", "PUT mapping", "PUT chunks/0", "POST complete"]);
    expect(fake.build).toBe("GRCh38");
    expect(fake.stored).toHaveLength(1);
    expect(fake.stored[0].ordinals).toEqual([0, 1]);
    expect(fake.completed).toEqual({ chunkCount: 1, nonce: "synthetic-completion" });
  });

  it("takes the build its own header states, and asks nothing", async () => {
    const fake = tableServer();
    const reader = answering();
    await sendEmbryoFile({ file: new Blob([`##reference=GRCh37\n${TABLE.replace(",Note", "").replaceAll(/,PRIVATE_NOTE|,$/gm, "")}`]),
      session: fake.session, fetch: fake.fetch, decide: reader.decide });
    expect(reader.asked).toEqual([]);
    expect(fake.build).toBe("GRCh37");
    expect(JSON.parse(fake.log[0].body)).toEqual({ format: "pgt_table", buildEvidence: ["##reference=GRCh37"], nonce: "synthetic-operation-nonce" });
  });

  it("asks the column question with the file's own names shown here only, then the build", async () => {
    const fake = tableServer();
    // Two genotype columns: the reader chooses which one holds the result.
    const ambiguous = "Embryo,Chromosome,Position,Genotype,Call,Sex\nPRIVATE_A,1,1000,AG,--,XX\nPRIVATE_B,1,1000,GG,--,XY\n";
    const asked: MappingQuestion[] = [];
    await sendEmbryoFile({ file: new Blob([ambiguous]), session: fake.session, fetch: fake.fetch,
      decide: async (question) => {
        asked.push(question);
        if (question.kind === "build") return grch38();
        return { kind: "columns", mappings: [{ field: "genotype", columnIndex: question.decisions[0].candidates[0].columnIndex }] };
      } });
    expect(asked).toEqual([
      { kind: "columns", decisions: [{ field: "genotype", candidates: [{ columnIndex: 3, label: "Genotype" }, { columnIndex: 4, label: "Call" }] }] },
      { kind: "build" },
    ]);
    // The decision names a column number and a canonical field, never a name.
    expect(JSON.parse(fake.log[2].body)).toEqual({ challengeId: expect.any(String), mappings: [{ columnIndex: 3, field: "genotype" }],
      nonce: "synthetic-decide-columns" });
    expect(fake.stored[0].text).toContain("A/G");
    expect(fake.stored[0].text).not.toContain("./.");
  });

  it("drops a forbidden column, and every label and note, before any byte leaves this browser", async () => {
    const fake = tableServer();
    await sendEmbryoFile({ file: new Blob([TABLE]), session: fake.session, fetch: fake.fetch, decide: answering(grch38).decide });
    const inspected = JSON.parse(fake.log[1].body);
    expect(inspected.headerColumns).toEqual(["Embryo", "Chromosome", "Position", "Genotype", "Note"]);
    for (const entry of fake.log) {
      for (const withheld of WITHHELD) {
        expect(entry.body, `${entry.method} ${entry.url}`).not.toContain(withheld);
      }
    }
  });

  it("ends on unknown with build-unknown, after the nonce was spent, and sends no chunk", async () => {
    const fake = tableServer();
    await expect(sendEmbryoFile({ file: new Blob([TABLE]), session: fake.session, fetch: fake.fetch,
      decide: answering(() => ({ kind: "build", referenceBuild: "unknown" })).decide }))
      .rejects.toMatchObject({ failure: "build-unknown", spent: true });
    expect(fake.stored).toEqual([]);
    expect(fake.completed).toBeNull();
  });

  it("refuses a file that is not a table, or one beyond four decisions, before any request", async () => {
    for (const [text, failure] of [["Well,Plate,Note\n1,2,3\n", "not-a-vcf"], ["Embryo,Chromosome,Position\nA,1,2\n", "table-unmapped"]] as const) {
      const fake = tableServer();
      await expect(sendEmbryoFile({ file: new Blob([text]), session: fake.session, fetch: fake.fetch, decide: answering().decide }))
        .rejects.toMatchObject({ failure, spent: false });
      expect(fake.log).toEqual([]);
    }
  });

  it("refuses a table whose embryos do not match the record, after the mapping", async () => {
    const fake = tableServer();
    const three = `${TABLE}PRIVATE_C,3,300,AA,XX,\n`;
    await expect(sendEmbryoFile({ file: new Blob([three]), session: fake.session, fetch: fake.fetch, decide: answering(grch38).decide }))
      .rejects.toMatchObject({ failure: "sample-count", spent: true });
    expect(fake.completed).toBeNull();
  });

  it("refuses a column question that is not this browser's own plan, and a question nobody can answer", async () => {
    const ambiguous = "Embryo,Chromosome,Position,Genotype,Call\nPRIVATE_A,1,1000,AG,--\nPRIVATE_B,1,1000,GG,--\n";
    const tampered = tableServer({ tamperQuestion: true });
    await expect(sendEmbryoFile({ file: new Blob([ambiguous]), session: tampered.session, fetch: tampered.fetch, decide: answering(grch38).decide }))
      .rejects.toMatchObject({ failure: "refused", spent: true });
    const silent = tableServer();
    await expect(sendEmbryoFile({ file: new Blob([TABLE]), session: silent.session, fetch: silent.fetch }))
      .rejects.toMatchObject({ failure: "refused", spent: true });
    expect(silent.stored).toEqual([]);
  });

  it("maps a refused inspection to a closed word and stops", async () => {
    const fake = tableServer({ mappingStatus: 404 });
    await expect(sendEmbryoFile({ file: new Blob([TABLE]), session: fake.session, fetch: fake.fetch, decide: answering(grch38).decide }))
      .rejects.toMatchObject({ failure: "refused", spent: true });
    expect(fake.log.map((entry) => entry.url.split("/").at(-1))).toEqual(["configure", "mapping"]);
  });
});
