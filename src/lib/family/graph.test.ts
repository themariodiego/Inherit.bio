import { describe, expect, it, vi } from "vitest";
import {
  DIRECTIONAL_PURPOSES,
  buildFamilyPeople,
  familySegmentId,
  isPurpose,
  readHeldSharedSubjects,
  type FamilyGrantRow,
  type FamilyGraphRows,
  type FamilySubjectRow,
} from "./graph";

/**
 * The graph's branches over row fixtures (design §6.1): the inviter and the
 * invitee each see the other, a minor is invisible from every side, a pause
 * is a flag rather than a deletion, and the two grant directions are
 * independent sets.
 */

const ACCOUNT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCOUNT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SELF_A = "11111111-1111-4111-8111-111111111111";
const SELF_B = "22222222-2222-4222-8222-222222222222";
const INVITED_B = "33333333-3333-4333-8333-333333333333";
const MINOR = "44444444-4444-4444-8444-444444444444";

function subject(overrides: Partial<FamilySubjectRow> & { id: string }): FamilySubjectRow {
  return {
    displayLabel: "Someone",
    subjectClass: "self",
    lifecycle: "active",
    lifecycleRevision: 1,
    ownerAccountId: null,
    subjectAccountId: null,
    ...overrides,
  };
}

/** The shape an accepted Path A invitation leaves behind (F0 migration). */
function acceptedInvitation(): FamilySubjectRow[] {
  return [
    subject({ id: SELF_A, displayLabel: "Ada", subjectAccountId: ACCOUNT_A }),
    subject({ id: SELF_B, displayLabel: "Bo", subjectAccountId: ACCOUNT_B }),
    subject({
      id: INVITED_B,
      displayLabel: "Invited adult",
      subjectClass: "other_adult",
      ownerAccountId: null,
      subjectAccountId: ACCOUNT_B,
    }),
  ];
}

function rows(overrides: Partial<FamilyGraphRows> & { viewerAccountId: string }): FamilyGraphRows {
  return {
    subjects: acceptedInvitation(),
    invitations: [{ targetSubjectId: INVITED_B, inviterAccountId: ACCOUNT_A }],
    grants: [],
    pausedWithAccountIds: [],
    heldSharedSubjectIds: [],
    ...overrides,
  };
}

describe("family people graph", () => {
  it("gives the inviter the invited record as a handle over the invitee's own self subject", () => {
    const [person, ...rest] = buildFamilyPeople(rows({ viewerAccountId: ACCOUNT_A }));
    expect(rest).toEqual([]);
    expect(person.handle.id).toBe(INVITED_B);
    expect(person.handle.routeSegment).toBe(`s-${INVITED_B}`);
    expect(person.dataSubjectId).toBe(SELF_B);
    expect(person.handle.dataSubjectId).toBe(SELF_B);
    expect(person.counterpartAccountId).toBe(ACCOUNT_B);
    expect(person.displayLabel).toBe("Bo");
    expect(person.origin).toBe("invited-by-me");
    expect(person.sharing).toBe("active");
  });

  it("gives the invitee the inviter's own self subject, never a segment of `me`", () => {
    const [person, ...rest] = buildFamilyPeople(rows({ viewerAccountId: ACCOUNT_B }));
    expect(rest).toEqual([]);
    expect(person.handle.id).toBe(SELF_A);
    expect(person.handle.routeSegment).toBe(`s-${SELF_A}`);
    expect(person.dataSubjectId).toBe(SELF_A);
    expect(person.displayLabel).toBe("Ada");
    expect(person.origin).toBe("invited-me");
  });

  it("never lists a minor, from either side and by either source", () => {
    const withMinor = rows({
      viewerAccountId: ACCOUNT_A,
      subjects: [
        ...acceptedInvitation(),
        subject({
          id: MINOR,
          displayLabel: "A child",
          subjectClass: "minor",
          ownerAccountId: ACCOUNT_A,
          subjectAccountId: null,
        }),
      ],
      invitations: [
        { targetSubjectId: INVITED_B, inviterAccountId: ACCOUNT_A },
        { targetSubjectId: MINOR, inviterAccountId: ACCOUNT_A },
      ],
      grants: [
        {
          purpose: "reports.polygenic",
          granterAccountId: ACCOUNT_A,
          dataSubjectId: MINOR,
          recipientAccountId: ACCOUNT_B,
        },
      ],
    });
    const people = buildFamilyPeople(withMinor);
    expect(people.map((person) => person.handle.id)).toEqual([INVITED_B]);
    expect(people.every((person) => person.handle.subjectClass !== "minor")).toBe(true);
  });

  it("carries a pause as a flag and deletes no grant row", () => {
    const paused = rows({
      viewerAccountId: ACCOUNT_A,
      pausedWithAccountIds: [ACCOUNT_B],
      grants: [
        {
          purpose: "reports.polygenic",
          granterAccountId: ACCOUNT_B,
          dataSubjectId: SELF_B,
          recipientAccountId: ACCOUNT_A,
        },
      ],
    });
    const [person] = buildFamilyPeople(paused);
    expect(person.sharing).toBe("paused");
    expect([...person.grantsToViewer]).toEqual(["reports.polygenic"]);
  });

  it("keeps the two grant directions apart", () => {
    const both = rows({
      viewerAccountId: ACCOUNT_A,
      grants: [
        {
          purpose: "reports.polygenic",
          granterAccountId: ACCOUNT_B,
          dataSubjectId: SELF_B,
          recipientAccountId: ACCOUNT_A,
        },
        {
          purpose: "ancestry",
          granterAccountId: ACCOUNT_A,
          dataSubjectId: SELF_A,
          recipientAccountId: ACCOUNT_B,
        },
      ],
    });
    const [person] = buildFamilyPeople(both);
    expect([...person.grantsToViewer]).toEqual(["reports.polygenic"]);
    expect([...person.grantsFromViewer]).toEqual(["ancestry"]);
  });

  it("reaches a counterpart whose invitation row is gone but whose grant is live", () => {
    const grantOnly = rows({
      viewerAccountId: ACCOUNT_A,
      invitations: [],
      grants: [
        {
          purpose: "reports.monogenic",
          granterAccountId: ACCOUNT_B,
          dataSubjectId: SELF_B,
          recipientAccountId: ACCOUNT_A,
        },
      ],
    });
    const [person, ...rest] = buildFamilyPeople(grantOnly);
    expect(rest).toEqual([]);
    expect(person.handle.id).toBe(SELF_B);
    expect(person.dataSubjectId).toBe(SELF_B);
  });

  it("lists nobody when only the viewer's own records exist", () => {
    expect(
      buildFamilyPeople(
        rows({
          viewerAccountId: ACCOUNT_A,
          subjects: [subject({ id: SELF_A, displayLabel: "Ada", subjectAccountId: ACCOUNT_A })],
          invitations: [],
        }),
      ),
    ).toEqual([]);
  });

  it("never prints the self placeholder as another person's name", () => {
    const unnamed = rows({
      viewerAccountId: ACCOUNT_A,
      subjects: [
        subject({ id: SELF_A, displayLabel: "You", subjectAccountId: ACCOUNT_A }),
        subject({ id: SELF_B, displayLabel: "You", subjectAccountId: ACCOUNT_B }),
        subject({
          id: INVITED_B,
          displayLabel: "Invited adult",
          subjectClass: "other_adult",
          subjectAccountId: ACCOUNT_B,
        }),
      ],
    });
    expect(buildFamilyPeople(unnamed)[0].displayLabel).toBe("Invited adult");

    const fromTheOtherSide = buildFamilyPeople({ ...unnamed, viewerAccountId: ACCOUNT_B });
    expect(fromTheOtherSide[0].displayLabel).toBe("Another adult");
  });

  it("orders people by name alone", () => {
    const zoe = "55555555-5555-4555-8555-555555555555";
    const zoeAccount = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const people = buildFamilyPeople(
      rows({
        viewerAccountId: ACCOUNT_A,
        subjects: [
          ...acceptedInvitation(),
          subject({ id: zoe, displayLabel: "Ana", subjectAccountId: zoeAccount }),
        ],
        grants: [
          {
            purpose: "family.portrait",
            granterAccountId: zoeAccount,
            dataSubjectId: zoe,
            recipientAccountId: ACCOUNT_A,
          },
        ],
      }),
    );
    expect(people.map((person) => person.displayLabel)).toEqual(["Ana", "Bo"]);
  });

  it("reads only `s-{uuid}` segments", () => {
    expect(familySegmentId(`s-${SELF_B}`)).toBe(SELF_B);
    expect(familySegmentId("me")).toBeNull();
    expect(familySegmentId(`${SELF_B}`)).toBeNull();
    expect(familySegmentId("s-not-a-uuid")).toBeNull();
  });

  it("names exactly the purposes the grant transaction accepts", () => {
    expect([...DIRECTIONAL_PURPOSES]).toEqual([
      "reports.monogenic",
      "reports.polygenic",
      "ancestry",
      "copilot.local",
      "family.heritability",
      "family.portrait",
      "export.share-link",
      "raw.export",
      // Added 2026-09-12 with the matching change to
      // `grant_directional_purpose_v1`, which is what this test is for: the
      // two lists must not drift, or a purpose the product offers is one the
      // grant transaction rejects.
      "raw.browse",
    ]);
    expect(isPurpose("reports.polygenic")).toBe(true);
    expect(isPurpose("embryo.analysis")).toBe(false);
  });
});

/**
 * D-156 (owner decision of 22 November 2026): while the adult the viewer
 * invited is under their acceptance hold or a due reminder, the database
 * names their record, and what it shares with the viewer reads exactly as if
 * nothing were shared. The viewer's own grants, and every other viewer, are
 * untouched.
 */
describe("a record the viewer reads as not shared (D-156)", () => {
  const fromB = (purpose: FamilyGrantRow["purpose"]): FamilyGrantRow => ({
    purpose, granterAccountId: ACCOUNT_B, dataSubjectId: SELF_B, recipientAccountId: ACCOUNT_A,
  });
  const fromA: FamilyGrantRow = {
    purpose: "ancestry", granterAccountId: ACCOUNT_A, dataSubjectId: SELF_A, recipientAccountId: ACCOUNT_B,
  };

  it("shows the inviter the invited adult exactly as when they share nothing", () => {
    const shared = [fromB("reports.polygenic"), fromB("copilot.local"), fromB("raw.browse"), fromB("family.heritability")];
    const held = buildFamilyPeople(rows({ viewerAccountId: ACCOUNT_A, grants: [...shared, fromA], heldSharedSubjectIds: [SELF_B] }));
    const nothingShared = buildFamilyPeople(rows({ viewerAccountId: ACCOUNT_A, grants: [fromA] }));
    expect(held).toEqual(nothingShared);
    expect(held).toHaveLength(1);
    expect([...held[0].grantsToViewer]).toEqual([]);
    expect([...held[0].grantsFromViewer]).toEqual(["ancestry"]);
    // Released: the same rows read again, with nothing else changed.
    const released = buildFamilyPeople(rows({ viewerAccountId: ACCOUNT_A, grants: [...shared, fromA] }));
    expect([...released[0].grantsToViewer]).toEqual(["reports.polygenic", "copilot.local", "raw.browse", "family.heritability"]);
  });

  it("does not list a person reachable only through what they share, as when nothing is shared", () => {
    const grantOnly = rows({ viewerAccountId: ACCOUNT_A, invitations: [], grants: [fromB("reports.monogenic")],
      heldSharedSubjectIds: [SELF_B] });
    expect(buildFamilyPeople(grantOnly)).toEqual(buildFamilyPeople(rows({ viewerAccountId: ACCOUNT_A, invitations: [] })));
    expect(buildFamilyPeople(grantOnly)).toEqual([]);
  });

  it("holds only grants to the viewer from the named record: never what the viewer gives", () => {
    const mine = rows({ viewerAccountId: ACCOUNT_A, grants: [fromA, fromB("ancestry")], heldSharedSubjectIds: [SELF_A] });
    const [person] = buildFamilyPeople(mine);
    expect([...person.grantsFromViewer]).toEqual(["ancestry"]);
    expect([...person.grantsToViewer]).toEqual(["ancestry"]);
  });

  it("asks the database once, with exactly this account and the records that share with it", async () => {
    const rpc = vi.fn(async () => ({ data: [SELF_B] as unknown, error: null as unknown }));
    await expect(readHeldSharedSubjects(rpc, ACCOUNT_A, [SELF_B, MINOR])).resolves.toEqual([SELF_B]);
    expect(rpc.mock.calls).toEqual([["adult_acceptance_inviter_held_subjects_v1",
      { p_account_id: ACCOUNT_A, p_subject_ids: [SELF_B, MINOR] }]]);
    const none = vi.fn(async () => ({ data: [] as unknown, error: null as unknown }));
    await expect(readHeldSharedSubjects(none, ACCOUNT_A, [SELF_B])).resolves.toEqual([]);
    const unasked = vi.fn(async () => ({ data: [] as unknown, error: null as unknown }));
    await expect(readHeldSharedSubjects(unasked, ACCOUNT_A, [])).resolves.toEqual([]);
    expect(unasked).not.toHaveBeenCalled();
  });

  it("reads every record as not shared when the answer fails or is not one it asked about", async () => {
    const asked = [SELF_B, MINOR];
    const answers: Array<() => Promise<{ data: unknown; error: unknown }>> = [
      async () => ({ data: null, error: { code: "PGRST202" } }),
      async () => ({ data: "not a list", error: null }),
      async () => ({ data: [SELF_B, INVITED_B], error: null }),
      async () => ({ data: [42], error: null }),
      async () => { throw new Error("network"); },
    ];
    for (const answer of answers) {
      await expect(readHeldSharedSubjects(vi.fn(answer), ACCOUNT_A, asked)).resolves.toEqual(asked);
    }
  });
});
