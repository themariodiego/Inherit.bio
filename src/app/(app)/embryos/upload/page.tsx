import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { EmbryoUnavailable } from "@/components/embryo/states";
import { UploadFlow } from "@/components/embryo/upload/upload-flow";
import { UploadStage } from "@/components/embryo/upload/upload-stage";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { EMBRYOS_H1 } from "@/copy/embryos/index";
import { BACK_TO_EMBRYOS_LINK } from "@/copy/embryos/request-data";
import { CO_PARENT_DONE_STATUS, EMBRYO_INGEST_AVAILABLE, INGEST_UNAVAILABLE_LEDE, INGEST_UNAVAILABLE_SENTENCE, UPLOAD_H1, UPLOAD_LEFT_SENTENCE, UPLOAD_STOPPED_SENTENCE, STAGE_READ_FAILED_STATUS, SIGN_IN_AGAIN_BUTTON, SIGN_IN_AGAIN_STATUS } from "@/copy/embryos/upload";
import { permits } from "@/lib/embryos/access";
import { INITIAL_FLOW } from "@/lib/embryos/upload-flow";
import { embryoIngestBuilt, loadUploadStage } from "@/lib/embryos/upload-stage";
import { route } from "@/lib/primary-routes";
import { loadViewer } from "../context";

export const metadata: Metadata = { title: `${UPLOAD_H1} · ${EMBRYOS_H1}` };

/**
 * `/embryos/upload` keeps the five-step flow behind its jurisdiction guard
 * before any private stage read. Production shows the unavailable inset
 * above step 1 and the remaining notice below the card. TEST-LOCAL resumes
 * the server-verified stage; every mutation rechecks current authority.
 */
export default async function EmbryoUploadPage() {
  const viewer = await loadViewer();
  if (!viewer) redirect("/auth/sign-in");
  const { decision } = viewer;
  const built = permits(decision) && embryoIngestBuilt();
  const account = built ? await getSensitiveAccountContext() : null;
  if (built && (!account || account.user.id !== viewer.user.id)) redirect("/auth/sign-in");
  const view = built && account ? await loadUploadStage({ accountId: account.user.id, sessionId: account.sessionId }) : null;

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
          {built || EMBRYO_INGEST_AVAILABLE ? null : (
            <div role="status" data-slot="ingest-availability" className="surface-inset flex min-h-11 items-center px-4 py-2">
              <p className="max-w-measure text-base text-ink">{INGEST_UNAVAILABLE_SENTENCE}</p>
            </div>
          )}
          {built ? view ? view.kind === "reauthenticate" ? (<div className="space-y-3"><p role="status">{SIGN_IN_AGAIN_STATUS}</p><Link className="underline underline-offset-2" href={route("auth.sign-in", { query: { next: route("embryos.upload") } })}>{SIGN_IN_AGAIN_BUTTON}</Link></div>) : view.kind === "start" ? (
            <>
              {view.notice ? <p role="status" data-slot="upload-notice" className="max-w-prose text-sm text-ink">{
                view.notice === "co-parent-done" ? CO_PARENT_DONE_STATUS : view.notice === "upload-left" ? UPLOAD_LEFT_SENTENCE : UPLOAD_STOPPED_SENTENCE
              }</p> : null}
              <UploadFlow initial={{ ...INITIAL_FLOW, ingest: true }} draftCsrfToken={view.draftCsrfToken} />
            </>
          ) : <UploadStage view={view} /> : <p role="alert" data-slot="stage-read-failed" className="max-w-prose text-sm text-ink">{STAGE_READ_FAILED_STATUS}</p> : <UploadFlow />}
          {built || EMBRYO_INGEST_AVAILABLE ? null : <p className="caption max-w-measure">{INGEST_UNAVAILABLE_LEDE}</p>}
        </div>
      )}
    </div>
  );
}
