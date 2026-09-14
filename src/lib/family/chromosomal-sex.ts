import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * The one home of `subject_demographics.chromosomal_sex` in this codebase
 * (D-031). Every read of the column goes through `readDeclaredChromosomalSex`
 * and every write through `POST /api/chromosomal-sex`, so the whole surface of
 * a sensitive declared attribute is two functions wide and can be reviewed as
 * one thing.
 *
 * DECLARED, NEVER DERIVED. Inherit holds X and Y coverage for many files and
 * does not look at it. ADR 0003 forbids imputing a value Inherit did not read;
 * a guess from coverage is also simply wrong for people whose sex chromosomes
 * are not XX or XY, and being told your own chromosomes by a piece of software
 * that inferred them is not something this product does. The value comes from
 * the person.
 *
 * WHAT IT IS FOR. One thing: choosing which Mendelian cross an X-linked
 * carrier pair follows, because the hundred-pregnancy split depends on which
 * parent carries the change on the X (brief line 346). It is read at the
 * moment a cross is computed and is never written into a result —
 * `portrait_results` refuses a `sex` key by check constraint, and that
 * constraint is deliberately left in place.
 */

type Db = SupabaseClient<Database>;

/** The four values the column's check constraint allows, plus "not recorded". */
export const CHROMOSOMAL_SEX_VALUES = ["XX", "XY", "other", "unknown"] as const;

export type ChromosomalSexValue = (typeof CHROMOSOMAL_SEX_VALUES)[number];

/** What Inherit holds for one person: a declared value, or nothing at all. */
export type DeclaredChromosomalSex = ChromosomalSexValue | null;

export function isChromosomalSexValue(value: unknown): value is ChromosomalSexValue {
  return (
    typeof value === "string" &&
    (CHROMOSOMAL_SEX_VALUES as readonly string[]).includes(value)
  );
}

/**
 * The `chromosomalSex` of an `own_chromosomal_sex_v1` payload, or null for
 * anything else. The page reads its own declaration through a function that
 * refuses to believe a shape it did not expect, rather than casting.
 */
export function declaredChromosomalSexFrom(payload: unknown): ChromosomalSexValue | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as { chromosomalSex?: unknown }).chromosomalSex;
  return isChromosomalSexValue(value) ? value : null;
}

/**
 * The declaration each of the named subjects has on record, or null where
 * there is none. The caller is responsible for having established authority
 * over the subjects it asks about; this function is the same admin-client read
 * the carrier pipeline already performs for genotypes, made once for the pair
 * the viewer's live grants authorise, and never for anyone else.
 *
 * A read failure returns null for every subject rather than throwing, so a
 * database fault degrades to the honest "not recorded" answer instead of
 * taking the page down.
 */
export async function readDeclaredChromosomalSex(
  admin: Db,
  subjectIds: readonly string[],
): Promise<Map<string, DeclaredChromosomalSex>> {
  const declared = new Map<string, DeclaredChromosomalSex>();
  for (const id of subjectIds) declared.set(id, null);
  if (subjectIds.length === 0) return declared;
  const { data, error } = await admin
    .from("subject_demographics")
    .select("subject_id, chromosomal_sex")
    .in("subject_id", [...subjectIds]);
  if (error) return declared;
  for (const row of data ?? []) {
    declared.set(row.subject_id, isChromosomalSexValue(row.chromosomal_sex) ? row.chromosomal_sex : null);
  }
  return declared;
}

/** Why a pair cannot be given an X-linked split, in the rule's own words. */
export type XLinkedRefusal = "sex-unknown" | "sex-pattern-unsupported";

/**
 * Which of the two people contributes two X copies and which contributes one X
 * and one Y, for `xLinkedCross(mother, father)`.
 *
 * `other` is a recorded answer, not a missing one, and it is kept apart from
 * "not recorded" on purpose: the hundred-pregnancy split Inherit computes is
 * derived for one XX and one XY parent, and saying so is honest where quietly
 * treating XXY as XY would not be. Two people who recorded the same pattern
 * get the same answer for the same reason.
 */
export function xLinkedRoles(
  a: { dataSubjectId: string; chromosomalSex: DeclaredChromosomalSex },
  b: { dataSubjectId: string; chromosomalSex: DeclaredChromosomalSex },
): { mother: string; father: string } | { refusal: XLinkedRefusal } {
  const recorded = [a, b].map((person) => person.chromosomalSex);
  if (recorded.some((value) => value === null || value === "unknown")) {
    return { refusal: "sex-unknown" };
  }
  const xx = [a, b].filter((person) => person.chromosomalSex === "XX");
  const xy = [a, b].filter((person) => person.chromosomalSex === "XY");
  if (xx.length !== 1 || xy.length !== 1) return { refusal: "sex-pattern-unsupported" };
  return { mother: xx[0].dataSubjectId, father: xy[0].dataSubjectId };
}
