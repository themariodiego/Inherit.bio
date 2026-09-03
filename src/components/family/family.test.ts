import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    h("a", { href, ...rest }, children as never),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined }),
}));

const { PeopleList } = await import("./people-list");
const { PersonCard, personCardLine } = await import("./person-card");
const { PermissionColumn } = await import("./permission-column");
const { PermissionGrantRow } = await import("./permission-grant-row");
const { ResultGate } = await import("./result-gate");
const { SharingActions } = await import("./sharing-actions");
const hub = await import("../../copy/family/index");
const person = await import("../../copy/family/person");
const permissions = await import("../../copy/family/permissions");

import type { FamilyPerson, Purpose } from "@/lib/family/graph";

const VIEWER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COUNTERPART = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SELF_B = "22222222-2222-4222-8222-222222222222";
const HANDLE = "33333333-3333-4333-8333-333333333333";

function bo(overrides: Partial<FamilyPerson> = {}): FamilyPerson {
  return {
    handle: {
      id: HANDLE,
      displayLabel: "Invited adult",
      subjectClass: "other_adult",
      lifecycle: "active",
      lifecycleRevision: 1,
      routeSegment: `s-${HANDLE}`,
      ownerAccountId: null,
      subjectAccountId: COUNTERPART,
      dataSubjectId: SELF_B,
    },
    dataSubjectId: SELF_B,
    counterpartAccountId: COUNTERPART,
    displayLabel: "Bo",
    origin: "invited-by-me",
    sharing: "active",
    grantsToViewer: new Set<Purpose>(),
    grantsFromViewer: new Set<Purpose>(),
    ...overrides,
  };
}

describe("family people list", () => {
  it("renders one card per person: disc, name, chip and exactly one state line", () => {
    const html = renderToStaticMarkup(
      h(PeopleList, {
        entries: [{ person: bo(), state: "waiting", href: `/family/s-${HANDLE}` }],
        viewerAccountId: VIEWER,
      }),
    );
    expect(html).toContain(`data-subject-id="${HANDLE}"`);
    expect(html).toMatch(/data-slot="subject-disc"[^>]*>B</);
    expect(html).toMatch(/data-slot="subject-name"[^>]*>Bo</);
    expect(html).toMatch(/data-slot="subject-kind"[^>]*>Shared with you</);
    expect(html).toContain(`href="/family/s-${HANDLE}"`);
    expect(html).toContain("Waiting for Bo to share");
    // Exactly one state line, and no number about their files.
    expect(html.match(/data-slot="person-state"/g)).toHaveLength(1);
    expect(html).not.toMatch(/\d+ files?/);
  });

  it("names the four card states and nothing else", () => {
    expect(personCardLine("ready", "Bo")).toBe(hub.CARD_READY_STATUS);
    expect(personCardLine("no-file", "Bo")).toBe(hub.CARD_NO_FILE_STATUS);
    expect(personCardLine("paused", "Bo")).toBe(hub.CARD_PAUSED_STATUS);
    expect(personCardLine("waiting", "Bo")).toBe("Waiting for Bo to share");
  });

  it("renders no ranking, score or order control", () => {
    const html = renderToStaticMarkup(
      h(PeopleList, {
        entries: [
          { person: bo(), state: "ready", href: "/family/one" },
          {
            person: bo({ displayLabel: "Ana", handle: { ...bo().handle, id: "44444444-4444-4444-8444-444444444444" } }),
            state: "no-file",
            href: "/family/two",
          },
        ],
        viewerAccountId: VIEWER,
      }),
    );
    expect(html).not.toContain("aria-sort");
    expect(html).not.toMatch(/highest|lowest|rank/i);
    expect(html).not.toContain("data-figure-kind");
  });
});

describe("tier 2 result gate", () => {
  it("renders the exact checkbox, the session sentence and one action, and no result", () => {
    const html = renderToStaticMarkup(h(ResultGate));
    expect(html).toContain("I understand this can tell me something I can’t un-know.");
    expect(html).toContain("You won’t be asked again until you sign out.");
    expect(html).toContain("Show what’s shared");
    expect(html).toContain('type="checkbox"');
    // Nothing is pre-ticked, and the gate carries no result of any kind.
    expect(html).not.toContain('checked=""');
    expect(html).not.toContain("data-claim-block");
    expect(html).not.toContain("data-figure-kind");
    expect(html).toContain(person.GATE_HEADING);
  });
});

describe("permission columns", () => {
  const rows = permissions.PERMISSION_ROWS.map((row) => ({ id: row.id, state: "off" as const }));

  it("renders the five rows in order, all off, with no master switch", () => {
    const html = renderToStaticMarkup(
      h(PermissionColumn, {
        heading: permissions.yourColumnHeading("Bo"),
        headingId: "your-column",
        personName: "Bo",
        rows,
      }),
    );
    for (const row of permissions.PERMISSION_ROWS) expect(html).toContain(row.label);
    expect(html.match(/data-slot="permission-row"/g)).toHaveLength(5);
    expect(html.match(/data-permission-state="off"/g)).toHaveLength(5);
    expect(html).not.toMatch(/everything|all rows|master/i);
    expect(html).toContain("What Bo will see about you");
  });

  it("disables the column this session may not set and names who can", () => {
    const html = renderToStaticMarkup(
      h(PermissionColumn, {
        heading: permissions.theirColumnHeading("Bo"),
        headingId: "their-column",
        personName: "Bo",
        rows,
        disabledReason: permissions.onlyTheyCanTurnThisOn("Bo"),
      }),
    );
    expect(html).toContain('data-settable="false"');
    expect(html.match(/Only Bo can turn this on\./g)).toHaveLength(5);
    expect(html).not.toContain('data-slot="permission-control"');
  });

  it("shows permission state as a glyph plus a word, never as colour alone", () => {
    const html = renderToStaticMarkup(
      h(PermissionGrantRow, {
        label: "Ancestry",
        consequence: permissions.PERMISSION_ROWS[2].consequence,
        personName: "Bo",
        state: "on",
        action: { kind: "revoke", grantId: "55555555-5555-4555-8555-555555555555" },
      }),
    );
    expect(html).toContain('data-slot="permission-glyph"');
    expect(html).toMatch(/data-slot="permission-state"[^>]*>On</);
    expect(html).toContain('aria-label="Ancestry for Bo"');
    expect(html).not.toMatch(/text-(?:danger|forest|green|red)/);
  });
});

describe("sharing actions", () => {
  it("offers pause and stop, and resume only while paused", () => {
    const active = renderToStaticMarkup(
      h(SharingActions, {
        personName: "Bo",
        personSegment: `s-${HANDLE}`,
        paused: false,
        stopNonce: "nonce",
      }),
    );
    expect(active).toContain("Pause sharing");
    expect(active).toContain("Stop sharing");
    expect(active).not.toContain("Resume sharing");
    expect(active).toContain(permissions.PAUSE_OR_STOP_HEADING);
    // The dialog is not open until the destructive action is chosen.
    expect(active).not.toContain('data-slot="stop-dialog"');

    const paused = renderToStaticMarkup(
      h(SharingActions, {
        personName: "Bo",
        personSegment: `s-${HANDLE}`,
        paused: true,
        stopNonce: "nonce",
      }),
    );
    expect(paused).toContain("Resume sharing");
    expect(paused).not.toContain("Pause sharing");
  });
});

describe("person card chip", () => {
  it("never calls another adult's own record `You`", () => {
    // The invitee sees the inviter through the inviter's own self subject.
    const inviter = bo({
      origin: "invited-me",
      handle: {
        id: "66666666-6666-4666-8666-666666666666",
        displayLabel: "You",
        subjectClass: "self",
        lifecycle: "active",
        lifecycleRevision: 1,
        routeSegment: "s-66666666-6666-4666-8666-666666666666",
        ownerAccountId: COUNTERPART,
        subjectAccountId: COUNTERPART,
        dataSubjectId: "66666666-6666-4666-8666-666666666666",
      },
      displayLabel: "Another adult",
    });
    const html = renderToStaticMarkup(
      h(PersonCard, { person: inviter, state: "waiting", href: "/family/x", viewerAccountId: VIEWER }),
    );
    expect(html).toMatch(/data-slot="subject-kind"[^>]*>Shared with you</);
    expect(html).not.toMatch(/data-slot="subject-kind"[^>]*>You</);
  });
});
