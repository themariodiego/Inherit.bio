import { loadOwnerObjection } from "@/lib/future-person/owner-objection";
import { OwnerObjection } from "@/components/future-person/owner-objection";
import {loadAccountBinding} from "@/lib/future-person/account-binding";
import {ClaimantAccountBinding} from "@/components/future-person/account-binding";
import {loadClaimantRights} from "@/lib/future-person/rights";
import {ClaimantRights} from "@/components/future-person/claimant-rights";
import {CorrectionRequestForm} from "@/components/future-person/correction-request";
import { route } from "@/lib/primary-routes";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { loadAdultSubjectReview } from "@/lib/embryos/adult-subject-review";
import { AdultSubjectReviewForm } from "@/components/embryo/adult-subject-review-form";
import { loadCoParentReview } from "@/lib/embryos/co-parent-review";
import { CoParentReviewForm } from "@/components/embryo/co-parent-review-form";
import { EmbryoWithdrawalForm } from "@/components/embryo/embryo-withdrawal-form";
import { loadEmbryoParentWithdrawal } from "@/lib/embryos/embryo-parent-withdrawal";
import { InvitationRefusalForm, InvitationRefusalReceipt } from "@/components/embryo/invitation-refusal-form";
import { loadInvitationRefusal } from "@/lib/embryos/invitation-refusal";
import { jurisdictionChoices } from "@/lib/legal/jurisdiction-declaration";
import { loadAdultUploadRevisionReview, loadPathBRequestReview } from "@/lib/uploads/path-b-review";
import { AdultUploadRevisionForm } from "@/components/uploads/adult-upload-revision-form";
import { PathBRequestForm } from "@/components/uploads/path-b-request-form";

export const metadata: Metadata = { title: "Review your request", robots: { index: false, follow: false } };

export default async function RightsSessionPage() {
  const incoming = await headers();
  // Only the cookie header is needed. Never derive authority from URL input.
  const request = new Request("https://inherit.bio/withdraw/session", {
    headers: { cookie: incoming.get("cookie") ?? "" },
  });
  // The purpose stored on the session decides what this page is about. Each
  // loader returns null for a session that is not its own, so a co-parent
  // cookie can never reach another purpose screen.
  const ownerNotice = await loadOwnerObjection(request);
  if (ownerNotice) return <OwnerObjection summary={ownerNotice.view.safeNoticeSummary} deadline={ownerNotice.view.noticeDeadline}
    explanation={ownerNotice.view.objectionArtifactBody} csrf={ownerNotice.csrf} nonce={ownerNotice.nonce} />;
  const claimant=await loadClaimantRights(request);
  if(claimant)return <><ClaimantRights csrf={claimant.csrf} recoveryNonce={claimant.recoveryNonce} analysisNonce={claimant.analysisNonce}/>
    {claimant.correctionNonce&&<CorrectionRequestForm csrf={claimant.csrf} nonce={claimant.correctionNonce} ownStatementDownloadsEnabled/>}
    <div className="mx-auto max-w-3xl px-6 pb-16"><ClaimantAccountBinding csrf={claimant.csrf} nonce={await loadAccountBinding(request)}/></div></>;

  const pathB = await loadPathBRequestReview(request);
  if (pathB) return <PathBRequestForm review={pathB} />;
  const revision = await loadAdultUploadRevisionReview(request);
  if (revision) return <AdultUploadRevisionForm review={revision} />;
  const adult = await loadAdultSubjectReview(request);
  if (adult) return <AdultSubjectReviewForm review={adult} />;
  const embryo = await loadEmbryoParentWithdrawal(request);
  if (embryo) return <EmbryoWithdrawalForm view={embryo.view} nonce={embryo.nonce} />;
  const refusal = await loadInvitationRefusal(request);
  if (!refusal) notFound();
  if (refusal.kind === "done") return <InvitationRefusalReceipt />;
  const review = await loadCoParentReview(request);
  if (!review || review.kind === "sign-in") return (
    <section className="mx-auto max-w-6xl px-6 py-section">
      <header className="reading-head">
        <h1 className="display display-lg">Sign in to review this invitation</h1>
        <p className="lede reading-intro">Use the email address that received the invitation. Signing in does not accept it.</p>
      </header>
      <p className="mt-8">
        <Button asChild><Link href={route("auth.sign-in", { query: { next: "/withdraw/session" } })}>Sign in</Link></Button>
      </p>
      <InvitationRefusalForm nonce={refusal.nonce} />
    </section>
  );
  return <CoParentReviewForm review={review} countries={jurisdictionChoices()} refusalNonce={refusal.nonce} />;
}
