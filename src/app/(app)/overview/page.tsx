import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DomainSection } from "@/components/overview/domain-section";
import type { EntryBox } from "@/components/overview/entry-box";
import { formatDuration } from "@/components/overview/format";
import { MetricLine } from "@/components/overview/metric-line";
import { PeopleList, type PersonRow } from "@/components/overview/people-list";
import {
  ProcessingPanel,
  type ProcessingTiming,
} from "@/components/overview/processing-panel";
import { StartHere } from "@/components/overview/start-here";
import {
  isStarterCandidate,
  selectStarterReports,
} from "@/components/overview/starter";
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
  SPLIT,
  SPLIT_NOTE,
  STARTER,
  STATE_A_LEDE,
  STATE_C,
  STATE_E,
  VARIANT_CALL_NOTE,
  type DomainId,
  type EntryBoxCopy,
} from "@/copy/overview";
import { AIMS } from "@/lib/genome/admixture";
import { getSubjectGenotypesByRsid, templateRsids } from "@/lib/genome/load";
import { resolveTemplate, type ReportTemplate } from "@/lib/genome/reports";
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

/** Statuses between "finalised" and "annotated"; the newest one is State B. */
const STEP_FOR_STATUS: Partial<Record<FileStatus, number>> = {
  uploading: 0,
  uploaded: 0,
  parsing: 1,
  parsed: 1,
};

/** Below this many measured files the timing sentence would be a guess. */
const MIN_TIMING_SAMPLE = 20;

/** Same thresholds as the ancestry page: reliability, then "a region". */
const PANEL_SIZE = AIMS.length;
const RELIABLE_FRACTION = 0.25;
const REGION_MIN_PROPORTION = 0.02;

interface AdmixtureResult {
  proportions?: Record<string, number>;
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
        ? `/family/${targets.firstAdultSegment}`
        : "/family";
    case "family.portrait":
      // No eligible-pair resolution exists yet: the domain landing is the
      // blocking state.
      return "/family";
    case "family.copilot":
      return COPILOT_GROUP_SCOPES_AVAILABLE ? "/copilot/family" : "/family";
    case "embryos.copilot":
      return COPILOT_GROUP_SCOPES_AVAILABLE && targets.cohortId
        ? `/copilot/${targets.cohortId}`
        : "/embryos";
    default:
      return "/overview";
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
  const [self, subjects, { data: fileRows }] = await Promise.all([
    resolveSubjectForAccount(user.id, "me"),
    listSubjectsForAccount(user.id),
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
  const otherAdults = subjects.filter((s) => s.subjectClass === "other_adult");
  const embryoSubjects = subjects.filter((s) => s.subjectClass === "embryo");

  const state: OverviewState =
    embryoSubjects.length > 0
      ? "E"
      : annotated.length > 0
        ? otherAdults.length > 0
          ? "D"
          : "C"
        : inFlight
          ? "B"
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
  let ancestryLine: { value: string; note: string } | { text: string } | null =
    null;
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
      const admix = admixRow.result as unknown as AdmixtureResult;
      const markersUsed = admix.markersUsed ?? 0;
      if (markersUsed / PANEL_SIZE >= RELIABLE_FRACTION) {
        const regions = Object.values(admix.proportions ?? {}).filter(
          (share) => share >= REGION_MIN_PROPORTION,
        ).length;
        ancestryLine = {
          value: STATE_C.ancestryFound(regions),
          note: STATE_C.ancestryNote,
        };
      } else {
        ancestryLine = { text: STATE_C.ancestryTooFew };
      }
    }
  }

  // ---- State D people and State E counts ---------------------------------
  let people: PersonRow[] = [];
  if (otherAdults.length > 0) {
    const { data: rows } = await admin
      .from("subjects")
      .select("id, subject_account_id")
      .in(
        "id",
        otherAdults.map((s) => s.id),
      );
    const ownAccount = new Map(
      (rows ?? []).map((row) => [row.id, row.subject_account_id]),
    );
    people = otherAdults.map((s) => {
      const holder = ownAccount.get(s.id);
      return {
        id: s.id,
        name: s.displayLabel,
        kind: holder && holder !== user.id ? "shared" : "uploaded",
      };
    });
  }

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

  const firstAdultSegment = otherAdults[0]?.routeSegment ?? null;
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
                      value={SPLIT.estimates(estimateCount)}
                      note={SPLIT_NOTE}
                    />
                    <p className="text-sm leading-relaxed text-ink-muted">
                      {ESTIMATE_DEFINITION}
                    </p>
                  </>
                ) : null}
                {variantCallCount > 0 ? (
                  <MetricLine
                    value={SPLIT.variantCalls(variantCallCount)}
                    note={VARIANT_CALL_NOTE}
                  />
                ) : null}
                {ancestryLine && "value" in ancestryLine ? (
                  <MetricLine value={ancestryLine.value} note={ancestryLine.note} />
                ) : ancestryLine ? (
                  <p className="text-base leading-relaxed text-ink">
                    {ancestryLine.text}
                  </p>
                ) : null}
                {state === "C" || state === "D" ? (
                  <Button asChild size="lg" className="mt-5 min-h-11">
                    <Link href="/genome/me/reports">{PRIMARY.openReports}</Link>
                  </Button>
                ) : null}
              </>
            ) : (
              <p className="text-base leading-relaxed text-ink-muted">
                {ledeFor("my-genome")}
              </p>
            )
          ) : section.id === "family" ? (
            people.length > 0 ? (
              <PeopleList people={people} />
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
                <Link href="/embryos/compare">{PRIMARY.compareEmbryos}</Link>
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
                    href={`/genome/me/reports/${template.slug}`}
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
