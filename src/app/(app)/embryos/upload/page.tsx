import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EmbryoUnavailable } from "@/components/embryo/states";
import { UploadFlow } from "@/components/embryo/upload/upload-flow";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { EMBRYOS_H1 } from "@/copy/embryos/index";
import { BACK_TO_EMBRYOS_LINK } from "@/copy/embryos/request-data";
import { EMBRYO_INGEST_AVAILABLE, INGEST_UNAVAILABLE_LEDE, INGEST_UNAVAILABLE_SENTENCE, UPLOAD_H1 } from "@/copy/embryos/upload";
import { permits } from "@/lib/embryos/access";
import { route } from "@/lib/primary-routes";
import { loadViewer } from "../context";

export const metadata: Metadata = { title: `${UPLOAD_H1} · ${EMBRYOS_H1}` };

/**
 * `/embryos/upload` — the five-step flow (design §2.2, §10; register
 * embryos.upload, flow, `restricted-flow`). The route is guarded by
 * `embryo_analysis` like every Embryo page: a refused jurisdiction renders
 * the register's copy and no form. Where it permits, the flow renders its
 * first two steps; while `EMBRYO_INGEST_AVAILABLE` is false the page says
 * so in one line on the inset ground above "Step 1 of 5" (before anyone
 * answers, and short enough that the first question and Continue still sit
 * in the first phone viewport), keeps the rest of that notice under the
 * step card, and the flow ends on the honest terminal rather than a control
 * that goes nowhere. No cohort row is read here: the flow persists nothing
 * until the draft route (E0) exists.
 */
export default async function EmbryoUploadPage() {
  const viewer = await loadViewer();
  if (!viewer) redirect("/auth/sign-in");
  const { decision } = viewer;

  return (
    <div data-surface="flow" className="page-stack stack-blocks max-w-3xl">
      <div className="fam-head">
        <Breadcrumbs items={[{ label: EMBRYOS_H1, href: route("embryos.index") }, { label: UPLOAD_H1 }]} />
        <header>
          <h1 className="display">{UPLOAD_H1}</h1>
        </header>
      </div>
      {!permits(decision) ? (
        <EmbryoUnavailable decision={decision} action={{ label: BACK_TO_EMBRYOS_LINK, href: route("embryos.index") }} />
      ) : (
        <div className="space-y-4">
          {EMBRYO_INGEST_AVAILABLE ? null : (
            <div role="status" data-slot="ingest-availability" className="surface-inset flex min-h-11 items-center px-4 py-2">
              <p className="max-w-measure text-base text-ink">{INGEST_UNAVAILABLE_SENTENCE}</p>
            </div>
          )}
          <UploadFlow />
          {EMBRYO_INGEST_AVAILABLE ? null : <p className="caption max-w-measure">{INGEST_UNAVAILABLE_LEDE}</p>}
        </div>
      )}
    </div>
  );
}
