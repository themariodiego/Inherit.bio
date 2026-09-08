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
import { Count } from "@/components/reports/count";
import { StarterReports } from "@/components/overview/starter-reports";
import { Button } from "@/components/ui/button";
import {
  COPILOT_GROUP_SCOPES_AVAILABLE,
  DOMAIN_SECTIONS,
  ENTRY_BOXES,
  ESTIMATE_DEFINITION,
  NOT_DIAGNOSTIC,
  OVERVIEW_H1,
  PRIMARY,
  PREPARED_REPORTS,
  SPLIT_NOTE,
  SPLIT_NOTE_VARIANT_CALL,
  VARIANT_CALL_DEFINITION,
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
import { loadAncestryResultSnapshot } from "@/lib/ancestry/own-results";
import { loadOwnOverviewReports } from "@/components/overview/own-report-summary";
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
  const [ownReports, ancestry] = self ? await Promise.all([
    loadOwnOverviewReports(admin, self.id), selfFiles.length ? loadAncestryResultSnapshot(admin, supabase, self.id) : Promise.resolve(null),
  ]) : [null, null];
  let ownAncestry = ancestry?.rows.find(row => row.kind === "admixture");
  let hasAncestry = Boolean(ownAncestry);
  const hasReports = ownReports?.hasReports ?? false;
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
  const resolveState = (): OverviewState =>
    embryoSubjects.length > 0
      ? "E"
      : inFlight
        ? "B"
        : hasReports || hasAncestry
          ? familyRows.length > 0
            ? "D"
            : "C"
          : "A";
  let state = resolveState();

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

  // Public catalog counts retain their existing meaning; starter links alone
  // are personalized from exact live completed-purpose inputs.
  const { estimateCount = 0, variantCallCount = 0, starter = [], showStarter = false } = ownReports ?? {};

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

  // Confirm the same saved result after all other awaited page reads, before
  // presenting ancestry readiness or coverage from the captured content.
  ownAncestry = (await ancestry?.confirm())?.find(row => row.kind === "admixture");
  hasAncestry = Boolean(ownAncestry);
  state = resolveState();
  const needsReportChoice = !hasReports && !hasAncestry && (ownReports?.hasPreparedSource ?? false);
  const ancestryTooFew = ownAncestry
    ? ((ownAncestry.result as StoredAdmixture).markersUsed ?? 0) / AIMS.length < RELIABLE_FRACTION
    : false;

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

  return (
    <div
      data-density-primary-content
      data-surface="hub"
      className="mx-auto max-w-6xl space-y-16 md:space-y-20 lg:space-y-24"
    >
      <header className="space-y-3">
        <h1 className="display text-4xl">{OVERVIEW_H1}</h1>
        {state === "A" && !needsReportChoice ? (
          <p className="max-w-prose text-base leading-relaxed text-ink-muted">
            {STATE_A_LEDE}
          </p>
        ) : null}
      </header>

      {state === "A" && !needsReportChoice ? <StartHere /> : null}
      {state === "A" && needsReportChoice ? (
        <section aria-labelledby="prepared-reports-title" data-density-top-level-section
          className="rounded-2xl border border-line bg-card p-5 sm:p-6">
          <p id="prepared-reports-title" className="text-lg font-semibold">{PREPARED_REPORTS.title}</p>
          <p className="mt-2 max-w-prose text-sm text-ink-muted">{PREPARED_REPORTS.description}</p>
          <Button asChild size="lg" className="mt-4 min-h-11">
            <Link href={route("genome.reports", { subject: "me" })}>{PREPARED_REPORTS.action}</Link>
          </Button>
        </section>
      ) : null}
      {state === "B" && inFlight ? (
        <ProcessingPanel
          fileName={inFlight.original_name}
          currentStep={STEP_FOR_STATUS[inFlight.status] ?? 0}
          timing={timing}
        />
      ) : null}

      {DOMAIN_SECTIONS.flatMap((section) => [
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
                    <p className="text-base leading-relaxed">
                      <Count value={estimateCount} layerClass="estimate" describedBy="overview-estimate-definition" className="font-medium" />{" "}
                      <span data-metric-note className="text-ink-muted">{SPLIT_NOTE}</span>
                    </p>
                    <p id="overview-estimate-definition" className="text-sm leading-relaxed text-ink-muted">
                      {ESTIMATE_DEFINITION}
                    </p>
                  </>
                ) : null}
                {variantCallCount > 0 ? (
                  <>
                    <p className="text-base leading-relaxed">
                      <Count value={variantCallCount} layerClass="variant-call" describedBy="overview-variant-call-definition" className="font-medium" />{" "}
                      <span data-metric-note className="text-ink-muted">{SPLIT_NOTE_VARIANT_CALL}</span>
                    </p>
                    <p id="overview-variant-call-definition" className="text-sm leading-relaxed text-ink-muted">
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
            ) : hasAncestry ? (
              <div className="space-y-3">
                <h3 className="text-lg font-semibold">Your ancestry result is ready</h3>
                <p className="text-sm text-ink-muted">See the covered markers, broad regions and what remains unknown.</p>
                {ancestryTooFew ? <p className="text-base leading-relaxed text-ink">{STATE_C.ancestryTooFew}</p> : null}
                <Button asChild size="lg" className="min-h-11">
                  <Link href={route("genome.ancestry", { subject: "me" })}>View ancestry</Link>
                </Button>
              </div>
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
        </DomainSection>,
        // Keep useful own reports next to My genome, before secondary domains.
        // Nothing records which reports were opened, so no read-state is shown.
        section.id === "my-genome" && hasReports && showStarter ? (
          <StarterReports key="own-starter-reports" reports={starter} />
        ) : null,
      ])}

      <p
        data-density-required-accuracy
        className="max-w-prose text-sm leading-relaxed text-ink-muted"
      >
        {NOT_DIAGNOSTIC}
      </p>
    </div>
  );
}
