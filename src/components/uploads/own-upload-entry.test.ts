import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OWN_UPLOAD_COPY } from "@/copy/upload/consent";
import type { OwnUploadView } from "@/lib/uploads/own-upload-view";
import { OwnUploadFlow } from "./own-upload-flow";
import { OwnUploadEntry } from "./own-upload-entry";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), limits: vi.fn() }));
vi.mock("@/lib/uploads/prepare-own-upload", () => ({ prepareOwnUpload: mocks.prepare }));
vi.mock("@/lib/uploads/own-upload-limits", () => ({ readOwnUploadLimits: mocks.limits }));

const ceilings = { maximumArrayBytes: 52_428_800, maximumVcfBytes: 25_165_824,
  maximumAccountBytes: 134_217_728, maximumActiveUploads: 2, reservedBytes: 0, activeUploads: 0 };
beforeEach(() => {
  vi.stubEnv("INHERIT_CANONICAL_UPLOADS_PAUSED", "true");
  mocks.limits.mockResolvedValue(ceilings);
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("own upload entry during issuance pause", () => {
  it.each<OwnUploadView>([
    { kind: "ready", subjectId: "subject" },
    { kind: "account-completion", token: "private-presentation" },
    { kind: "consent", token: "private-presentation", subjectId: "subject",
      artifact: { key: "consent.upload-self", version: 1, body: "artifact body", summary: "artifact summary" } },
  ])("checks readiness then replaces the %s upload entry with recovery copy", async view => {
    mocks.prepare.mockResolvedValue(view);
    const element = await OwnUploadEntry();
    expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith();
    const html = renderToStaticMarkup(element);
    expect(html).toContain('role="status"');
    expect(html).toContain(OWN_UPLOAD_COPY.uploadsPaused);
    expect(html).not.toMatch(/<input|<button|private-presentation|artifact body/);
  });

  it.each<OwnUploadView>([{ kind: "underage" }, { kind: "unavailable" }])(
    "preserves the existing refusal %s instead of suggesting uploading later", async view => {
      mocks.prepare.mockResolvedValue(view);
      const element = await OwnUploadEntry();
      expect(element.type).toBe(OwnUploadFlow);
      expect(element.props.view).toEqual(view);
    },
  );

  it("preserves preparation-outage recovery", async () => {
    mocks.prepare.mockRejectedValue(new Error("private details"));
    const element = await OwnUploadEntry();
    expect(element.type).toBe(OwnUploadFlow);
    expect(element.props.view).toEqual({ kind: "unavailable" });
  });

  it.each([undefined, "", "false", "1", "TRUE"])("leaves the normal flow available unless explicitly true (%s)", async flag => {
    vi.stubEnv("INHERIT_CANONICAL_UPLOADS_PAUSED", flag);
    const view = { kind: "ready", subjectId: "subject" };
    mocks.prepare.mockResolvedValue(view);
    const element = await OwnUploadEntry();
    expect(element.type).toBe(OwnUploadFlow);
    expect(element.props.view).toEqual(view);
  });
});

/**
 * A person cannot plan around a limit nobody states. The ceiling comes from
 * the deployment at request time, and an unreadable one states nothing rather
 * than a guess — it must never take the upload itself down.
 */
describe("stating the deployment ceiling before a file is chosen", () => {
  beforeEach(() => { vi.stubEnv("INHERIT_CANONICAL_UPLOADS_PAUSED", ""); });

  it("hands the live ceilings to the upload flow", async () => {
    mocks.prepare.mockResolvedValue({ kind: "ready", subjectId: "subject" });
    const element = await OwnUploadEntry();
    expect(element.props.limits).toEqual(ceilings);
    expect(mocks.limits).toHaveBeenCalledExactlyOnceWith();
  });

  it.each([null, undefined])("states no ceiling when the disclosure is unavailable (%j)", async value => {
    mocks.prepare.mockResolvedValue({ kind: "ready", subjectId: "subject" });
    mocks.limits.mockResolvedValue(value);
    const element = await OwnUploadEntry();
    expect(element.type).toBe(OwnUploadFlow);
    expect(element.props.limits ?? null).toBeNull();
  });

  it("states both ceilings only when they differ, and always the unpacked caveat", () => {
    expect(OWN_UPLOAD_COPY.limitStatement(25, 25)).toBe(
      "We can take files up to 25 MB. A compressed file is measured after it is unpacked,"
      + " so the unpacked size has to fit as well.");
    const split = OWN_UPLOAD_COPY.limitStatement(52, 25);
    expect(split).toContain("genotype table files up to 52 MB");
    expect(split).toContain("VCF or gVCF files up to 25 MB");
    expect(split).toContain("unpacked");
  });

  it("keeps the three size refusals apart and names no account when none is at fault", () => {
    expect(OWN_UPLOAD_COPY.tooLarge(25)).toContain("25 MB");
    expect(OWN_UPLOAD_COPY.tooLarge(25)).not.toContain("account");
    expect(OWN_UPLOAD_COPY.decompressedTooLarge).toContain("unpacked");
    expect(OWN_UPLOAD_COPY.decompressedTooLarge).not.toContain("account");
    expect(OWN_UPLOAD_COPY.accountFull(8)).toContain("8 MB");
    expect(OWN_UPLOAD_COPY.accountFull(8)).toContain("Delete a file");
    for (const sentence of [OWN_UPLOAD_COPY.tooLarge(25), OWN_UPLOAD_COPY.decompressedTooLarge,
      OWN_UPLOAD_COPY.accountFull(8), OWN_UPLOAD_COPY.tooLargeUnknownLimit,
      OWN_UPLOAD_COPY.accountFullUnknownLimit]) {
      // The refused file is never described, and no future limit is promised.
      expect(sentence).not.toMatch(/exceeds the current upload limit for your account|soon|will support|coming/);
      expect(sentence.length).toBeLessThanOrEqual(240);
    }
  });
});
