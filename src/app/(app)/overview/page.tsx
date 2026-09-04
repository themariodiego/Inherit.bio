import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DomainSection } from "@/components/overview/domain-section";
import type { EntryBox } from "@/components/overview/entry-box";
import { formatDuration } from "@/components/overview/format";
import { MetricLine } from "@/components/overview/metric-line";
import { PeopleList } from "@/components/overview/people-list";
import {
  ProcessingPanel,
  type ProcessingTiming,
} from "@/components/overview/processing-panel";
import { StartHere } from "@/components/overview/start-here";
import {
  isStarterCandidate,
  selectStarterReports,
} from "@/components/overview/starter";
import { countText } from "@/components/reports/count";
import { isFixtureSlug } from "@/components/reports/library";
import { Button } from "@/components/ui/button";
import {
  COPILOT_GROUP_SCOPES_AVAILABLE,
  DOMAIN_SECTIONS,
  ENTRY_BOXES,
  ESTIMATE_DEFINITION,
  NOT_DIAGNOSTIC,
  OVERVIEW_H1,
  PRIMARY,
  SPLIT_NOTE,
  SPLIT_NOTE_VARIANT_CALL,
  VARIANT_CALL_DEFINITION,
  STARTER,
  STATE_A_LEDE,
  STATE_C,
  STATE_D,
  STATE_E,
  type DomainId,
  type EntryBoxCopy,
} from "@/copy/overview";
import { familyCapability, permits, viewerMaySee } from "@/lib/family/access";
import {
  countCarrierMatches,
  readCarrierConditions,
  readClassifiedVariants,
  resolveCarrierPair,
} from "@/lib/family/carrier-pair";
import { listFamilyPeople, type FamilyPerson } from "@/lib/family/graph";
import { acknowledged } from "@/lib/family/tier2";
import { CARRIER_MATCHES_ID } from "@/copy/family/health-picture";
import { subjectAttributes } from "@/lib/figures/contract";
import { AIMS, RELIABLE_FRACTION } from "@/lib/genome/admixture";
import { getSubjectGenotypesByRsid, templateRsids } from "@/lib/genome/load";
import { resolveTemplate, type ReportTemplate } from "@/lib/genome/reports";
import { route } from "@/lib/primary-routes";
import { listSubjectsForAccount, resolveSubjectForAccount } from "@/lib/subjects";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Overview" };

// The page is a hub (docs/route-register.json app.overview: surface "hub",
// 72rem). It informs nothing (X9.1): only counts of things the reader can
// point at, each with a unit noun and a short note; no genetic value, no
// chart, no dash placeholder. One h1 and three domain h2s — four headings.

type FileStatus = Database["public"]["Enums"]["genome_file_status"];

/** The columns Overview reads; the session client is untyped, so name them. */
interface FileRow {
  id: string;
  original_name: string;
  status: FileStatus;
  tier: number;
  subject_id: string | null;
  created_at: string;
}

/**
 * Statuses between "finalised" and "annotated": a file in any of these is in
 * flight, and the newest one puts the page in State B.
 */
const STEP_FOR_STATUS: Partial<Record<FileStatus, number>> = {
  uploading: 0,
  uploaded: 0,
  parsing: 1,
  parsed: 1,
};

/** Below this many measured files the timing sentence would be a guess. */
const MIN_TIMING_SAMPLE = 20;

/** The stored admixture JSON; only the marker count is read here. */
interface StoredAdmixture {
  markersUsed?: number;
}

type OverviewState = "A" | "B" | "C" | "D" | "E";

function resolveBoxHref(
  box: EntryBoxCopy,
  targets: { firstAdultSegment: string | null; cohortId: string | null },
): string {
  if (box.href) return box.href;
  switch (box.id) {
    case "family.individual-risks":
      return targets.firstAdultSegment
        ? route("family.person", { person: targets.firstAdultSegment })
        : route("family.index");
    case "family.portrait":
      // No eligible-pair resolution exists yet: the domain landing is the
      // blocking state.
      return route("family.index");
    case "family.copilot":
      return COPILOT_GROUP_SCOPES_AVAILABLE
        ? route("copilot.scope", { scope: "family" })
        : route("family.index");
    case "embryos.copilot":
      return COPILOT_GROUP_SCOPES_AVAILABLE && targets.cohortId
        ? route("copilot.scope", { scope: targets.cohortId })
        : route("embryos.index");
    default:
      return route("app.overview");
  }
}

function boxDomId(id: string): string {
  return `box-${id.replace(/\./g, "-")}`;
}

export default async function OverviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const admin = createAdminClient();
  const [self, subjects, family, { data: fileRows }] = await Promise.all([
    resolveSubjectForAccount(user.id, "me"),
    listSubjectsForAccount(user.id),
    // State D counts the people the Family graph resolves, not the records
    // this account holds: an accepted invitation leaves the invited record
    // bound to the invitee, so `listSubjectsForAccount` never returns it for
    // the inviter (design §1.3, §1.4).
    listFamilyPeople(user.id),
    // The user's own session (RLS) lists the files, as today's page does.
    supabase
      .from("genome_files")
      .select("id, original_name, status, tier, subject_id, created_at")
      .order("created_at", { ascending: false }),
  ]);

  const selfFiles = ((fileRows ?? []) as FileRow[]).filter(
    (file) => self != null && file.subject_id === self.id,
  );
  const annotated = selfFiles.filter((file) => file.status === "annotated");
  const inFlight = selfFiles.find((file) => STEP_FOR_STATUS[file.status] != null);
  // The people the viewer shares a Family relationship with, from either
  // side, each shown under the name the graph resolved rather than the label
  // of the record that names them.
  const familyRows = family.map((person: FamilyPerson) => ({
    ...person.handle,
    displayLabel: person.displayLabel,
  }));
  const embryoSubjects = subjects.filter((s) => s.subjectClass === "embryo");

  // E, then B, then D/C, then A: a second upload in flight is never hidden
  // behind the processed file's State C.
  const state: OverviewState =
    embryoSubjects.length > 0
      ? "E"
      : inFlight
        ? "B"
        : annotated.length > 0
          ? familyRows.length > 0
            ? "D"
            : "C"
          : "A";
  const hasReports = annotated.length > 0;

  // ---- State B: measured timing for the in-flight file's tier -------------
  let timing: ProcessingTiming | null = null;
  if (state === "B" && inFlight) {
    const { data: stats } = await admin.rpc("processing_time_stats");
    const row = stats?.find((s) => s.file_tier === inFlight.tier);
    if (
      row &&
      row.n >= MIN_TIMING_SAMPLE &&
      row.p50_seconds != null &&
      row.p95_seconds != null
    ) {
      timing = {
        p50: formatDuration(Number(row.p50_seconds)),
        p95: formatDuration(Number(row.p95_seconds)),
      };
    }
  }

  // ---- Library counts (split string) and the starter list ----------------
  let estimateCount = 0;
  let variantCallCount = 0;
  let starter: ReportTemplate[] = [];
  // The one ancestry line (D26): rendered only when an admixture result
  // exists with too few usable markers; otherwise no ancestry line at all.
  let ancestryTooFew = false;
  if (hasReports && self) {
    const { data: templateRows } = await admin
      .from("report_templates")
      .select(
        "slug, category, title, summary, evidence, variants, pgs_id, citations, layer, estimate_kind",
      )
      .eq("status", "published");
    const templates = ((templateRows ?? []) as unknown as ReportTemplate[]).filter(
      (t) => !isFixtureSlug(t.slug),
    );
    // Counted per layer, never summed (brief §4 §1.4).
    estimateCount = templates.filter((t) => (t.layer ?? "estimate") === "estimate").length;
    variantCallCount = templates.filter((t) => t.layer === "variant_call").length;

    const candidates = templates.filter(isStarterCandidate);
    const { genotypes } = await getSubjectGenotypesByRsid(
      admin,
      self.id,
      templateRsids(candidates),
    );
    starter = selectStarterReports(
      candidates.map((t) => resolveTemplate(t, (rsid) => genotypes.get(rsid))),
    );

    const { data: admixRow } = await admin
      .from("ancestry_results")
      .select("result")
      .eq("subject_id", self.id)
      .eq("kind", "admixture")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (admixRow) {
      const admix = admixRow.result as unknown as StoredAdmixture;
      ancestryTooFew = (admix.markersUsed ?? 0) / AIMS.length < RELIABLE_FRACTION;
    }
  }

  // ---- State E counts -----------------------------------------------------
  let embryoCounts: { files: number; passed: number; notMeasured: number } | null =
    null;
  let cohortId: string | null = null;
  if (embryoSubjects.length > 0) {
    const ids = embryoSubjects.map((s) => s.id);
    const [{ data: subjectRows }, { data: embryoRows }] = await Promise.all([
      admin.from("subjects").select("id, cohort_id").in("id", ids),
      admin.from("embryos").select("id").in("subject_id", ids),
    ]);
    cohortId = subjectRows?.find((row) => row.cohort_id)?.cohort_id ?? null;
    const embryoIds = (embryoRows ?? []).map((row) => row.id);
    const { data: qcRows } = embryoIds.length
      ? await admin.from("embryo_qc").select("qc_verdict").in("embryo_id", embryoIds)
      : { data: [] as { qc_verdict: string }[] };
    embryoCounts = {
      files: embryoSubjects.length,
      passed: (qcRows ?? []).filter((row) => row.qc_verdict === "pass").length,
      notMeasured: (qcRows ?? []).filter((row) => row.qc_verdict === "fail").length,
    };
  }

  // The carrier line of State D (brief §2 §3.5). It speaks about another
  // adult, so nothing is read before the domain's one Tier-2 gate has been
  // passed in this session; it renders only where a pair both carry one
  // change, and it carries the pair, never a value. Today no reference
  // position has a clinical classification, so this costs one query.
  const carrierLines: { pair: [string, string]; count: number }[] = [];
  const sharedSideBySide = family.filter(
    (person: FamilyPerson) =>
      viewerMaySee(person, "family.heritability") &&
      person.grantsFromViewer.has("family.heritability"),
  );
  if (state === "D" && self && sharedSideBySide.length > 0 && (await acknowledged(user))) {
    // The register's `family:carrier-arithmetic` needs all three to permit
    // before any row of another adult is read, exactly as the health
    // picture does (D-038).
    const contributors = sharedSideBySide.map((person: FamilyPerson) => person.counterpartAccountId);
    const decisions = await Promise.all([
      familyCapability(user.id, contributors, "third_party_adult_analysis"),
      familyCapability(user.id, contributors, "family_heritability"),
      familyCapability(user.id, contributors, "carrier_match"),
    ]);
    const allowed = decisions.every(permits);
    const refVariants = allowed ? await readClassifiedVariants(admin) : [];
    const conditions = refVariants.length > 0 ? await readCarrierConditions(admin) : [];
    for (const person of refVariants.length > 0 ? sharedSideBySide : []) {
      const summary = await resolveCarrierPair(
        admin,
        { dataSubjectId: self.id, displayLabel: self.displayLabel },
        { dataSubjectId: person.dataSubjectId, displayLabel: person.displayLabel },
        refVariants,
        conditions,
      );
      const count = countCarrierMatches(summary.matches);
      if (count > 0) carrierLines.push({ pair: [self.id, person.dataSubjectId], count });
    }
  }

  const firstAdultSegment = family[0]?.handle.routeSegment ?? null;
  const boxesFor = (domain: DomainId): EntryBox[] =>
    ENTRY_BOXES.filter((box) => box.domain === domain).map((box) => ({
      id: boxDomId(box.id),
      label: box.label,
      description: box.description,
      href: resolveBoxHref(box, { firstAdultSegment, cohortId }),
    }));
  const ledeFor = (domain: DomainId) =>
    DOMAIN_SECTIONS.find((section) => section.id === domain)!.lede;

  const starterLine =
    starter.length >= 5
      ? STARTER.five
      : starter.length > 0
        ? STARTER.some(starter.length)
        : STARTER.none;

  return (
    <div
      data-density-primary-content
      data-surface="hub"
      className="mx-auto max-w-6xl space-y-16 md:space-y-20 lg:space-y-24"
    >
      <header className="space-y-3">
        <h1 className="display text-4xl">{OVERVIEW_H1}</h1>
        {state === "A" ? (
          <p className="max-w-prose text-base leading-relaxed text-ink-muted">
            {STATE_A_LEDE}
          </p>
        ) : null}
      </header>

      {state === "A" ? <StartHere /> : null}
      {state === "B" && inFlight ? (
        <ProcessingPanel
          fileName={inFlight.original_name}
          currentStep={STEP_FOR_STATUS[inFlight.status] ?? 0}
          timing={timing}
        />
      ) : null}

      {DOMAIN_SECTIONS.map((section) => (
        <DomainSection
          key={section.id}
          id={section.id}
          heading={section.heading}
          boxes={boxesFor(section.id)}
        >
          {section.id === "my-genome" ? (
            hasReports ? (
              <>
                {estimateCount > 0 ? (
                  <>
                    <MetricLine
                      value={countText(estimateCount, "estimate")}
                      note={SPLIT_NOTE}
                    />
                    <p className="text-sm leading-relaxed text-ink-muted">
                      {ESTIMATE_DEFINITION}
                    </p>
                  </>
                ) : null}
                {variantCallCount > 0 ? (
                  <>
                    <MetricLine
                      value={countText(variantCallCount, "variant-call")}
                      note={SPLIT_NOTE_VARIANT_CALL}
                    />
                    <p className="text-sm leading-relaxed text-ink-muted">
                      {VARIANT_CALL_DEFINITION}
                    </p>
                  </>
                ) : null}
                {ancestryTooFew ? (
                  <p className="text-base leading-relaxed text-ink">
                    {STATE_C.ancestryTooFew}
                  </p>
                ) : null}
                {state === "C" || state === "D" ? (
                  <Button asChild size="lg" className="mt-5 min-h-11">
                    <Link href={route("genome.reports", { subject: "me" })}>
                      {PRIMARY.openReports}
                    </Link>
                  </Button>
                ) : null}
              </>
            ) : (
              <p className="text-base leading-relaxed text-ink-muted">
                {ledeFor("my-genome")}
              </p>
            )
          ) : section.id === "family" ? (
            familyRows.length > 0 ? (
              <>
                <PeopleList people={familyRows} viewerAccountId={user.id} />
                {carrierLines.map((line) => (
                  <p
                    key={line.pair.join(":")}
                    {...subjectAttributes({ subjectPair: line.pair })}
                    className="text-base leading-relaxed"
                  >
                    <Link
                      href={route("family.health-picture", { hash: CARRIER_MATCHES_ID })}
                      className="text-ink underline decoration-forest decoration-2 underline-offset-4 hover:text-forest"
                    >
                      {STATE_D.carrierMatches(line.count)}
                    </Link>{" "}
                    <span className="text-ink-muted">{STATE_D.carrierMeaning}</span>
                  </p>
                ))}
              </>
            ) : hasReports ? (
              <p className="text-base leading-relaxed text-ink">{STATE_C.justYou}</p>
            ) : (
              <p className="text-base leading-relaxed text-ink-muted">
                {ledeFor("family")}
              </p>
            )
          ) : embryoCounts ? (
            <>
              <MetricLine
                value={STATE_E.filesAdded(embryoCounts.files)}
                note={STATE_E.filesAddedNote}
              />
              <MetricLine
                value={STATE_E.passed(embryoCounts.passed)}
                note={STATE_E.passedNote}
              />
              <MetricLine
                value={STATE_E.notMeasured(embryoCounts.notMeasured)}
                note={STATE_E.notMeasuredNote}
              />
              <Button asChild size="lg" className="mt-5 min-h-11">
                <Link href={route("embryos.compare")}>{PRIMARY.compareEmbryos}</Link>
              </Button>
            </>
          ) : hasReports ? (
            <p className="text-base leading-relaxed text-ink">
              {STATE_C.noEmbryoFiles}
            </p>
          ) : (
            <p className="text-base leading-relaxed text-ink-muted">
              {ledeFor("embryos")}
            </p>
          )}
        </DomainSection>
      ))}

      {hasReports ? (
        // Starter reading list (§2 §7.2). "You’ve read the starter set" is
        // not rendered: nothing records which reports were opened.
        <section
          aria-labelledby="starter-title"
          data-density-top-level-section
          className="max-w-prose"
        >
          <p id="starter-title" className="text-lg font-semibold">
            {starterLine}
          </p>
          {starter.length > 0 ? (
            <ol className="mt-4 space-y-1">
              {starter.map((template) => (
                <li key={template.slug}>
                  <Link
                    href={route("genome.report", { subject: "me", slug: template.slug })}
                    className="inline-flex min-h-11 items-center text-base text-ink underline decoration-forest decoration-2 underline-offset-4 hover:text-forest"
                  >
                    {template.title}
                  </Link>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
      ) : null}

      <p
        data-density-required-accuracy
        className="max-w-prose text-sm leading-relaxed text-ink-muted"
      >
        {NOT_DIAGNOSTIC}
      </p>
    </div>
  );
}
