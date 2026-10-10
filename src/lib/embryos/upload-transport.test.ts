import crypto from "node:crypto";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { chunkBinding, validateChunk } from "./ingest-chunk";
import { deriveHeaderBuild, readConfigureBody } from "./ingest-configure";
import { readCompleteBody } from "./ingest-complete";
import { CSRF_HEADER } from "./operation-token";
import { UPLOAD_CSRF_HEADER, sendEmbryoFile, type UploadProgress } from "./upload-transport";

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
