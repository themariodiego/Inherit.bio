import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { QcTable } from "@/components/embryo/compare/qc-table";
import { StandingStatement } from "@/components/embryo/compare/standing-statement";
import { FindingsSection } from "@/components/embryo/detail/findings-section";
import { QcBlock } from "@/components/embryo/detail/qc-block";
import { formatDate } from "@/components/embryo/format";
import { EmbryoResultGate } from "@/components/embryo/result-gate";
import { BlockingState, EmbryoErrorState, EmbryoUnavailable } from "@/components/embryo/states";
import { ReportSkeleton } from "@/components/reports/report-skeleton";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { SubjectBar } from "@/components/subjects/subject-bar";
import { READ_FAILED_HEADING, READ_FAILED_SENTENCE, REGISTRY_EMPTY_SENTENCE, SHAPE_BLOCKED_HEADING, SHAPE_BLOCKED_SENTENCE } from "@/copy/embryos/compare";
import {
  DETAIL_SECTION_LABEL,
  FILE_NOT_ADDED_SENTENCE,
  NOTHING_SETS_APART,
  NOT_ABOUT_ANY_CHILD,
  PROVENANCE_LINE_EMBRYO,
  WHAT_THIS_DOESNT_MEAN_NOT_COVERED,
} from "@/copy/embryos/detail";
import { EMBRYOS_H1, ROLE_OTHER_PARENT, STILL_CHECKING_STATUS, waitingForResultsBody, waitingRole } from "@/copy/embryos/index";
import { FULL_QC_TABLE_SUMMARY, qcRunOn } from "@/copy/embryos/qc";
import { BACK_TO_EMBRYOS_LINK } from "@/copy/embryos/request-data";
import {
  EMBRYO_ANALYSIS,
  analysisConsent,
  cohortCapability,
  permits,
  resolveResultSurfaceState,
} from "@/lib/embryos/access";
import { allowedConditions } from "@/lib/embryos/allowed-conditions";
import { EmbryoReadError, rowsOrThrow, selectEmbryo } from "@/lib/embryos/cohorts";
import { EmbryoShapeError, type RscEmbryoDetail } from "@/lib/embryos/policy";
import { projectDetail, type EmbryoQcRow, type EmbryoScoreRow } from "@/lib/embryos/projection";
import { acknowledged } from "@/lib/embryos/tier2";
import { route } from "@/lib/primary-routes";
import { createAdminClient } from "@/lib/supabase/admin";
import { acknowledgeEmbryoGate } from "../acknowledge";
import { loadCohorts, loadViewer } from "../context";

/**
 * `/embryos/[embryoId]` — one embryo's page (design §2.3; register
 * embryos.detail, standard). Fixed order: breadcrumbs, the subject bar with
 * the chip "Embryo" and no file count, the h1 (the display label), then the
 * states of §1.4 or, once the one Tier-2 gate is passed, the report skeleton
 * in its embryo variant applied to the embryo's closed projection.
 *
 * An unknown, unpublished, restricted or foreign embryo answers 404 with no
 * existence signal. While the gate is unset nothing derived is read.
 */

const loadEmbryo = cache(async (embryoId: string) => {
  const viewer = await loadViewer();
  if (!viewer) return null;
  if (!permits(viewer.decision)) return { ...viewer, found: null };
  const cohorts = await loadCohorts(viewer.user.id);
  return { ...viewer, found: selectEmbryo(cohorts, embryoId) };
});

export async function generateMetadata(props: PageProps<"/embryos/[embryoId]">): Promise<Metadata> {
  const { embryoId } = await props.params;
  const context = await loadEmbryo(embryoId);
  const label = context?.found?.embryo.displayLabel;
  return { title: label ? `${label} · ${DETAIL_SECTION_LABEL}` : DETAIL_SECTION_LABEL };
}

async function loadDetail(input: {
  embryo: { id: string; cohortId: string; sampleOrdinal: number; displayLabel: string; status: RscEmbryoDetail["status"] };
}): Promise<RscEmbryoDetail | null> {
  const admin = createAdminClient();
  const registered = new Set(allowedConditions().map((entry) => entry.condition_id));
  const [qcResult, scoreResult] = await Promise.all([
    admin.from("embryo_qc").select("*").eq("embryo_id", input.embryo.id).maybeSingle(),
    registered.size > 0
      ? admin
          .from("embryo_scores")
          .select("embryo_id, condition_id, condition_name, finding, evidence_label, coverage_state, citation_ids, not_covered_reason")
          .eq("embryo_id", input.embryo.id)
          .in("condition_id", [...registered])
      : { data: [] as never[], error: null },
  ]);
  // A failed read is the error state, never "Still checking the files" (R11).
  if (qcResult.error) throw new EmbryoReadError("embryo_qc", qcResult.error.message);
  const qc = qcResult.data;
  const scoreRows = rowsOrThrow("embryo_scores", scoreResult);
  if (!qc) return null;
  return projectDetail({
    embryo: {
      id: input.embryo.id,
      cohort_id: input.embryo.cohortId,
      sample_ordinal: input.embryo.sampleOrdinal,
      display_label: input.embryo.displayLabel,
      status: input.embryo.status,
    },
    qc: qc as unknown as EmbryoQcRow,
    scores: scoreRows as unknown as EmbryoScoreRow[],
    registeredConditionIds: registered,
  });
}

export default async function EmbryoDetailPage(props: PageProps<"/embryos/[embryoId]">) {
  const { embryoId } = await props.params;
  const context = await loadEmbryo(embryoId);
  if (!context) redirect("/auth/sign-in");
  const { user, decision } = context;

  if (!permits(decision)) {
    // The route guard refuses before any cohort row is read, so the page
    // cannot name the embryo; it renders the register's copy under the
    // domain heading.
    return (
      <div data-surface="standard" className="mx-auto max-w-4xl space-y-8">
        <Breadcrumbs items={[{ label: EMBRYOS_H1, href: route("embryos.index") }, { label: DETAIL_SECTION_LABEL }]} />
        <header className="space-y-3">
          <h1 className="display text-3xl">{DETAIL_SECTION_LABEL}</h1>
        </header>
        <EmbryoUnavailable decision={decision} action={{ label: BACK_TO_EMBRYOS_LINK, href: route("embryos.index") }} />
      </div>
    );
  }

  // A minor, adult or self segment, an unknown, unpublished, restricted or
  // foreign embryo all give the same answer, so nothing signals a record.
  if (!context.found) notFound();
  const { cohort, embryo } = context.found;

  const cohortDecision = await cohortCapability(user.id, cohort, EMBRYO_ANALYSIS);
  const state = resolveResultSurfaceState({
    decision: cohortDecision,
    cohort,
    embryoStatus: embryo.status,
    acknowledged: await acknowledged(user),
  });

  const subject = {
    id: embryo.subjectId,
    displayLabel: embryo.displayLabel,
    subjectClass: "embryo" as const,
    routeSegment: `s-${embryo.subjectId}`,
    ownerAccountId: null,
    subjectAccountId: null,
  };

  let body: React.ReactNode;
  let detail: RscEmbryoDetail | null = null;
  switch (state) {
    case "jurisdiction-unavailable":
      body = <EmbryoUnavailable decision={cohortDecision} action={{ label: BACK_TO_EMBRYOS_LINK, href: route("embryos.index") }} />;
      break;
    case "empty":
      body = <BlockingState state="empty">{FILE_NOT_ADDED_SENTENCE}</BlockingState>;
      break;
    case "processing":
      body = <BlockingState state="processing">{STILL_CHECKING_STATUS}</BlockingState>;
      break;
    case "consent-required":
      body = (
        <BlockingState state="consent-required">
          {waitingForResultsBody(waitingRole(analysisConsent(cohort)) ?? ROLE_OTHER_PARENT)}
        </BlockingState>
      );
      break;
    case "gated":
      body = <EmbryoResultGate action={acknowledgeEmbryoGate} />;
      break;
    case "complete": {
      try {
        detail = await loadDetail({
          embryo: {
            id: embryo.id,
            cohortId: cohort.id,
            sampleOrdinal: embryo.sampleOrdinal,
            displayLabel: embryo.displayLabel,
            status: embryo.status,
          },
        });
      } catch (error) {
        if (error instanceof EmbryoReadError) {
          console.error("embryo.read-failed", { route: "embryos.detail", table: error.table });
          body = (
            <EmbryoErrorState heading={READ_FAILED_HEADING} action={{ label: BACK_TO_EMBRYOS_LINK, href: route("embryos.index") }}>
              {READ_FAILED_SENTENCE}
            </EmbryoErrorState>
          );
          break;
        }
        if (!(error instanceof EmbryoShapeError)) throw error;
        console.error("feature.blocked", { route: "embryos.detail", shape: error.shape, path: error.path });
        body = (
          <EmbryoErrorState heading={SHAPE_BLOCKED_HEADING} action={{ label: BACK_TO_EMBRYOS_LINK, href: route("embryos.index") }}>
            {SHAPE_BLOCKED_SENTENCE}
          </EmbryoErrorState>
        );
        break;
      }
      if (!detail) {
        body = <BlockingState state="processing">{STILL_CHECKING_STATUS}</BlockingState>;
        break;
      }
      const notCovered = detail.findings.some((finding) => finding.coverage_state === "not_covered");
      const column = { id: detail.id, sample_ordinal: detail.sample_ordinal, display_label: detail.display_label, status: detail.status, qc: detail.qc };
      body = (
        <article data-density-primary-content>
          <ReportSkeleton
            variant="embryo"
            whatThisIs={
              <>
                <StandingStatement />
                <p className="max-w-prose text-sm leading-relaxed text-ink">{PROVENANCE_LINE_EMBRYO}</p>
              </>
            }
            yourResult={<FindingsSection findings={detail.findings} subjectId={embryo.subjectId} />}
            whatThisDoesntMean={
              <ul className="max-w-prose list-disc space-y-1 pl-5 text-base leading-relaxed text-ink">
                <li>{NOT_ABOUT_ANY_CHILD}</li>
                {notCovered ? <li>{WHAT_THIS_DOESNT_MEAN_NOT_COVERED}</li> : null}
              </ul>
            }
            howSureWeAre={
              <>
                <QcBlock qc={detail.qc} embryoId={detail.id} subjectId={embryo.subjectId} />
                <details data-slot="qc-detail" className="text-sm">
                  <summary className="cursor-pointer text-ink-muted">{FULL_QC_TABLE_SUMMARY}</summary>
                  <div className="mt-3">
                    <QcTable embryos={[column]} subjectIds={new Map([[detail.id, embryo.subjectId]])} />
                  </div>
                </details>
              </>
            }
            whatYouCanDo={
              <p data-slot="no-action" className="max-w-prose text-base leading-relaxed text-ink">
                {NOTHING_SETS_APART}
              </p>
            }
            whereThisComesFrom={
              <>
                <p className="max-w-prose text-sm leading-relaxed text-ink">{PROVENANCE_LINE_EMBRYO}</p>
                <p data-slot="registry-status" className="max-w-prose text-sm leading-relaxed text-ink">
                  {REGISTRY_EMPTY_SENTENCE}
                </p>
                {/* inherit-figure-exempt: the date the quality check ran is UI chrome */}
                <p className="max-w-prose text-sm leading-relaxed text-ink-muted">{qcRunOn(formatDate(detail.qc.computed_at))}</p>
              </>
            }
          />
        </article>
      );
      break;
    }
  }

  return (
    <div data-surface="standard" className="mx-auto max-w-4xl space-y-8">
      <Breadcrumbs items={[{ label: EMBRYOS_H1, href: route("embryos.index") }, { label: embryo.displayLabel }]} />
      <SubjectBar subject={subject} fileCount={null} viewerAccountId={user.id} />
      <header className="space-y-3">
        <h1 className="display text-3xl">{embryo.displayLabel}</h1>
      </header>
      {body}
    </div>
  );
}
