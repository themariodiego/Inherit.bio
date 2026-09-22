import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OwnUploadLimits } from "@/lib/uploads/subject-upload-contract";
import { Uploader } from "./uploader";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const limits: OwnUploadLimits = {
  maximumArrayBytes: 52_428_800, maximumVcfBytes: 2_147_483_648,
  maximumGvcfBytes: 4_294_967_296, maximumAccountBytes: 10_000_000_000,
  maximumActiveUploads: 2, activeUploads: 0, reservedBytes: 0,
};

describe("uploader size disclosure", () => {
  it("renders the distinct gVCF ceiling supplied by the deployment", () => {
    const html = renderToStaticMarkup(createElement(Uploader, { limits }));
    expect(html).toContain("genotype table files up to 52 MB");
    expect(html).toContain("VCF files up to 2147 MB");
    expect(html).toContain("gVCF files up to 4294 MB");
    expect(html).not.toContain("VCF or gVCF files");
  });

  it("shows the transport ceiling rather than promising an unreachable configured gVCF size", () => {
    const html = renderToStaticMarkup(createElement(Uploader, {
      limits: { ...limits, maximumGvcfBytes: 8_589_934_592 },
    }));
    expect(html).toContain("VCF files up to 2147 MB");
    expect(html).toContain("gVCF files up to 5242 MB");
    expect(html).not.toContain("8589 MB");
  });

  it("preserves the combined VCF sentence when the deployment has no separate gVCF limit", () => {
    const html = renderToStaticMarkup(createElement(Uploader, {
      limits: { ...limits, maximumGvcfBytes: undefined },
    }));
    expect(html).toContain("VCF or gVCF files up to 2147 MB");
  });
});
