import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

const SUBJECT_SCOPE = /^s-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;

export type SubjectSummary = {
  id: string;
  displayLabel: string;
  subjectClass: "self" | "other_adult" | "minor" | "embryo";
  lifecycle: string;
  lifecycleRevision: number;
  routeSegment: string;
  /** The account that owns this record (null only while a claimed record is unbound). */
  ownerAccountId: string | null;
  /** The account the subject themself holds, when they have one. */
  subjectAccountId: string | null;
};

function asSubjectClass(value: string): SubjectSummary["subjectClass"] {
  if (
    value === "self" ||
    value === "other_adult" ||
    value === "minor" ||
    value === "embryo"
  ) {
    return value;
  }
  throw new Error(`Unsupported subject class: ${value}`);
}

export async function resolveSubjectForAccount(
  accountId: string,
  segment: string,
): Promise<SubjectSummary | null> {
  const admin = createAdminClient();
  let query = admin
    .from("subjects")
    .select(
      "id, display_label, subject_class, lifecycle, lifecycle_revision, owner_account_id, subject_account_id",
    )
    .in("lifecycle", ["active", "claimed_bound"]);

  if (segment === "me") {
    query = query
      .eq("subject_class", "self")
      .eq("subject_account_id", accountId);
  } else {
    const match = SUBJECT_SCOPE.exec(segment);
    if (!match) return null;
    query = query
      .eq("id", match[1])
      .or(`owner_account_id.eq.${accountId},subject_account_id.eq.${accountId}`);
  }

  const { data } = await query.maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    displayLabel: data.display_label,
    subjectClass: asSubjectClass(data.subject_class),
    lifecycle: data.lifecycle,
    lifecycleRevision: data.lifecycle_revision,
    routeSegment: data.subject_class === "self" ? "me" : `s-${data.id}`,
    ownerAccountId: data.owner_account_id,
    subjectAccountId: data.subject_account_id,
  };
}

export async function listSubjectsForAccount(
  accountId: string,
): Promise<SubjectSummary[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("subjects")
    .select(
      "id, display_label, subject_class, lifecycle, lifecycle_revision, owner_account_id, subject_account_id",
    )
    .or(`owner_account_id.eq.${accountId},subject_account_id.eq.${accountId}`)
    .in("lifecycle", ["active", "claimed_bound"])
    .order("created_at");

  return (data ?? []).map((subject) => ({
    id: subject.id,
    displayLabel: subject.display_label,
    subjectClass: asSubjectClass(subject.subject_class),
    lifecycle: subject.lifecycle,
    lifecycleRevision: subject.lifecycle_revision,
    routeSegment: subject.subject_class === "self" ? "me" : `s-${subject.id}`,
    ownerAccountId: subject.owner_account_id,
    subjectAccountId: subject.subject_account_id,
  }));
}
