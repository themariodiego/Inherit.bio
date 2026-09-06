import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OWN_UPLOAD_COPY } from "@/copy/upload/consent";
import type { OwnUploadView } from "@/lib/uploads/own-upload-view";
import { OwnUploadFlow } from "./own-upload-flow";
import { OwnUploadEntry } from "./own-upload-entry";

const mocks = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock("@/lib/uploads/prepare-own-upload", () => ({ prepareOwnUpload: mocks.prepare }));

beforeEach(() => { vi.stubEnv("INHERIT_CANONICAL_UPLOADS_PAUSED", "true"); });
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
