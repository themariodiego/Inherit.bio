import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    h("a", { href, ...rest }, children as never),
}));

const { SubjectBar, subjectKind } = await import("./subject-bar");

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function subject(overrides: Partial<Parameters<typeof subjectKind>[0]> = {}) {
  return {
    id: "6b1f4d6e-4c1a-4a7e-9b2f-1c2d3e4f5a6b",
    displayLabel: "Maya",
    subjectClass: "self" as const,
    routeSegment: "me",
    ownerAccountId: OWNER,
    subjectAccountId: OWNER,
    ...overrides,
  };
}

describe("subjectKind", () => {
  it("derives exactly one kind chip per subject shape", () => {
    expect(subjectKind(subject())).toBe("self");
    expect(subjectKind(subject({ subjectClass: "embryo" }))).toBe("embryo");
    expect(
      subjectKind(subject({ subjectClass: "other_adult", subjectAccountId: OTHER })),
    ).toBe("adult_shared");
    expect(
      subjectKind(subject({ subjectClass: "other_adult", subjectAccountId: null })),
    ).toBe("adult_uploaded");
    expect(
      subjectKind(subject({ subjectClass: "other_adult", subjectAccountId: OWNER })),
    ).toBe("adult_uploaded");
  });
});

describe("SubjectBar", () => {
  it("renders the disc, name, kind chip, file count link and the outline add-a-file action", () => {
    const html = renderToStaticMarkup(h(SubjectBar, { subject: subject(), fileCount: 1 }));
    expect(html).toContain('data-subject-id="6b1f4d6e-4c1a-4a7e-9b2f-1c2d3e4f5a6b"');
    expect(html).toContain("bg-subject-0");
    expect(html).toMatch(/data-slot="subject-disc"[^>]*>M</);
    expect(html).toMatch(/data-slot="subject-name"[^>]*>Maya</);
    expect(html).toMatch(/data-slot="subject-kind"[^>]*>You</);
    expect(html).toMatch(/<a href="\/files"[^>]*>1 file</);
    expect(html).toContain('href="/files/upload?subject=me"');
    expect(html).toContain('data-variant="outline"');
    expect(html).not.toContain('data-variant="default"');
  });

  it("pluralises the file count and hides the add-a-file action on embryo bars", () => {
    const html = renderToStaticMarkup(
      h(SubjectBar, {
        subject: subject({ subjectClass: "embryo", displayLabel: "Embryo 3", routeSegment: "s-x" }),
        fileCount: 3,
      }),
    );
    expect(html).toMatch(/data-slot="subject-kind"[^>]*>Embryo</);
    expect(html).toContain(">3 files<");
    expect(html).not.toContain("/files/upload");
  });

  it("uses a hashed colour token for other subjects", () => {
    const html = renderToStaticMarkup(
      h(SubjectBar, {
        subject: subject({ subjectClass: "other_adult", subjectAccountId: OTHER, routeSegment: "s-y" }),
        fileCount: 0,
      }),
    );
    expect(html).toMatch(/bg-subject-[0-7]/);
    expect(html).toMatch(/data-slot="subject-kind"[^>]*>Shared with you</);
    expect(html).toContain(">0 files<");
  });
});
