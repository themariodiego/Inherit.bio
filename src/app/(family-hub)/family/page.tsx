import type { Metadata } from "next";
import Link from "next/link";
import { PeopleList, type PersonListEntry } from "@/components/family/people-list";
import type { PersonCardState } from "@/components/family/person-card";
import { Button } from "@/components/ui/button";
import {
  ADD_ANOTHER_ADULT_BUTTON,
  FAMILY_H1,
  FAMILY_LEDE,
  FUTURE_PERSON_BODY,
  FUTURE_PERSON_HEADING,
  FUTURE_PERSON_LINK,
  HUB_TILES,
  JURISDICTION_HEADING,
  JURISDICTION_PANEL_BODY,
  NOBODY_YET,
  NOT_DIAGNOSTIC,
  OPEN_INHERIT_BUTTON,
  WHERE_THIS_WORKS_LINK,
} from "@/copy/family/index";
import { COPILOT_GROUP_SCOPES_AVAILABLE } from "@/copy/overview";
import { hasReportGrant, permits, familyCapability } from "@/lib/family/access";
import { listFamilyPeople, type FamilyPerson } from "@/lib/family/graph";
import { resolveCapability } from "@/lib/legal/jurisdictions";
import { route } from "@/lib/primary-routes";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: FAMILY_H1 };

/**
 * `/family` — the domain landing (design §2.1; register family.index,
 * `public-or-authenticated`, surface "hub", 64rem).
 *
 * Signed out it renders the two required panels and fetches no user data.
 * Signed in it renders the hub: the people list, one primary action, the
 * three entry tiles and the not-diagnostic line, with the availability line
 * below rather than above (the sign-in state changes the chrome, never the
 * panels' precedence).
 *
 * Nothing here ranks, scores or orders people by anything but their name,
 * and no card speaks about another adult's files before a report layer is
 * live.
 */

/** The register's own sentence for the two Family capabilities, deduplicated. */
function jurisdictionCopy(): string[] {
  const copies = (["family_heritability", "family_portrait"] as const).map(
    (capability) => resolveCapability(null, capability).userFacingCopy,
  );
  return [...new Set(copies)];
}

function PublicPanels() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <p className="eyebrow">{FAMILY_H1}</p>
      <h1 className="display mt-4 text-4xl sm:text-5xl">{FAMILY_H1}</h1>
      <p className="mt-6 max-w-2xl text-base leading-relaxed text-ink-muted">{FAMILY_LEDE}</p>
      <section data-slot="jurisdiction-panel" className="mt-10 rounded-2xl border border-line bg-card p-6">
        <h2 className="font-medium">{JURISDICTION_HEADING}</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">{JURISDICTION_PANEL_BODY}</p>
        {jurisdictionCopy().map((copy) => (
          <p key={copy} className="mt-3 text-sm leading-relaxed text-ink-muted">
            {copy}
          </p>
        ))}
      </section>
      <section data-slot="future-person-panel" className="mt-6 rounded-2xl bg-tint p-6">
        <h2 className="font-medium">{FUTURE_PERSON_HEADING}</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">{FUTURE_PERSON_BODY}</p>
        <Link
          href={route("legal.future-person")}
          className="mt-3 inline-block text-sm underline underline-offset-2"
        >
          {FUTURE_PERSON_LINK}
        </Link>
      </section>
      <Button asChild variant="outline" className="mt-8">
        <Link href={route("app.overview")}>{OPEN_INHERIT_BUTTON}</Link>
      </Button>
    </div>
  );
}

/** The one state line a card may carry, chosen without leaking a file's existence. */
function cardState(person: FamilyPerson, annotatedFiles: number): PersonCardState {
  if (person.sharing === "paused") return "paused";
  if (!hasReportGrant(person)) return "waiting";
  return annotatedFiles > 0 ? "ready" : "no-file";
}

export default async function FamilyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return <PublicPanels />;

  const people = await listFamilyPeople(user.id);
  const decision = await familyCapability(
    user.id,
    people.map((person) => person.counterpartAccountId),
    "third_party_adult_analysis",
  );
  const allowed = permits(decision);

  // A file count is read only for a person whose report layer is live: with
  // no grant the card must reveal nothing about their files.
  const admin = createAdminClient();
  const readable = allowed
    ? people.filter((person) => hasReportGrant(person))
    : [];
  const annotated = new Map<string, number>();
  if (readable.length > 0) {
    const { data } = await admin
      .from("genome_files")
      .select("subject_id")
      .eq("status", "annotated")
      .in("subject_id", readable.map((person) => person.dataSubjectId));
    for (const row of data ?? []) {
      if (!row.subject_id) continue;
      annotated.set(row.subject_id, (annotated.get(row.subject_id) ?? 0) + 1);
    }
  }

  const entries: PersonListEntry[] = people.map((person) => ({
    person,
    state: allowed
      ? cardState(person, annotated.get(person.dataSubjectId) ?? 0)
      : "waiting",
    href: route("family.person", { person: person.handle.routeSegment }),
  }));

  // The first person whose reports the viewer may actually open.
  const firstReadable = allowed
    ? people.find((person) => hasReportGrant(person))
    : undefined;

  // Portrait needs a pair row; one exists only after a family.portrait grant.
  let pairId: string | null = null;
  if (allowed && people.length > 0) {
    const subjectIds = people.map((person) => person.dataSubjectId);
    const { data: selfSubject } = await admin
      .from("subjects")
      .select("id")
      .eq("subject_account_id", user.id)
      .eq("subject_class", "self")
      .eq("lifecycle", "active")
      .maybeSingle();
    if (selfSubject) {
      const { data: pairs } = await admin
        .from("family_pairs")
        .select("id, subject_a_id, subject_b_id, status")
        .in("status", ["pending", "current"])
        .or(`subject_a_id.eq.${selfSubject.id},subject_b_id.eq.${selfSubject.id}`);
      pairId =
        (pairs ?? []).find(
          (pair) =>
            subjectIds.includes(pair.subject_a_id) || subjectIds.includes(pair.subject_b_id),
        )?.id ?? null;
    }
  }

  const tileHref: Record<string, string | null> = {
    "individual-risks": firstReadable
      ? route("family.person", { person: firstReadable.handle.routeSegment })
      : null,
    portrait: pairId ? route("family.portrait", { pairId }) : null,
    // The Copilot scopes `family` and `s-{person}` do not resolve yet
    // (src/app/(app)/copilot/[scope]/page.tsx reads the viewer's own
    // subjects), so this tile states its blocking reason rather than
    // shipping a link that answers 404.
    copilot: COPILOT_GROUP_SCOPES_AVAILABLE ? route("copilot.scope", { scope: "family" }) : null,
  };

  return (
    <div
      data-density-primary-content
      data-surface="hub"
      className="mx-auto max-w-4xl space-y-12 md:space-y-16"
    >
      <header className="space-y-3">
        <h1 className="display text-4xl">{FAMILY_H1}</h1>
      </header>

      <section data-density-top-level-section className="space-y-5">
        {entries.length > 0 ? (
          <PeopleList entries={entries} viewerAccountId={user.id} />
        ) : (
          <p className="text-base leading-relaxed text-ink">{NOBODY_YET}</p>
        )}
        <Button asChild size="lg" className="min-h-11">
          <Link href={route("family.invite")}>{ADD_ANOTHER_ADULT_BUTTON}</Link>
        </Button>
      </section>

      <div className="grid gap-4 sm:grid-cols-3">
        {HUB_TILES.map((tile) => {
          const href = allowed ? tileHref[tile.id] : null;
          return (
            <section
              key={tile.id}
              data-slot="family-tile"
              data-tile={tile.id}
              className="rounded-2xl border border-line bg-card p-5"
            >
              <h2 className="font-medium">
                {href ? (
                  <Link href={href} className="underline-offset-4 hover:underline">
                    {tile.label}
                  </Link>
                ) : (
                  tile.label
                )}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{tile.description}</p>
              {href ? null : (
                <p data-slot="tile-blocked" className="mt-2 text-sm leading-relaxed text-ink">
                  {allowed ? tile.blocked : decision.userFacingCopy}
                </p>
              )}
            </section>
          );
        })}
      </div>

      <p className="text-sm leading-relaxed text-ink-muted">
        <Link
          href={route("legal.where-inherit-works")}
          className="underline underline-offset-2"
        >
          {WHERE_THIS_WORKS_LINK}
        </Link>
      </p>

      <p
        data-density-required-accuracy
        className="max-w-prose text-sm leading-relaxed text-ink-muted"
      >
        {NOT_DIAGNOSTIC}
      </p>
    </div>
  );
}
