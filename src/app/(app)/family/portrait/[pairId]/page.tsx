import type { Metadata } from "next";
import { CarrierInputProvenance } from "@/components/family/carrier-input-provenance";
import { loadInputSources, type InputSourceView } from "@/lib/genome/input-sources";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DeletePortrait } from "@/components/family/portrait/delete-portrait";
import { PairBar } from "@/components/family/portrait/pair-bar";
import { PortraitBanner } from "@/components/family/portrait/portrait-banner";
import { PortraitBlocking, type BlockingPerson } from "@/components/family/portrait/portrait-blocking";
import { CarrierPairCard, OneSidedCard } from "@/components/family/portrait/portrait-card";
import { RefusalsList } from "@/components/family/portrait/refusals-list";
import { TraitCard } from "@/components/family/portrait/trait-card";
import { ResultGate } from "@/components/family/result-gate";
import type { HealthPictureColumn } from "@/components/family/health-picture-table";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { SELF_PLACEHOLDER_LABEL } from "@/copy/family/index";
import {
  DATA_AND_METHODS,
  DISTINGUISHING_PRINCIPLE,
  HEADER_SENTENCE,
  NOT_DIAGNOSTIC,
  NO_CLASSIFIED_POSITIONS,
  NO_POSITIONS_BOTH_COVER,
  OUTPUTS_HEADING,
  OUTPUTS_LEDE,
  PAUSED_BODY,
  PORTRAIT_H1,
  TRAITS_LEDE,
  UNNAMED_PERSON_LABEL,
  noCarrierMatches,
  noFileYetFor,
} from "@/copy/family/portrait";
import { NAV_LABELS } from "@/copy/navigation";
import { familyCapability, permits } from "@/lib/family/access";
import {
  readCarrierConditions,
  readClassifiedVariants,
  resolveCarrierPair,
  type CarrierCondition,
  type CarrierPairSummary,
} from "@/lib/family/carrier-pair";
import { listFamilyPeople } from "@/lib/family/graph";
import { markIndependentLogin } from "@/lib/family/independent-login";
import {
  evaluateOneSided,
  evaluatePortraitPreconditions,
  geneCoverage,
  ownPortraitGrantId,
  readPortraitPairRows,
  type OneSidedReading,
  type PortraitSubjectRow,
} from "@/lib/family/portrait";
import { acknowledged } from "@/lib/family/tier2";
import { listTraitEntries } from "@/lib/family/traits";
import { getSubjectProcessedFiles } from "@/lib/genome/load";
import { route } from "@/lib/primary-routes";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * `/family/portrait/[pairId]` — Portrait (design §2.5; register
 * family.portrait, `standard`, 64rem; brief §2 §5.6, §3 §8.4, §4 §5, A.7,
 * X3.6, X10.1, G5.9).
 *
 * Order: breadcrumbs, the pair bar with both chips, the h1, the persistent
 * banner, then exactly one of: the jurisdiction's own sentence, the paused
 * sentence, the blocking screen (any precondition unmet for either person,
 * never a partial render), the one Tier-2 gate of the domain, or the page
 * proper: the header sentence, the distinguishing principle, the outputs,
 * the five trait cards, the refusals and the delete control.
 *
 * Nothing derived is read before the preconditions and the gate: the
 * blocking screen and the gate render from the pair row, the two subject
 * rows, the grants and the pause predicate alone. A file, a genotype or a
 * result is read only once both people have every step done and this
 * session has passed the gate.
 *
 * What this page never does: no polygenic estimate, no image, no ranking,
 * no sex prediction, no "0%", no relatedness quantity, no sentence about
 * one child. An X-linked match renders the refusal the side-by-side page
 * renders (D-031), never a fraction.
 */

export const metadata: Metadata = { title: PORTRAIT_H1 };

interface OutputRead {
  inputSources: { a: InputSourceView[]; b: InputSourceView[] };
  summary: CarrierPairSummary;
  conditions: readonly CarrierCondition[];
  oneSided: readonly OneSidedReading[];
  coverageOf: (gene: string) => { known: number; covered: number };
}

function columnFor(
  subject: PortraitSubjectRow,
  displayLabel: string,
): HealthPictureColumn {
  return {
    subject: {
      id: subject.id,
      displayLabel,
      subjectClass: subject.subjectClass as HealthPictureColumn["subject"]["subjectClass"],
      routeSegment: `s-${subject.id}`,
      subjectAccountId: subject.subjectAccountId,
      ownerAccountId: subject.subjectAccountId,
    },
    dataSubjectId: subject.id,
    displayLabel,
    files: null,
  };
}

export default async function FamilyPortraitPage(props: PageProps<"/family/portrait/[pairId]">) {
  const { pairId } = await props.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  // Idempotent, and a no-op from the session an invitation was accepted in:
  // a viewer who signed in on their own is stamped here as on the
  // permissions page, so their own step is not left undone by the order
  // they visited the pages in.
  await markIndependentLogin(user.id);

  const rows = await readPortraitPairRows(user.id, pairId);
  // An unknown pair, a foreign pair and an ended pair give the same answer,
  // so nothing signals that a pair exists (resource-not-found-page-v1).
  if (!rows) notFound();
  const preconditions = evaluatePortraitPreconditions(rows);
  if (preconditions.kind === "not-authorised") notFound();

  const mine = rows.a.subjectAccountId === user.id ? rows.a : rows.b;
  const other = mine === rows.a ? rows.b : rows.a;

  // The other person's name is the graph's, as everywhere else in the
  // domain; their record's own label is never printed as a name when it is
  // the first-person placeholder.
  const people = await listFamilyPeople(user.id);
  const counterpart = people.find((person) => person.dataSubjectId === other.id) ?? null;
  const otherLabel =
    counterpart?.displayLabel ??
    (other.displayLabel === SELF_PLACEHOLDER_LABEL ? UNNAMED_PERSON_LABEL : other.displayLabel);
  const labelOf = (subject: PortraitSubjectRow) =>
    subject.id === mine.id ? SELF_PLACEHOLDER_LABEL : otherLabel;
  const columns: [HealthPictureColumn, HealthPictureColumn] = [
    columnFor(rows.a, labelOf(rows.a)),
    columnFor(rows.b, labelOf(rows.b)),
  ];

  // The route guard (register family.portrait): the viewer and the other
  // account, the strictest answer (G5.1b).
  const contributors = other.subjectAccountId ? [other.subjectAccountId] : [];
  const [thirdParty, portrait, heritability, carrierMatch] = await Promise.all([
    familyCapability(user.id, contributors, "third_party_adult_analysis"),
    familyCapability(user.id, contributors, "family_portrait"),
    familyCapability(user.id, contributors, "family_heritability"),
    familyCapability(user.id, contributors, "carrier_match"),
  ]);
  const decision = permits(thirdParty) ? portrait : thirdParty;
  const allowed = permits(decision);
  // The carrier-arithmetic response guard adds two capabilities.
  const carrierDecision = !permits(heritability) ? heritability : carrierMatch;
  const carrierAllowed = allowed && permits(carrierDecision);

  const gated = allowed && preconditions.kind === "ok" && !(await acknowledged(user));
  const ready = allowed && preconditions.kind === "ok" && !gated;

  // Every read below happens only once both people have every step done
  // and this session has passed the gate.
  let noFile: string[] = [];
  let output: OutputRead | null = null;
  if (ready) {
    const admin = createAdminClient();
    const [filesA, filesB] = await Promise.all([
      getSubjectProcessedFiles(admin, rows.a.id),
      getSubjectProcessedFiles(admin, rows.b.id),
    ]);
    // The viewer's own empty state is in the second person; the other
    // person's names them. No sentence takes the first-person placeholder.
    noFile = [
      ...(filesA.length === 0 ? [noFileYetFor({ name: labelOf(rows.a), isViewer: rows.a.id === mine.id })] : []),
      ...(filesB.length === 0 ? [noFileYetFor({ name: labelOf(rows.b), isViewer: rows.b.id === mine.id })] : []),
    ];
    if (noFile.length === 0 && carrierAllowed) {
      const refVariants = await readClassifiedVariants(admin);
      const conditions = refVariants.length > 0 ? await readCarrierConditions(admin) : [];
      const summary = await resolveCarrierPair(
        admin,
        { dataSubjectId: rows.a.id, displayLabel: labelOf(rows.a) },
        { dataSubjectId: rows.b.id, displayLabel: labelOf(rows.b) },
        refVariants,
        conditions,
      );
      // The one-sided readings are decided whether or not any classified
      // position is shared: a carrier whose partner's file covers none of
      // the gene's positions is exactly the line-2238 case.
      const oneSided = evaluateOneSided({
        a: { dataSubjectId: rows.a.id, displayLabel: labelOf(rows.a), genotypes: summary.genotypes.a },
        b: { dataSubjectId: rows.b.id, displayLabel: labelOf(rows.b), genotypes: summary.genotypes.b },
        refVariants,
        conditions,
        matches: summary.matches,
      });
      output = {
        inputSources: {
          a: await loadInputSources(admin, rows.a.id, [...(summary.checkedFileIds?.a ?? []), ...(summary.runsInputFileIds?.a ?? [])]),
          b: await loadInputSources(admin, rows.b.id, [...(summary.checkedFileIds?.b ?? []), ...(summary.runsInputFileIds?.b ?? [])]),
        },
        summary,
        conditions,
        oneSided,
        coverageOf: (gene) =>
          geneCoverage(gene, refVariants, summary.genotypes.a, summary.genotypes.b),
      };
    }
  }

  const modeOf = (gene: string): string | null =>
    output?.conditions.find((condition) =>
      condition.geneSymbols.some((symbol) => symbol.trim().toLowerCase() === gene.trim().toLowerCase()),
    )?.inheritanceMode ?? null;

  const blockingPeople: [BlockingPerson, BlockingPerson] = [
    { subjectId: rows.a.id, displayLabel: labelOf(rows.a), isViewer: rows.a.id === mine.id },
    { subjectId: rows.b.id, displayLabel: labelOf(rows.b), isViewer: rows.b.id === mine.id },
  ];
  const grantId = ownPortraitGrantId(rows);
  // A gene with a one-sided reading renders that reading alone: the carrier
  // rule's refusal for the same gene (the other side's change being harmless
  // or of unknown meaning) would say "both of you have a change" about a
  // change that answers nothing for the pathogenic carrier.
  const oneSidedGenes = new Set((output?.oneSided ?? []).map((reading) => reading.gene.toLowerCase()));
  const matches = (output?.summary.matches ?? []).filter(
    (match) => !oneSidedGenes.has(match.gene.toLowerCase()),
  );
  const outputCount = output ? matches.length + output.oneSided.length : 0;

  return (
    <div data-surface="standard" className="mx-auto max-w-5xl space-y-8">
      <Breadcrumbs
        items={[
          { label: NAV_LABELS.family, href: route("family.index") },
          counterpart
            ? {
                label: otherLabel,
                href: route("family.person", { person: counterpart.handle.routeSegment }),
              }
            : { label: otherLabel },
          { label: PORTRAIT_H1 },
        ]}
      />
      <PairBar people={columns} viewerAccountId={user.id} />

      <header className="space-y-3">
        <h1 className="display text-3xl">{PORTRAIT_H1}</h1>
      </header>

      <PortraitBanner />

      {!allowed ? (
        <section role="status" className="max-w-prose space-y-3 rounded-2xl border border-line bg-card p-6">
          <p className="text-base leading-relaxed text-ink">{decision.userFacingCopy}</p>
        </section>
      ) : preconditions.kind === "paused" ? (
        <p role="status" data-state="paused" className="max-w-prose text-base leading-relaxed text-ink">
          {PAUSED_BODY}
        </p>
      ) : preconditions.kind === "missing" ? (
        <PortraitBlocking
          people={blockingPeople}
          missing={preconditions.missing}
          consentsHref={route("settings.consents")}
        />
      ) : gated ? (
        <ResultGate />
      ) : (
        <>
          <p data-slot="portrait-header-sentence" data-density-required-accuracy className="max-w-prose text-base leading-relaxed text-ink">
            {HEADER_SENTENCE}
          </p>
          <p data-slot="distinguishing-principle" className="max-w-prose text-sm leading-relaxed text-ink-muted">
            {DISTINGUISHING_PRINCIPLE}
          </p>

          <section aria-labelledby="portrait-outputs-heading" className="space-y-6">
            <h2 id="portrait-outputs-heading" className="text-lg font-semibold">
              {OUTPUTS_HEADING}
            </h2>
            <p className="max-w-prose text-sm leading-relaxed text-ink-muted">{OUTPUTS_LEDE}</p>

            {noFile.length > 0 ? (
              <div role="status" data-state="empty" className="max-w-prose space-y-2">
                {noFile.map((sentence) => (
                  <p key={sentence} className="text-base leading-relaxed text-ink">
                    {sentence}
                  </p>
                ))}
              </div>
            ) : !carrierAllowed ? (
              <p role="status" className="max-w-prose text-base leading-relaxed text-ink">
                {carrierDecision.userFacingCopy}
              </p>
            ) : output && outputCount === 0 ? (
              <p role="status" data-state={output.summary.classifiedPositions === 0 ? "unavailable" : "empty"} data-slot="portrait-empty" className="max-w-prose text-base leading-relaxed text-ink">
                {output.summary.classifiedPositions === 0
                  ? NO_CLASSIFIED_POSITIONS
                  : output.summary.positionsBothCover === 0
                    ? NO_POSITIONS_BOTH_COVER
                    : // inherit-figure-exempt: a count of positions both files cover, not a result
                      noCarrierMatches(output.summary.positionsBothCover)}
              </p>
            ) : output ? (
              <ul data-slot="portrait-outputs" className="space-y-6">
                {matches.map((match) => (
                  <li key={match.gene}>
                    <CarrierPairCard
                      id={`portrait-${match.gene.toLowerCase()}`}
                      match={match}
                      conditionMode={modeOf(match.gene)}
                      coverage={output!.coverageOf(match.gene)}
                      people={columns}
                      viewerAccountId={user.id}
                    />
                  </li>
                ))}
                {output.oneSided.map((reading) => (
                  <li key={reading.gene}>
                    <OneSidedCard reading={reading} people={columns} viewerAccountId={user.id} />
                  </li>
                ))}
              </ul>
            ) : null}

            <p className="max-w-prose text-sm leading-relaxed text-ink-muted">{TRAITS_LEDE}</p>
            <div data-slot="trait-cards" className="grid gap-4 sm:grid-cols-2">
              {listTraitEntries().map((entry) => (
                <TraitCard key={entry.key} entry={entry} />
              ))}
            </div>
          </section>

          {output ? <div data-slot="portrait-input-provenance" className="space-y-6">
            <CarrierInputProvenance summary={output.summary} sources={output.inputSources}
              subjects={{ a: { id: rows.a.id, label: labelOf(rows.a) }, b: { id: rows.b.id, label: labelOf(rows.b) } }} />
          </div> : null}
          <RefusalsList limitsHref={route("science.index")} />

          {grantId ? <DeletePortrait grantId={grantId} /> : null}

          <p data-density-required-accuracy className="max-w-prose text-sm leading-relaxed text-ink-muted">
            {NOT_DIAGNOSTIC}
          </p>
          <footer className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link href={route("genome.data", { subject: "me" })} className="underline underline-offset-2">
              {DATA_AND_METHODS}
            </Link>
          </footer>
        </>
      )}
    </div>
  );
}
