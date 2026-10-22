/**
 * /genome/[subject]/carrier — one person's own carrier status over the
 * reviewed assertion rule (owner decision of 22 October 2026, "Carrier
 * status and carrier-pair arithmetic (G7.4)"; docs/carrier-importer-design.md).
 *
 * Own `self` records only. A relative's record, a record held for another
 * adult and a Path B record all answer exactly like an unknown one: this
 * page reads the reader's own file and speaks to them as "you".
 *
 * Production today renders one sentence, the Family panel's approved
 * "This check is unavailable … This is not a negative carrier screen.",
 * because the rule admits no condition until the owner approves the starter
 * list, the release is imported through the guarded apply and a named
 * reviewer activates each condition. Under the TEST-LOCAL acceptance build a
 * synthetic release activated through the same review door reaches the
 * blocks below. The read order is in `src/lib/family/own-carrier-read.ts`.
 *
 * Report templates still never carry a carrier result: this page reads the
 * rule, never `data/templates`, and `gate:templates` keeps refusing carrier
 * status in any template (`CARRIER_BANNED_PATTERNS`).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { OwnCarrierPanel } from "@/components/results/carrier/own-carrier-panel";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { SubjectBar } from "@/components/subjects/subject-bar";
import { CARRIER_STATUS_H1, NOT_DIAGNOSTIC } from "@/copy/genome/carrier";
import { readOwnCarrierView } from "@/lib/family/own-carrier-read";
import { resolveSubjectRoute } from "@/lib/family/subject-route";
import { route } from "@/lib/primary-routes";
import { createAdminClient } from "@/lib/supabase/admin";

const loadSubject = cache((segment: string) => resolveSubjectRoute(segment, { anyOf: ["reports.monogenic"] }));

/** The account's own `self` record, or nothing: every other kind answers as unknown. */
async function ownSelf(segment: string) {
  const context = await loadSubject(segment);
  if (context.kind !== "ok" || context.person !== null || context.pathB || context.subject.subjectClass !== "self") return null;
  return context;
}

export async function generateMetadata(props: PageProps<"/genome/[subject]/carrier">): Promise<Metadata> {
  const { subject: segment } = await props.params;
  const context = await ownSelf(segment);
  return { title: context ? `${context.displayLabel} · ${CARRIER_STATUS_H1}` : CARRIER_STATUS_H1 };
}

export default async function CarrierStatusPage(props: PageProps<"/genome/[subject]/carrier">) {
  const { subject: segment } = await props.params;
  const context = await ownSelf(segment);
  if (!context) notFound();
  const { user, subject, dataSubjectId, domain } = context;
  const view = await readOwnCarrierView(createAdminClient(), dataSubjectId, user.id);
  const subjectParams = { subject: subject.routeSegment };

  return (
    <div className="page-stack stack-blocks max-w-5xl">
      <div className="fam-head">
        <Breadcrumbs
          items={[
            { label: domain.label, href: domain.href },
            { label: subject.displayLabel },
            { label: CARRIER_STATUS_H1 },
          ]}
        />
        <SubjectBar subject={subject} fileCount={view.fileCount} viewerAccountId={user.id} />
        <h1 className="display">{CARRIER_STATUS_H1}</h1>
      </div>
      <OwnCarrierPanel view={view} subjectId={dataSubjectId} reportsHref={route("genome.reports", subjectParams)} />
      <p className="caption max-w-measure">{NOT_DIAGNOSTIC}</p>
    </div>
  );
}
