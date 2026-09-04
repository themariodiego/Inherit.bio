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

  it("treats an adult record bound to the viewer's own account as the viewer's genome", () => {
    // An accepted invitation clears the owner and binds the record to the invitee.
    const accepted = subject({ subjectClass: "other_adult", ownerAccountId: null, subjectAccountId: OTHER });
    expect(subjectKind(accepted, OTHER)).toBe("self");
    expect(subjectKind(accepted, OWNER)).toBe("adult_shared");
    expect(subjectKind(accepted)).toBe("adult_shared");
  });

  it("reads another account's self record as shared with the viewer", () => {
    // The Family graph resolves an invitee to the inviter's own self
    // subject; "You" would then name the wrong person.
    expect(subjectKind(subject(), OTHER)).toBe("adult_shared");
    expect(subjectKind(subject(), OWNER)).toBe("self");
  });

  it("renders no chip for a minor record (D11)", () => {
    expect(subjectKind(subject({ subjectClass: "minor", subjectAccountId: null }))).toBeNull();
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
    // X2.4: an embryo's disc carries no subject colour token.
    expect(html).not.toMatch(/bg-subject-/);
    expect(html).toMatch(/data-slot="subject-disc"[^>]*>E</);
  });

  it("renders no file count when the count is withheld", () => {
    const html = renderToStaticMarkup(
      h(SubjectBar, {
        subject: subject({ subjectClass: "other_adult", subjectAccountId: OTHER, routeSegment: "s-y" }),
        fileCount: null,
      }),
    );
    expect(html).not.toContain('data-slot="subject-files"');
    expect(html).toMatch(/data-slot="subject-kind"[^>]*>Shared with you</);
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
    // Uploads bind to the caller's self record, so no other bar offers the action.
    expect(html).not.toContain("/files/upload");
  });

  it("renders no kind chip and no upload action on a minor bar", () => {
    const html = renderToStaticMarkup(
      h(SubjectBar, {
        subject: subject({ subjectClass: "minor", subjectAccountId: null, routeSegment: "s-z" }),
        fileCount: 0,
      }),
    );
    expect(html).not.toContain('data-slot="subject-kind"');
    expect(html).not.toContain("/files/upload");
    expect(html).toMatch(/data-slot="subject-name"[^>]*>Maya</);
  });
});
