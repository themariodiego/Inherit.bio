import { describe, expect, it } from "vitest";
import {
  DIRECTIONAL_PURPOSES,
  buildFamilyPeople,
  familySegmentId,
  isPurpose,
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
    ]);
    expect(isPurpose("reports.polygenic")).toBe(true);
    expect(isPurpose("embryo.analysis")).toBe(false);
  });
});
