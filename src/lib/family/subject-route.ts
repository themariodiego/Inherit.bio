import "server-only";

import type { User } from "@supabase/supabase-js";
import { NAV_LABELS } from "@/copy/navigation";
import { route } from "@/lib/primary-routes";
import { resolveSubjectForAccount, type SubjectSummary } from "@/lib/subjects";
import { createClient } from "@/lib/supabase/server";
import type { CapabilityDecision } from "./access";
import { familyCapability, liveGrantsToViewer, permits } from "./access";
import { resolveFamilyPerson, type FamilyPerson, type Purpose } from "./graph";
import { acknowledged } from "./tier2";

/**
 * One subject-derived route, resolved for either domain (design §2.2).
 *
 * `/genome/[subject]/…` serves the account's own records and, since Family
 * shipped, another adult's shared record under the same renderer. The rules
 * that differ are all here, so no page repeats them:
 *   - a segment the account holds resolves as before, under "My Genome";
 *   - a segment that resolves through the Family graph reads its rows from
 *     the counterpart's own `self` subject, carries the Family breadcrumb,
 *     and is answered only when the jurisdiction permits it and the Tier-2
 *     gate has been passed in this session;
 *   - anything else is 404, with no signal that a record exists.
 *
 * The caller names the purposes its page could render. A record with none
 * of them live answers exactly like an unknown one, so a revoked or paused
 * relationship is a 404 rather than a gate the reader could pass to find
 * nothing; the exact purpose a page needs (one report layer, say) is checked
 * by the page once it knows which one it is rendering.
 */

export interface SubjectRouteContext {
  kind: "ok";
  user: User;
  /** The record the route names. */
  subject: SubjectSummary;
  /** The subject whose rows are read; differs only for a Family handle. */
  dataSubjectId: string;
  /** Set when the segment resolved through the Family graph. */
  person: FamilyPerson | null;
  /** The first breadcrumb: the domain this record belongs to for this viewer. */
  domain: { label: string; href: string };
  /** The name to print for this record, which is never the self placeholder. */
  displayLabel: string;
}

export type SubjectRouteResult =
  | SubjectRouteContext
  | { kind: "not-found" }
  /** The jurisdiction refuses; the page renders the register's own copy. */
  | { kind: "jurisdiction"; decision: CapabilityDecision }
  /** The Tier-2 gate is unset; the page sends the reader to the one gate. */
  | { kind: "gate"; personSegment: string };

export interface SubjectRouteOptions {
  /** At least one of these purposes must be live for a Family record. */
  anyOf?: readonly Purpose[];
}

export async function resolveSubjectRoute(
  segment: string,
  options: SubjectRouteOptions = {},
): Promise<SubjectRouteResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: "not-found" };

  const own = await resolveSubjectForAccount(user.id, segment);
  if (own) {
    return {
      kind: "ok",
      user,
      subject: own,
      dataSubjectId: own.dataSubjectId,
      person: null,
      domain: {
        label: NAV_LABELS["my-genome"],
        href: route("genome.subject", { subject: own.routeSegment }),
      },
      displayLabel: own.displayLabel,
    };
  }

  const person = await resolveFamilyPerson(user.id, segment);
  if (!person) return { kind: "not-found" };

  const decision = await familyCapability(
    user.id,
    [person.counterpartAccountId],
    "third_party_adult_analysis",
  );
  if (!permits(decision)) return { kind: "jurisdiction", decision };

  // A pause empties this set without deleting a row, so a paused
  // relationship answers like an unknown record on the very next request.
  const live = liveGrantsToViewer(person);
  if (options.anyOf && !options.anyOf.some((purpose) => live.has(purpose))) {
    return { kind: "not-found" };
  }

  // Nothing derived is read before the gate: this resolver has fetched the
  // graph and the jurisdiction only.
  if (!(await acknowledged(user))) {
    return { kind: "gate", personSegment: person.handle.routeSegment };
  }

  return {
    kind: "ok",
    user,
    subject: { ...person.handle, displayLabel: person.displayLabel },
    dataSubjectId: person.dataSubjectId,
    person,
    domain: { label: NAV_LABELS.family, href: route("family.index") },
    displayLabel: person.displayLabel,
  };
}
