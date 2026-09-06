import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/server", () => ({ connection: vi.fn().mockResolvedValue(undefined) }));
import { Uploader } from "./uploader";
import FileUploadPage from "@/app/(app)/files/upload/page";
import { uploadIssuanceError } from "@/lib/uploads/upload-issuance-error";
import { UPLOADS_PAUSED_MESSAGE } from "@/copy/upload/pause";

afterEach(() => vi.unstubAllEnvs());
describe("new uploads paused presentation", () => {
  it("keeps the ordinary picker enabled by default", () => {
    const html = renderToStaticMarkup(createElement(Uploader));
    expect(html).toContain("Choose file");
    expect(html).not.toContain("disabled=");
    expect(html).not.toContain(UPLOADS_PAUSED_MESSAGE);
  });
  it("renders the request-time server pause with disabled picker and the all-files escape", async () => {
    vi.stubEnv("INHERIT_PAUSE_LEGACY_UPLOADS", "true");
    const html = renderToStaticMarkup(await FileUploadPage());
    expect(html).toContain(UPLOADS_PAUSED_MESSAGE);
    expect(html).toContain('role="status"');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('href="/files"');
  });
  it("a pre-pause bridge tab gets the same useful message from live issuance", async () => {
    const response = Response.json({ error: "uploads_paused" }, { status: 503 });
    expect(await uploadIssuanceError(response)).toBe(UPLOADS_PAUSED_MESSAGE);
  });
  it.each([
    Response.json({ error: "uploads_paused" }, { status: 401 }),
    Response.json({ error: "private database details" }, { status: 503 }),
    new Response("not json", { status: 503 }),
  ])("does not expose other provider errors or mislabel them as a pause", async response => {
    expect(await uploadIssuanceError(response)).toBe("Could not authorize this upload.");
  });
});
