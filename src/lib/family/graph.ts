import "server-only";

import { SELF_PLACEHOLDER_LABEL, UNNAMED_PERSON_LABEL } from "@/copy/family/index";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SubjectSummary } from "@/lib/subjects";

/**
 * The Family people graph (design §1.3). `listSubjectsForAccount` cannot
 * answer for Family: an accepted adult invitation clears the invited
 * record's `owner_account_id` and binds it to the invitee, so the inviter
 * can neither list nor resolve it, and the invitee's own genome lives on
 * their `self` subject rather than on the invited record.
 *
 * A `FamilyPerson` therefore separates the two ideas the rest of the domain
 * kept conflated:
 *   - `handle` is the record the route names (`/family/s-{uuid}`);
 *   - `dataSubjectId` is the subject whose rows are read — the counterpart's
 *     own `self` subject, because every file is bound to its uploader's
 *     `self` record (src/app/api/uploads/route.ts).
 *
 * Three sources, all read with the service-role client and joined here:
 *   (a) accepted `adult_subject` invitations, from either side;
 *   (b) `other_adult` records this account owns (Path B, which no screen
 *       creates yet);
 *   (c) live `purpose_grants ⋈ directional_grants` pairs between the two
 *       accounts, so a person whose invitation row is gone but whose grant
 *       is live is still reachable.
 *
 * `minor` records are excluded everywhere (X2.3; design §2.7): a minor is
 * never listed, never resolved and never linked, so a `minor` segment is a
 * 404 like any unknown one.
 *
 * Nothing here ranks or orders people by anything but their name.
 */

/** The purposes a directional grant may carry (grant_directional_purpose_v1). */
export const DIRECTIONAL_PURPOSES = [
  "reports.monogenic",
  "reports.polygenic",
  "ancestry",
  "copilot.local",
  "family.heritability",
  "family.portrait",
  "export.share-link",
  "raw.export",
] as const;

export type Purpose = (typeof DIRECTIONAL_PURPOSES)[number];

export function isPurpose(value: string): value is Purpose {
  return (DIRECTIONAL_PURPOSES as readonly string[]).includes(value);
}

export type FamilyOrigin = "invited-by-me" | "invited-me" | "uploaded-by-me";

export interface FamilyPerson {
  /** The record the route names; its `routeSegment` is always `s-{uuid}`. */
  handle: SubjectSummary;
  /** The subject whose rows are read: the counterpart's own self subject. */
  dataSubjectId: string;
  counterpartAccountId: string;
  /** The counterpart's own self-subject label. */
  displayLabel: string;
  origin: FamilyOrigin;
  sharing: "active" | "paused";
  /** Live directional grants, counterpart → viewer. A pause does not empty this set; it suspends it. */
  grantsToViewer: ReadonlySet<Purpose>;
  /** Live directional grants, viewer → counterpart. */
  grantsFromViewer: ReadonlySet<Purpose>;
}

/** The subject columns the graph reads. */
export interface FamilySubjectRow {
  id: string;
  displayLabel: string;
  subjectClass: string;
  lifecycle: string;
  lifecycleRevision: number;
  ownerAccountId: string | null;
  subjectAccountId: string | null;
}

/** One accepted adult invitation, with both ends already resolved to accounts. */
export interface FamilyInvitationRow {
  targetSubjectId: string;
  inviterAccountId: string | null;
}

/** One live base-plus-direction grant pair, with both ends resolved to accounts. */
export interface FamilyGrantRow {
  purpose: Purpose;
  /** The account holding the data subject principal that signed the grant. */
  granterAccountId: string | null;
  /** The subject the grant is about. */
  dataSubjectId: string;
  recipientAccountId: string | null;
}

export interface FamilyGraphRows {
  viewerAccountId: string;
  subjects: readonly FamilySubjectRow[];
  invitations: readonly FamilyInvitationRow[];
  grants: readonly FamilyGrantRow[];
  /** Accounts with a current pause between them and the viewer. */
  pausedWithAccountIds: readonly string[];
}

const ACTIVE_LIFECYCLES = new Set(["active", "claimed_bound"]);

function isAdultRecord(subject: FamilySubjectRow): boolean {
  return subject.subjectClass === "self" || subject.subjectClass === "other_adult";
}

function usable(subject: FamilySubjectRow | undefined): subject is FamilySubjectRow {
  return (
    subject !== undefined &&
    isAdultRecord(subject) &&
    ACTIVE_LIFECYCLES.has(subject.lifecycle)
  );
}

/**
 * The route segment of a family handle is always `s-{uuid}`, never `me`:
 * the counterpart's self subject is "me" only in their own session, and the
 * register's `route-person-subject` names one form for this route.
 */
function toSummary(subject: FamilySubjectRow, dataSubjectId: string): SubjectSummary {
  return {
    id: subject.id,
    displayLabel: subject.displayLabel,
    subjectClass: subject.subjectClass as SubjectSummary["subjectClass"],
    lifecycle: subject.lifecycle,
    lifecycleRevision: subject.lifecycleRevision,
    routeSegment: `s-${subject.id}`,
    ownerAccountId: subject.ownerAccountId,
    subjectAccountId: subject.subjectAccountId,
    dataSubjectId,
  };
}

/**
 * The name a person is shown under. Their own self-subject label is the
 * first choice, but no screen collects a display name, so every self subject
 * is labelled "You" — a first-person placeholder that must never be printed
 * as another person's name. The record that names them ("Invited adult")
 * comes next, and a neutral class noun last.
 */
function personLabel(counterpartSelf: FamilySubjectRow, handle: FamilySubjectRow): string {
  if (counterpartSelf.displayLabel !== SELF_PLACEHOLDER_LABEL) return counterpartSelf.displayLabel;
  if (handle.displayLabel !== SELF_PLACEHOLDER_LABEL) return handle.displayLabel;
  return UNNAMED_PERSON_LABEL;
}

interface Candidate {
  counterpartAccountId: string;
  handle: FamilySubjectRow;
  origin: FamilyOrigin;
}

/**
 * The pure half of the graph: plain rows in, people out. Every branch of
 * §1.3 is decided here, so the unit suite proves the shape without a
 * database.
 */
export function buildFamilyPeople(rows: FamilyGraphRows): FamilyPerson[] {
  const viewer = rows.viewerAccountId;
  const byId = new Map<string, FamilySubjectRow>();
  const selfByAccount = new Map<string, FamilySubjectRow>();
  for (const subject of rows.subjects) {
    byId.set(subject.id, subject);
    if (
      subject.subjectClass === "self" &&
      subject.subjectAccountId &&
      ACTIVE_LIFECYCLES.has(subject.lifecycle)
    ) {
      selfByAccount.set(subject.subjectAccountId, subject);
    }
  }

  const candidates = new Map<string, Candidate>();
  const remember = (candidate: Candidate) => {
    if (candidate.counterpartAccountId === viewer) return;
    if (!candidates.has(candidate.counterpartAccountId)) {
      candidates.set(candidate.counterpartAccountId, candidate);
    }
  };

  // (a) Accepted adult invitations, from either side.
  for (const invitation of rows.invitations) {
    const target = byId.get(invitation.targetSubjectId);
    if (!usable(target)) continue;
    if (invitation.inviterAccountId === viewer) {
      // As inviter: the person is the invited record, bound to the invitee.
      if (!target.subjectAccountId) continue;
      remember({
        counterpartAccountId: target.subjectAccountId,
        handle: target,
        origin: "invited-by-me",
      });
      continue;
    }
    if (target.subjectAccountId === viewer && invitation.inviterAccountId) {
      // As invitee: the person is the inviter, held by their own self subject.
      const inviterSelf = selfByAccount.get(invitation.inviterAccountId);
      if (!usable(inviterSelf)) continue;
      remember({
        counterpartAccountId: invitation.inviterAccountId,
        handle: inviterSelf,
        origin: "invited-me",
      });
    }
  }

  // (b) Adult records this account owns (Path B). A Path B record with no
  // bound account has no counterpart account, no grant direction and no
  // permissions column, so it is not a person on these surfaces; no screen
  // creates one today.
  for (const subject of rows.subjects) {
    if (subject.subjectClass !== "other_adult") continue;
    if (subject.ownerAccountId !== viewer) continue;
    if (!usable(subject) || !subject.subjectAccountId) continue;
    remember({
      counterpartAccountId: subject.subjectAccountId,
      handle: subject,
      origin: "uploaded-by-me",
    });
  }

  // (c) Live grants in either direction, for a counterpart the two sources
  // above did not name.
  for (const grant of rows.grants) {
    const counterpart =
      grant.recipientAccountId === viewer
        ? grant.granterAccountId
        : grant.granterAccountId === viewer
          ? grant.recipientAccountId
          : null;
    if (!counterpart || counterpart === viewer || candidates.has(counterpart)) continue;
    const granted = byId.get(grant.dataSubjectId);
    const handle =
      grant.granterAccountId === counterpart && usable(granted)
        ? granted
        : selfByAccount.get(counterpart);
    if (!usable(handle)) continue;
    remember({
      counterpartAccountId: counterpart,
      handle,
      origin: handle.subjectClass === "self" ? "invited-me" : "invited-by-me",
    });
  }

  const paused = new Set(rows.pausedWithAccountIds);
  const people: FamilyPerson[] = [];
  for (const candidate of candidates.values()) {
    const counterpartSelf = selfByAccount.get(candidate.counterpartAccountId);
    // The data subject is the counterpart's own self subject; without one
    // there is nothing to read, so the person is not listed.
    if (!usable(counterpartSelf)) continue;
    const grantsToViewer = new Set<Purpose>();
    const grantsFromViewer = new Set<Purpose>();
    for (const grant of rows.grants) {
      if (
        grant.granterAccountId === candidate.counterpartAccountId &&
        grant.recipientAccountId === viewer
      ) {
        grantsToViewer.add(grant.purpose);
      }
      if (
        grant.granterAccountId === viewer &&
        grant.recipientAccountId === candidate.counterpartAccountId
      ) {
        grantsFromViewer.add(grant.purpose);
      }
    }
    people.push({
      handle: toSummary(candidate.handle, counterpartSelf.id),
      dataSubjectId: counterpartSelf.id,
      counterpartAccountId: candidate.counterpartAccountId,
      displayLabel: personLabel(counterpartSelf, candidate.handle),
      origin: candidate.origin,
      sharing: paused.has(candidate.counterpartAccountId) ? "paused" : "active",
      grantsToViewer,
      grantsFromViewer,
    });
  }

  // Ordered by name alone (X9.2: nobody is ranked); the id breaks ties so the
  // list is stable between requests.
  return people.sort(
    (left, right) =>
      left.displayLabel.localeCompare(right.displayLabel, "en") ||
      left.handle.id.localeCompare(right.handle.id),
  );
}

const SUBJECT_SEGMENT = /^s-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

/** `s-{uuid}` → the uuid; anything else is not a person segment. */
export function familySegmentId(segment: string): string | null {
  return SUBJECT_SEGMENT.exec(segment)?.[1] ?? null;
}

function unique(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

/** Reads every row the graph needs for one account, then builds the people. */
export async function readFamilyGraphRows(accountId: string): Promise<FamilyGraphRows> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const [{ data: myPrincipals }, { data: myRecords }, { data: toMe }, { data: pauses }] =
    await Promise.all([
      admin
        .from("subject_principals")
        .select("id, subject_id, account_id")
        .eq("account_id", accountId)
        .eq("principal_kind", "account_subject")
        .eq("status", "active"),
      admin
        .from("subjects")
        .select(
          "id, display_label, subject_class, lifecycle, lifecycle_revision, owner_account_id, subject_account_id",
        )
        .or(`owner_account_id.eq.${accountId},subject_account_id.eq.${accountId}`)
        .in("lifecycle", ["active", "claimed_bound"]),
      admin
        .from("directional_grants")
        .select("grant_id, grant_revision, recipient_account_id")
        .eq("status", "current")
        .eq("direction", "subject_to_recipient")
        .eq("recipient_account_id", accountId),
      admin
        .from("family_sharing_pauses")
        .select("account_low_id, account_high_id")
        .is("ended_at", null)
        .or(`account_low_id.eq.${accountId},account_high_id.eq.${accountId}`),
    ]);

  const myPrincipalIds = (myPrincipals ?? []).map((row) => row.id);

  // Grants signed by this account's principals, and the direction rows of the
  // grants that name this account as recipient. Both tables are joined on
  // grant_id AND an identical grant_revision (directional-purpose-grant-v1:
  // neither row authorises anything without the other at the same revision).
  const [{ data: fromMeBase }, { data: toMeBase }] = await Promise.all([
    myPrincipalIds.length > 0
      ? admin
          .from("purpose_grants")
          .select("grant_id, grant_revision, purpose, target_id, data_subject_principal_id, expires_at")
          .in("data_subject_principal_id", myPrincipalIds)
          .is("revoked_at", null)
          .or(`expires_at.is.null,expires_at.gt.${now}`)
      : { data: [] as never[] },
    (toMe ?? []).length > 0
      ? admin
          .from("purpose_grants")
          .select("grant_id, grant_revision, purpose, target_id, data_subject_principal_id, expires_at")
          .in("grant_id", (toMe ?? []).map((row) => row.grant_id))
          .is("revoked_at", null)
          .or(`expires_at.is.null,expires_at.gt.${now}`)
      : { data: [] as never[] },
  ]);

  const fromMeIds = (fromMeBase ?? []).map((row) => row.grant_id);
  const { data: fromMeDirections } = fromMeIds.length
    ? await admin
        .from("directional_grants")
        .select("grant_id, grant_revision, recipient_account_id")
        .in("grant_id", fromMeIds)
        .eq("status", "current")
        .eq("direction", "subject_to_recipient")
    : { data: [] as { grant_id: string; grant_revision: number; recipient_account_id: string | null }[] };

  const granterPrincipalIds = unique((toMeBase ?? []).map((row) => row.data_subject_principal_id));
  const { data: granterPrincipals } = granterPrincipalIds.length
    ? await admin
        .from("subject_principals")
        .select("id, account_id")
        .in("id", granterPrincipalIds)
    : { data: [] as { id: string; account_id: string | null }[] };
  const accountByPrincipal = new Map<string, string | null>(
    (granterPrincipals ?? []).map((row) => [row.id, row.account_id]),
  );

  const directionByGrant = new Map<string, { revision: number; recipient: string | null }>();
  for (const row of fromMeDirections ?? []) {
    directionByGrant.set(row.grant_id, {
      revision: row.grant_revision,
      recipient: row.recipient_account_id,
    });
  }
  const grants: FamilyGrantRow[] = [];
  for (const base of fromMeBase ?? []) {
    const direction = directionByGrant.get(base.grant_id);
    if (!direction || direction.revision !== base.grant_revision) continue;
    if (!isPurpose(base.purpose)) continue;
    grants.push({
      purpose: base.purpose,
      granterAccountId: accountId,
      dataSubjectId: base.target_id,
      recipientAccountId: direction.recipient,
    });
  }
  const toMeRevisions = new Map<string, number>(
    (toMe ?? []).map((row) => [row.grant_id, row.grant_revision]),
  );
  for (const base of toMeBase ?? []) {
    if (toMeRevisions.get(base.grant_id) !== base.grant_revision) continue;
    if (!isPurpose(base.purpose)) continue;
    grants.push({
      purpose: base.purpose,
      granterAccountId: accountByPrincipal.get(base.data_subject_principal_id) ?? null,
      dataSubjectId: base.target_id,
      recipientAccountId: accountId,
    });
  }

  // Accepted adult invitations: the ones this account sent, and the ones
  // whose invited record is now bound to this account.
  const myAdultRecordIds = (myRecords ?? [])
    .filter((row) => row.subject_class === "other_adult")
    .map((row) => row.id);
  const [{ data: sent }, { data: received }] = await Promise.all([
    myPrincipalIds.length > 0
      ? admin
          .from("subject_invitations")
          .select("target_id, inviter_principal_id")
          .eq("invitation_kind", "adult_subject")
          .eq("status", "accepted")
          .in("inviter_principal_id", myPrincipalIds)
      : { data: [] as { target_id: string; inviter_principal_id: string }[] },
    myAdultRecordIds.length > 0
      ? admin
          .from("subject_invitations")
          .select("target_id, inviter_principal_id")
          .eq("invitation_kind", "adult_subject")
          .eq("status", "accepted")
          .in("target_id", myAdultRecordIds)
      : { data: [] as { target_id: string; inviter_principal_id: string }[] },
  ]);

  const inviterPrincipalIds = unique((received ?? []).map((row) => row.inviter_principal_id));
  const { data: inviterPrincipals } = inviterPrincipalIds.length
    ? await admin
        .from("subject_principals")
        .select("id, account_id")
        .in("id", inviterPrincipalIds)
    : { data: [] as { id: string; account_id: string | null }[] };
  for (const row of inviterPrincipals ?? []) accountByPrincipal.set(row.id, row.account_id);

  const invitations: FamilyInvitationRow[] = [
    ...(sent ?? []).map((row) => ({
      targetSubjectId: row.target_id,
      inviterAccountId: accountId,
    })),
    ...(received ?? []).map((row) => ({
      targetSubjectId: row.target_id,
      inviterAccountId: accountByPrincipal.get(row.inviter_principal_id) ?? null,
    })),
  ];

  // Every subject the people above are built from: this account's records,
  // the invited records, the grant targets and each counterpart's self
  // subject. The invited records load first, because an invitation this
  // account sent names its counterpart only through the invited record's
  // bound account.
  const knownIds = new Set((myRecords ?? []).map((row) => row.id));
  const extraSubjectIds = unique([
    ...invitations.map((row) => row.targetSubjectId),
    ...grants.map((row) => row.dataSubjectId),
  ]).filter((id) => !knownIds.has(id));
  const { data: extraSubjects } = extraSubjectIds.length
    ? await admin
        .from("subjects")
        .select(
          "id, display_label, subject_class, lifecycle, lifecycle_revision, owner_account_id, subject_account_id",
        )
        .in("id", extraSubjectIds)
    : { data: [] as NonNullable<typeof myRecords> };

  const counterpartAccountIds = unique([
    ...invitations.map((row) => row.inviterAccountId),
    ...grants.map((row) => row.granterAccountId),
    ...grants.map((row) => row.recipientAccountId),
    ...(extraSubjects ?? []).map((row) => row.subject_account_id),
    ...(myRecords ?? []).map((row) => row.subject_account_id),
  ]).filter((id) => id !== accountId);
  const { data: counterpartSelves } = counterpartAccountIds.length
    ? await admin
        .from("subjects")
        .select(
          "id, display_label, subject_class, lifecycle, lifecycle_revision, owner_account_id, subject_account_id",
        )
        .in("subject_account_id", counterpartAccountIds)
        .eq("subject_class", "self")
        .in("lifecycle", ["active", "claimed_bound"])
    : { data: [] as NonNullable<typeof myRecords> };

  const subjects = new Map<string, FamilySubjectRow>();
  for (const row of [...(myRecords ?? []), ...(counterpartSelves ?? []), ...(extraSubjects ?? [])]) {
    subjects.set(row.id, {
      id: row.id,
      displayLabel: row.display_label,
      subjectClass: row.subject_class,
      lifecycle: row.lifecycle,
      lifecycleRevision: row.lifecycle_revision,
      ownerAccountId: row.owner_account_id,
      subjectAccountId: row.subject_account_id,
    });
  }

  const pausedWithAccountIds = (pauses ?? []).map((row) =>
    row.account_low_id === accountId ? row.account_high_id : row.account_low_id,
  );

  return {
    viewerAccountId: accountId,
    subjects: [...subjects.values()],
    invitations,
    grants,
    pausedWithAccountIds,
  };
}

/** Every adult this account may see or share with, ordered by name. */
export async function listFamilyPeople(accountId: string): Promise<FamilyPerson[]> {
  return buildFamilyPeople(await readFamilyGraphRows(accountId));
}

/**
 * One person by their route segment. An unknown, foreign or `minor` segment
 * resolves to null, which every caller answers with 404 — the same answer,
 * so nothing signals that a record exists (resource-not-found-page-v1).
 */
export async function resolveFamilyPerson(
  accountId: string,
  segment: string,
): Promise<FamilyPerson | null> {
  const id = familySegmentId(segment);
  if (!id) return null;
  const people = await listFamilyPeople(accountId);
  return people.find((person) => person.handle.id === id) ?? null;
}
