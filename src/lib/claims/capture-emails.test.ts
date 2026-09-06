import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { renderMail, mailSubject } from "../email";
import { captureEmailClaims, sha256, type EmailCaptureResult } from "./capture-emails";
import { EMAIL_RENDERERS, emailFixtures } from "./email-fixtures";
import { assertEmailFixtureCoverage, discoverEmailExports, readEmailInventory, readPublicDigestCatalog } from "./email-inventory";

const projectRoot = resolve(".");
// Intentionally no invented registry records or permissive provenance resolvers.
const noCanonicalRegistry = { resolveCitation: () => undefined, resolveClaim: () => undefined };
const resolvers = { registry: noCanonicalRegistry, resolveSeed: () => false, resolveComputed: () => false };

describe("independent production email fixture inventory", () => {
  it("covers all actual named exports and both account-deletion entrypoints", () => {
    const discovered = readEmailInventory(projectRoot), fixtures = emailFixtures(readPublicDigestCatalog(projectRoot));
    expect(discovered).toHaveLength(12);
    expect(new Set(discovered.map((e) => e.path)).size).toBe(11);
    expect(discovered.filter((e) => e.path.endsWith("account-deletion.tsx")).map((e) => e.exportName)).toEqual([
      "AccountDeletionCancelledEmail", "AccountDeletionNoticeEmail",
    ]);
    expect(() => assertEmailFixtureCoverage(discovered, fixtures)).not.toThrow();
    expect(new Set(fixtures.map((f) => f.mail.id))).toEqual(new Set(Object.keys(EMAIL_RENDERERS)));
  });
  it("detects a new file/export independently of an unchanged fixture list", () => {
    const fixtures = emailFixtures(readPublicDigestCatalog(projectRoot));
    const found = [...readEmailInventory(projectRoot), ...discoverEmailExports([
      { path: "src/emails/new-mail.tsx", source: "export function NewMail() { return null; }" },
    ])];
    expect(() => assertEmailFixtureCoverage(found, fixtures)).toThrow("uncovered-production-export");
    const secondExport = discoverEmailExports([{ path: "src/emails/report-ready.tsx", source:
      "export function ReportReadyEmail() { return null; } export const AnotherEmail = () => null; export interface Props {}" }]);
    expect(secondExport.map((e) => e.exportName)).toEqual(["AnotherEmail", "ReportReadyEmail"]);
  });
  it("refuses unknown export forms and excludes only the explicitly named composition file", () => {
    expect(discoverEmailExports([{ path: "src/emails/base.tsx", source: "export function EmailLayout() {}" }])).toEqual([]);
    expect(() => discoverEmailExports([{ path: "src/emails/new.tsx", source: "export default function NewMail() {}" }])).toThrow("unclassified-export");
    expect(() => discoverEmailExports([{ path: "src/emails/new.tsx", source: 'export { Mail } from "./other";' }])).toThrow("unclassified-export");
  });
  it("does not accept missing, duplicate or mismatched fixtures", () => {
    const found = readEmailInventory(projectRoot), fixtures = emailFixtures(readPublicDigestCatalog(projectRoot));
    expect(() => assertEmailFixtureCoverage(found, fixtures.filter((f) => f.mail.id !== "account-deletion-cancelled"))).toThrow("missing-fixture");
    expect(() => assertEmailFixtureCoverage(found, [...fixtures, fixtures[0]])).toThrow("invalid-fixture-inventory");
    expect(() => assertEmailFixtureCoverage(found, [{ ...fixtures[0], exportName: "WrongEmail" }, ...fixtures.slice(1)])).toThrow("fixture-export-mismatch");
  });
  it("expands all current conditional branches and explicitly distinguishes empty digest scope", () => {
    const fixtures = emailFixtures(readPublicDigestCatalog(projectRoot));
    expect(fixtures).toHaveLength(27);
    expect(fixtures.filter((f) => f.mail.id === "embryo-disposition-notice").map((f) => f.mail.payload)).toEqual(expect.arrayContaining([
      expect.objectContaining({ disposition: "stored" }), expect.objectContaining({ disposition: "transferred" }),
      expect.objectContaining({ disposition: "donated" }), expect.objectContaining({ disposition: "discarded" }),
    ]));
    expect(fixtures.find((f) => f.id === "research-digest--empty")?.required.requiredClaimRegions).toEqual(["email-body"]);
    expect(fixtures.find((f) => f.id === "research-digest--public-catalog")?.required.requiredClaimRegions).toEqual(["email-body", "research-digest-entries"]);
    expect(fixtures.every((f) => f.required.requiresClaimWrapping === false)).toBe(true);
    const full = fixtures.find((f) => f.id === "research-digest--public-catalog")!;
    if (full.mail.id !== "research-digest") throw new Error("fixture mismatch");
    expect(full.mail.payload.entries).toHaveLength(162);
    expect(full.mail.payload.entries.map((e) => [e.title, e.summary]).sort()).toEqual(readPublicDigestCatalog(projectRoot).map((e) => [e.title, e.summary]).sort());
  });
});

describe("actual production email HTML and envelope capture", () => {
  let outputDirectory: string, result: EmailCaptureResult;
  beforeAll(async () => {
    outputDirectory = join(await mkdtemp(join(tmpdir(), "inherit-email-capture-test-")), "capture");
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No outbound request allowed"));
    try {
      result = await captureEmailClaims({ outputDirectory, ...resolvers });
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  }, 60_000);

  it("retains every expected fixture before reporting actual annotation failures", () => {
    expect(result.receipts).toHaveLength(27);
    expect(result.observations).toHaveLength(54);
    expect(result.requiredSurfaces).toHaveLength(54);
    expect(result.observations.every((o) => o.channel === "email" && o.contentCommitSha === result.contentCommitSha)).toBe(true);
    expect(result.audit.ok).toBe(false);
    expect(result.audit.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["missing-channel", "missing-region", "empty-corpus"]));
    for (const channel of ["static-build", "seeded-authenticated", "export"]) {
      expect(result.audit.issues).toContainEqual({ code: "missing-channel", path: `observations.${channel}` });
    }
    expect(result.audit.issues.some((i) => i.code === "unknown-surface")).toBe(false);
  });
  it("hashes exact original renderer bytes and binds every retained observation/input", async () => {
    const fixtures = emailFixtures(readPublicDigestCatalog(projectRoot));
    for (const receipt of result.receipts) {
      const fixture = fixtures.find((f) => f.id === receipt.fixtureId)!;
      for (const artifact of [receipt.input, receipt.html, receipt.subject, receipt.observations]) {
        expect(sha256(await readFile(join(outputDirectory, artifact.path)))).toBe(artifact.sha256);
      }
      expect(await readFile(join(outputDirectory, receipt.html.path), "utf8")).toBe(await renderMail(fixture.mail));
      expect(await readFile(join(outputDirectory, receipt.subject.path), "utf8")).toBe(mailSubject(fixture.mail));
      expect(JSON.parse(await readFile(join(outputDirectory, receipt.input.path), "utf8")).fixture).toEqual(fixture);
      const pair = JSON.parse(await readFile(join(outputDirectory, receipt.observations.path), "utf8"));
      expect(pair).toEqual(result.observations.filter((o) => o.surface === fixture.required.surface || o.surface === `${fixture.required.surface}#envelope=subject`));
      expect(pair[0].payloadSha256).toBe(receipt.html.sha256);
      expect(pair[1].payloadSha256).toBe(receipt.subject.sha256);
    }
    expect(JSON.parse(await readFile(join(outputDirectory, "capture.json"), "utf8"))).toEqual(result);
    expect(sha256(await readFile(join(outputDirectory, result.collector.path)))).toBe(result.collector.sha256);
  });
  it("preserves actual public digest prose without fabricating wrappers or exemptions", () => {
    const full = result.observations.find((o) => o.surface.endsWith("#fixture=research-digest--public-catalog"))!;
    expect(full.claims).toEqual([]);
    expect(full.claimRegions).toEqual([]);
    expect(full.texts.some((t) => t.text.includes("C codes for Leu374"))).toBe(true);
    expect(full.texts.some((t) => t.text.includes("Informational, not medical advice."))).toBe(true);
    expect(full.texts.some((t) => t.text.includes("Manage email preferences"))).toBe(true);
    expect(full.texts.every((t) => t.kind === "content")).toBe(true);
    const subject = result.observations.find((o) => o.surface.endsWith("#fixture=research-digest--public-catalog#envelope=subject"))!;
    expect(subject.texts.map((t) => t.text)).toEqual(["New reports in the Inherit research library"]);
  });
  it("refuses to overwrite earlier immutable receipts", async () => {
    const before = await readFile(join(outputDirectory, "capture.json"));
    await expect(captureEmailClaims({ outputDirectory, ...resolvers })).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(join(outputDirectory, "capture.json"))).toEqual(before);
  });
  it("captures in the standalone tsx runner without host-only serialization helpers", async () => {
    const directory = join(await mkdtemp(join(tmpdir(), "inherit-email-standalone-test-")), "capture");
    const script = `import { captureEmailClaims } from "./src/lib/claims/capture-emails";
      (async () => { const result = await captureEmailClaims({ outputDirectory: ${JSON.stringify(directory)},
        registry: { resolveCitation: () => undefined, resolveClaim: () => undefined },
        resolveSeed: () => false, resolveComputed: () => false });
        console.log(JSON.stringify({ receipts: result.receipts.length, observations: result.observations.length, ok: result.audit.ok })); })();`;
    const output = await promisify(execFile)(resolve("node_modules/.bin/tsx"), ["-e", script], { cwd: projectRoot, timeout: 30_000 });
    expect(JSON.parse(output.stdout)).toEqual({ receipts: 27, observations: 54, ok: false });
    const retained: EmailCaptureResult = JSON.parse(await readFile(join(directory, "capture.json"), "utf8"));
    expect(retained.observations).toEqual(result.observations);
    expect(retained.collector.sha256).toBe(result.collector.sha256);
  }, 40_000);
});
