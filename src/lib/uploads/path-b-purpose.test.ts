import crypto from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Path B's reading layer, application side: the presentation that alone can
 * name a direction, the route that hands the database only what the
 * presentation holds, the page's rows, and the uploader's one line.
 */
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), getClaims: vi.fn(), artifacts: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: () => ({ select: () => ({ in: () => ({ is: async () => mocks.artifacts() }) }) }),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: mocks }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { PATH_B_CHOICES_COPY as COPY } from "@/copy/upload/other-adult";
import { PathBChoices } from "@/components/uploads/path-b-choices";
import { PATH_B_STATEMENTS, pathBPurposeBody } from "./path-b-purpose";
import {
  isPathBPurposeConsentPayload,
  mintPathBPurposePresentation,
  pathBPurposeConsent,
  preparePathBChoices,
  readPathBPurposePresentation,
} from "./path-b-purpose-server";
import { POST as consents } from "@/app/api/consents/route";

const NOW = 1_800_000_000_000;
const accountId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sessionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const subjectId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const grantId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SHA = "a".repeat(64);
const input = { accountId, sessionId, subjectId, purpose: "ancestry" as const, direction: "uploader" as const,
  artifactKey: "consent.share-with-adult", artifactVersion: 1, artifactBodySha256: SHA };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("BYOK_ENCRYPTION_KEY", crypto.randomBytes(32).toString("base64"));
  vi.stubEnv("INHERIT_TEST_JURISDICTION", "1");
  mocks.getUser.mockResolvedValue({ data: { user: { id: accountId, email: "person@e2e.local", email_confirmed_at: "2026-09-01" } } });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: accountId, session_id: sessionId } } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

function post(body: unknown, token: string, headers: Record<string, string> = {}) {
  return new Request("https://inherit.bio/api/consents", { method: "POST", body: JSON.stringify(body),
    headers: { origin: "https://inherit.bio", "sec-fetch-site": "same-origin", "content-type": "application/json",
      "x-inherit-csrf": token, ...headers } });
}
function body(token: string, patch: Record<string, unknown> = {}) {
  return { action: "grant-purpose", subjectId, purposeKey: "ancestry", artifactVersion: 1,
    artifactPresentationToken: token, affirmed: true, statementKeys: [...PATH_B_STATEMENTS.uploader], ...patch };
}

describe("the Path B purpose presentation", () => {
  it("binds the direction and the exact text, for nine minutes", () => {
    const { token, claims } = mintPathBPurposePresentation(input, NOW);
    expect(readPathBPurposePresentation(token, NOW)).toEqual(claims);
    expect(readPathBPurposePresentation(token, NOW + 540_000)).toBeNull();
    const [payload] = token.split(".");
    expect(readPathBPurposePresentation(`${payload}.${"0".repeat(64)}`, NOW)).toBeNull();
    // A direction's text is fixed: the share text never names a self grant, nor the reverse.
    expect(() => mintPathBPurposePresentation({ ...input, direction: "self" }, NOW)).toThrow();
    expect(() => mintPathBPurposePresentation({ ...input, artifactKey: "consent.own-ancestry" }, NOW)).toThrow();
  });
  it("keeps the body closed: no direction, recipient or account field", () => {
    const token = mintPathBPurposePresentation(input).token;
    expect(pathBPurposeBody.safeParse(body(token)).success).toBe(true);
    for (const patch of [{ direction: "self" }, { recipientId: accountId }, { accountId }, { affirmed: false },
      { purposeKey: "copilot.cloud" }]) {
      expect(pathBPurposeBody.safeParse(body(token, patch)).success).toBe(false);
    }
  });
});

describe("POST /api/consents, a Path B layer", () => {
  it("is recognised only by its own presentation", () => {
    expect(isPathBPurposeConsentPayload(body(mintPathBPurposePresentation(input).token))).toBe(true);
    expect(isPathBPurposeConsentPayload(body("x".repeat(40)))).toBe(false);
  });
  it("hands the database the direction and text from the token, never from the body", async () => {
    const token = mintPathBPurposePresentation(input).token;
    mocks.rpc.mockResolvedValueOnce({ data: { recordKind: "purpose_grant", recordId: grantId, artifactKey: "consent.share-with-adult",
      artifactVersion: 1, purposeKey: "ancestry", signedAt: "2026-09-29T10:00:00+00:00" }, error: null });
    const response = await consents(post(body(token), token));
    expect(response.status).toBe(201);
    const [name, args] = mocks.rpc.mock.calls[0]!;
    expect(name).toBe("grant_path_b_purpose_v1");
    expect(args).toMatchObject({ p_account_id: accountId, p_session_id: sessionId, p_subject_id: subjectId,
      p_purpose: "ancestry", p_direction: "uploader", p_artifact_version: 1, p_artifact_body_sha256: SHA,
      p_test_jurisdiction: true });
    expect(args.p_nonce_hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("refuses a foreign or mismatched presentation before the database", async () => {
    const token = mintPathBPurposePresentation(input).token;
    const other = mintPathBPurposePresentation({ ...input, accountId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }).token;
    expect((await pathBPurposeConsent(post(body(other), other), body(other))).status).toBe(404);
    expect((await pathBPurposeConsent(post(body(token, { purposeKey: "reports.monogenic" }), token),
      body(token, { purposeKey: "reports.monogenic" }))).status).toBe(404);
    expect((await pathBPurposeConsent(post(body(token, { statementKeys: [...PATH_B_STATEMENTS.self] }), token),
      body(token, { statementKeys: [...PATH_B_STATEMENTS.self] }))).status).toBe(404);
    expect((await pathBPurposeConsent(post(body(token), "y".repeat(40)), body(token))).status).toBe(403);
    expect((await pathBPurposeConsent(post(body(token), token, { origin: "https://foreign.example" }), body(token))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    expect((await pathBPurposeConsent(post(body(token), token), body(token))).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([["42501", "x", 404, "not_found"], ["23505", "x", 404, "not_found"],
    ["55000", "uploader_share_unavailable", 409, "state_conflict"], ["55000", "consent_artifact_changed", 409, "consent_artifact_changed"],
    ["XX000", "x", 503, "unavailable"]])("maps a database refusal %s/%s to %i", async (code, message, status, error) => {
    const token = mintPathBPurposePresentation(input).token;
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code, message } });
    const response = await pathBPurposeConsent(post(body(token), token), body(token));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });
});

describe("the person's choices", () => {
  const person = { subjectId, label: "Synthetic Relative",
    uploaderShare: { decision: "deny", gate: "adult.acceptance-hold-72h" },
    readGate: { "reports.monogenic": "directional-purpose-grant-v1", "reports.polygenic": "directional-purpose-grant-v1",
      ancestry: "subject-bound-source" },
    grants: [{ grantId, purpose: "ancestry", direction: "self", grantedAt: "2026-09-29T10:00:00Z" }] };
  function artifact(key: string) {
    const body = `${key} text`;
    return { artifact_key: key, version: 1, body_markdown: body, body_sha256: crypto.createHash("sha256").update(body).digest("hex") };
  }
  beforeEach(() => {
    mocks.artifacts.mockResolvedValue({ data: ["consent.own-monogenic", "consent.own-polygenic", "consent.own-ancestry",
      "consent.share-with-adult"].map(artifact), error: null });
  });
  it("offers each self layer not yet on, and no uploader layer while sharing is closed", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [person], error: null });
    const [view] = (await preparePathBChoices())!;
    expect(view!.shareOpen).toBe(false);
    const row = (purpose: string, direction: string) => view!.choices.find(c => c.purpose === purpose && c.direction === direction)!;
    expect(row("ancestry", "self")).toMatchObject({ grantId, offer: null });
    expect(row("reports.monogenic", "self").offer).not.toBeNull();
    for (const purpose of ["reports.monogenic", "reports.polygenic", "ancestry"]) expect(row(purpose, "uploader").offer).toBeNull();
    const claims = readPathBPurposePresentation(row("reports.monogenic", "self").offer!.token)!;
    expect(claims).toMatchObject({ accountId, sessionId, subjectId, direction: "self", artifactKey: "consent.own-monogenic" });
  });
  it("offers the uploader layers once sharing is open", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ ...person, uploaderShare: { decision: "allow", gate: null } }], error: null });
    const [view] = (await preparePathBChoices())!;
    const offer = view!.choices.find(c => c.purpose === "ancestry" && c.direction === "uploader")!.offer!;
    expect(readPathBPurposePresentation(offer.token)).toMatchObject({ direction: "uploader", artifactKey: "consent.share-with-adult" });
  });
  it("is nothing outside TEST-LOCAL or signed out", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });
    expect(await preparePathBChoices()).toBeNull();
    vi.stubEnv("INHERIT_TEST_JURISDICTION", "");
    expect(await preparePathBChoices()).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("renders each row, says nothing is made yet, and says why sharing is closed", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [person], error: null });
    const people = (await preparePathBChoices())!;
    const html = renderToStaticMarkup(createElement(PathBChoices, { people }));
    const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
    expect(html).toContain('data-slot="path-b-choices"');
    expect(text).toContain(COPY.heading);
    expect(text).toContain(COPY.detail);
    expect(html.match(/data-slot="path-b-choice"/g)).toHaveLength(6);
    expect(html.match(/role="note"/g)).toHaveLength(3);
    expect(text).toContain(COPY.shareClosed);
    expect(text).toContain(`${COPY.turnOff}: ${COPY.layers.ancestry}, ${COPY.forYou.toLowerCase()}`);
    expect(text).toContain(COPY.affirmSelf);
    expect(text).not.toContain(COPY.affirmShare);
  });
});
