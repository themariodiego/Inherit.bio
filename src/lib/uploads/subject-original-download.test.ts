import { createHash, randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  DOWNLOAD_HEADERS,
  getSubjectOriginalChunk,
  openSubjectDownload,
  subjectDownloadFilename,
  subjectDownloadQuery,
  type SubjectDownloadDependencies,
} from "./subject-original-download";

vi.mock("@/lib/account-deletion", () => ({ getSensitiveAccountContext: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const ORIGIN = "http://localhost:3000";
// NODE_ENV is "test" here, so the development cookie name applies.
const COOKIE = "inherit-download";

function fixture(size = 4_000_005) {
  const actor = { accountId: randomUUID(), sessionId: randomUUID() };
  const subject = randomUUID(), file = randomUUID(), session = randomUUID();
  const bytes = randomBytes(size);
  const secret = randomBytes(32).toString("base64url");
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const answers = new Map<string, (args: Record<string, unknown>) => { data: unknown; error: { code?: string } | null }>();
  answers.set("open_subject_original_download_v1", () => ({ data: { session, sizeBytes: size, sha256: digest(bytes),
    chunkCount: Math.ceil(size / 4_000_000), fileType: "vcf", originalName: "Genome file", sourceSha256: digest(bytes),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString() }, error: null }));
  answers.set("subject_original_download_target_v1", () => ({ data: true, error: null }));
  answers.set("authorize_subject_original_chunk_v1", (args) => {
    const sequence = Number(args.p_sequence);
    if (sequence < 0 || sequence >= Math.ceil(size / 4_000_000)) return { data: null, error: { code: "22023" } };
    const start = sequence * 4_000_000, end = Math.min(start + 4_000_000, size) - 1;
    return { data: { status: "authorized", session, objectKey: `${actor.accountId}/${file}`, objectVersion: randomUUID(),
      sha256: digest(bytes), sizeBytes: size, chunkCount: Math.ceil(size / 4_000_000), start, end,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString() }, error: null };
  });
  answers.set("record_subject_original_chunk_v1", () => ({ data: "recorded", error: null }));
  const readRange = vi.fn<SubjectDownloadDependencies["readRange"]>(async (_key, start, end) =>
    new Response(Uint8Array.from(bytes.subarray(start, end + 1)), { status: 206, headers: {
      "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } }));
  const deps: SubjectDownloadDependencies = {
    enabled: vi.fn(() => true),
    actor: vi.fn(async () => actor),
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const answer = answers.get(name);
      if (!answer) throw new Error(`unexpected rpc ${name}`);
      return answer(args);
    }),
    readRange,
    secret: () => secret,
  };
  const entry = (query = `?file=${file}`, headers: Record<string, string> = {}) =>
    new Request(`${ORIGIN}/api/subjects/${subject}/download${query}`, { headers: { "sec-fetch-site": "same-origin", ...headers } });
  const chunk = (sequence: string, headers: Record<string, string> = {}, search = "") =>
    new Request(`${ORIGIN}/api/downloads/${session}/chunks/${sequence}${search}`, {
      headers: { cookie: `${COOKIE}=${secret}`, "sec-fetch-site": "same-origin", ...headers } });
  return { actor, subject, file, session, bytes, secret, calls, answers, readRange, deps, entry, chunk, size };
}

describe("api.subject-download entry (download-session-v1)", () => {
  it("returns the closed descriptor and sets a cookie whose hash alone reaches the database", async () => {
    const f = fixture();
    const response = await openSubjectDownload(f.entry(), f.subject, f.deps);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["chunkBytes", "chunkCount", "chunkRoute", "filename", "session", "sha256", "sizeBytes"]);
    expect(body).toMatchObject({ session: f.session, sizeBytes: f.size, sha256: digest(f.bytes), chunkBytes: 4_000_000,
      chunkCount: 2, filename: "Genome file.vcf", chunkRoute: `/api/downloads/${f.session}/chunks/{sequence}` });
    expect(JSON.stringify(body)).not.toMatch(/genomes|storage|http|signed|token/u);
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toMatch(new RegExp(`^${COOKIE}=${f.secret}; Path=/; Max-Age=3600; HttpOnly; SameSite=Strict`));
    const open = f.calls.find((call) => call.name === "open_subject_original_download_v1")!;
    expect(open.args).toEqual({ p_account_id: f.actor.accountId, p_session_id: f.actor.sessionId, p_subject_id: f.subject,
      p_file_id: f.file, p_cookie_hash: digest(f.secret) });
    expect(JSON.stringify(f.calls)).not.toContain(f.secret);
    for (const [name, value] of Object.entries(DOWNLOAD_HEADERS)) expect(response.headers.get(name)).toBe(value);
  });

  it("answers 401 with no account and never asks the database", async () => {
    const f = fixture();
    vi.mocked(f.deps.actor).mockResolvedValueOnce(null);
    const response = await openSubjectDownload(f.entry(), f.subject, f.deps);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(f.calls).toEqual([]);
  });

  it.each([
    ["an uploader, grantee or embryo case", "42501"],
    ["a retired, deleted or mismatched original", "42501"],
  ])("answers the opaque resource-not-found-v1 for %s", async (_label, code) => {
    const f = fixture();
    f.answers.set("open_subject_original_download_v1", () => ({ data: null, error: { code } }));
    const response = await openSubjectDownload(f.entry(), f.subject, f.deps);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("stays closed outside TEST-LOCAL: no session opens and no chunk is served", async () => {
    const f = fixture();
    vi.mocked(f.deps.enabled).mockReturnValue(false);
    const response = await openSubjectDownload(f.entry(), f.subject, f.deps);
    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await getSubjectOriginalChunk(f.chunk("0"), { session: f.session, sequence: "0" }, f.deps)).toBeNull();
    expect(f.calls).toEqual([]);
    expect(f.deps.actor).not.toHaveBeenCalled();
  });

  it("refuses a non-canonical subject id and a cross-site request before any lookup", async () => {
    const f = fixture();
    expect((await openSubjectDownload(f.entry(), "not-a-uuid", f.deps)).status).toBe(404);
    expect((await openSubjectDownload(f.entry(undefined, { "sec-fetch-site": "cross-site" }), f.subject, f.deps)).status).toBe(404);
    expect(f.calls).toEqual([]);
  });

  it.each([
    ["", ["file"]],
    ["?file=", ["file"]],
    ["?file=NOT-A-UUID", ["file"]],
    [`?file=${randomUUID().toUpperCase()}`, ["file"]],
    [`?file=${randomUUID()}&file=${randomUUID()}`, ["file"]],
    [`?file=${randomUUID()}&subject=x`, ["query"]],
  ])("answers invalid-request-v1 for the query %j only for a readable subject", async (query, issues) => {
    const f = fixture();
    const response = await openSubjectDownload(f.entry(query), f.subject, f.deps);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues });
    expect(f.calls.map((call) => call.name)).toEqual(["subject_original_download_target_v1"]);
    f.answers.set("subject_original_download_target_v1", () => ({ data: false, error: null }));
    const hidden = await openSubjectDownload(f.entry(query), f.subject, f.deps);
    expect(hidden.status).toBe(404);
  });

  it("refuses a descriptor whose chunk count does not match its size", async () => {
    const f = fixture();
    f.answers.set("open_subject_original_download_v1", () => ({ data: { session: f.session, sizeBytes: f.size,
      sha256: digest(f.bytes), chunkCount: 1, fileType: "vcf", originalName: "Genome file", sourceSha256: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString() }, error: null }));
    expect((await openSubjectDownload(f.entry(), f.subject, f.deps)).status).toBe(503);
  });
});

describe("the subject original filename", () => {
  it("keeps the generic stored name with its extension and replaces any other label", () => {
    const sha = "a".repeat(64), gz = "b".repeat(64);
    expect(subjectDownloadFilename({ originalName: "Genome file", fileType: "array_23andme", sha256: sha, sourceSha256: sha }))
      .toBe("Genome file.txt");
    expect(subjectDownloadFilename({ originalName: "Genome file", fileType: "vcf", sha256: sha, sourceSha256: gz }))
      .toBe("Genome file.vcf.gz");
    expect(subjectDownloadFilename({ originalName: "Jane Ünique/../x.vcf", fileType: "vcf", sha256: sha, sourceSha256: sha }))
      .toBe("genome-file.vcf");
  });
  it("parses only the closed query", () => {
    const id = randomUUID();
    expect(subjectDownloadQuery(new URL(`${ORIGIN}/x?file=${id}`))).toEqual({ file: id });
    expect(subjectDownloadQuery(new URL(`${ORIGIN}/x?file=${id}&x=1`))).toEqual({ issues: ["query"] });
  });
});

describe("the genome branch of api.download-chunk", () => {
  it("delivers each exact fixed-size chunk after two database authorizations", async () => {
    const f = fixture();
    const first = (await getSubjectOriginalChunk(f.chunk("0"), { session: f.session, sequence: "0" }, f.deps))!;
    expect(first.status).toBe(200);
    expect(first.headers.get("content-length")).toBe("4000000");
    expect(first.headers.get("content-encoding")).toBe("identity");
    expect(first.headers.get("content-type")).toBe("application/octet-stream");
    for (const [name, value] of Object.entries(DOWNLOAD_HEADERS)) expect(first.headers.get(name)).toBe(value);
    const second = (await getSubjectOriginalChunk(f.chunk("1"), { session: f.session, sequence: "1" }, f.deps))!;
    expect(second.headers.get("content-length")).toBe("5");
    const whole = Buffer.concat([Buffer.from(await first.arrayBuffer()), Buffer.from(await second.arrayBuffer())]);
    expect(digest(whole)).toBe(digest(f.bytes));
    expect(f.readRange.mock.calls.map(([, start, end]) => [start, end])).toEqual([[0, 3_999_999], [4_000_000, 4_000_004]]);
    expect(f.calls.map((call) => call.name)).toEqual(["authorize_subject_original_chunk_v1", "record_subject_original_chunk_v1",
      "authorize_subject_original_chunk_v1", "record_subject_original_chunk_v1"]);
    expect(f.calls[0]!.args).toEqual({ p_account_id: f.actor.accountId, p_session_id: f.actor.sessionId,
      p_download_id: f.session, p_cookie_hash: digest(f.secret), p_sequence: 0 });
    expect(f.calls[1]!.args).toMatchObject({ p_sequence: 0, p_byte_count: 4_000_000 });
  });

  it("leaves another session kind to the route when the database does not know the id", async () => {
    const f = fixture();
    f.answers.set("authorize_subject_original_chunk_v1", () => ({ data: null, error: null }));
    expect(await getSubjectOriginalChunk(f.chunk("0"), { session: f.session, sequence: "0" }, f.deps)).toBeNull();
    expect(f.readRange).not.toHaveBeenCalled();
  });

  it("leaves the request alone without a download cookie or an account", async () => {
    const f = fixture();
    expect(await getSubjectOriginalChunk(f.chunk("0", { cookie: "" }), { session: f.session, sequence: "0" }, f.deps)).toBeNull();
    vi.mocked(f.deps.actor).mockResolvedValueOnce(null);
    expect(await getSubjectOriginalChunk(f.chunk("0"), { session: f.session, sequence: "0" }, f.deps)).toBeNull();
    expect(f.calls).toEqual([]);
  });

  it("reads no byte for a revoked, expired or foreign session", async () => {
    const f = fixture();
    f.answers.set("authorize_subject_original_chunk_v1", () => ({ data: null, error: { code: "42501" } }));
    const denied = (await getSubjectOriginalChunk(f.chunk("0"), { session: f.session, sequence: "0" }, f.deps))!;
    expect(denied.status).toBe(404);
    f.answers.set("authorize_subject_original_chunk_v1", () => ({ data: { status: "ended" }, error: null }));
    const ended = (await getSubjectOriginalChunk(f.chunk("0"), { session: f.session, sequence: "0" }, f.deps))!;
    expect(ended.status).toBe(404);
    expect(await ended.json()).toEqual({ error: "not_found" });
    expect(f.readRange).not.toHaveBeenCalled();
  });

  it("withholds bytes already read when the second authorization fails", async () => {
    const f = fixture();
    f.answers.set("record_subject_original_chunk_v1", () => ({ data: "ended", error: null }));
    const response = (await getSubjectOriginalChunk(f.chunk("0"), { session: f.session, sequence: "0" }, f.deps))!;
    expect(response.status).toBe(404);
    expect(f.readRange).toHaveBeenCalledTimes(1);
  });

  it.each(["4", "-1", "01", "1e1", "x"])("answers invalid-request-v1 for the sequence %s", async (sequence) => {
    const f = fixture();
    const response = (await getSubjectOriginalChunk(f.chunk(sequence), { session: f.session, sequence }, f.deps))!;
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_request", issues: ["sequence"] });
    expect(f.readRange).not.toHaveBeenCalled();
  });

  it("refuses a client range, a query or a cross-site fetch for a genome session", async () => {
    const f = fixture();
    for (const request of [f.chunk("0", { range: "bytes=0-1" }), f.chunk("0", {}, "?x=1"),
      f.chunk("0", { "sec-fetch-site": "cross-site" })]) {
      const response = (await getSubjectOriginalChunk(request, { session: f.session, sequence: "0" }, f.deps))!;
      expect(response.status).toBe(404);
    }
    expect(f.readRange).not.toHaveBeenCalled();
  });

  it("refuses a Storage answer that is not the exact range", async () => {
    const f = fixture();
    f.readRange.mockImplementationOnce(async () => new Response(Uint8Array.from(f.bytes.subarray(0, 10)), { status: 200 }));
    expect((await getSubjectOriginalChunk(f.chunk("0"), { session: f.session, sequence: "0" }, f.deps))!.status).toBe(503);
    f.readRange.mockImplementationOnce(async () => new Response(Uint8Array.from(f.bytes.subarray(0, 10)), { status: 206,
      headers: { "content-range": `bytes 0-3999999/${f.size}` } }));
    expect((await getSubjectOriginalChunk(f.chunk("0"), { session: f.session, sequence: "0" }, f.deps))!.status).toBe(503);
    expect(f.calls.filter((call) => call.name === "record_subject_original_chunk_v1")).toEqual([]);
  });
});
