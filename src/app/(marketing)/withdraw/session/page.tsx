import {loadClaimantRights} from "@/lib/future-person/rights";
import {ClaimantRights} from "@/components/future-person/claimant-rights";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
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
  // loader returns null for a session that is not its own.
  const claimant=await loadClaimantRights(request);
  if(claimant)return <ClaimantRights csrf={claimant.csrf} recoveryNonce={claimant.recoveryNonce} analysisNonce={claimant.analysisNonce}/>;
  // Path B screens remain distinct from Path A account acceptance.
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
    <section className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="display text-4xl">Sign in to review this invitation</h1>
      <p className="mt-5 max-w-prose text-ink-muted">Use the email address that received the invitation. Signing in does not accept it.</p>
      <Link href="/auth/sign-in?next=%2Fwithdraw%2Fsession" className="mt-6 inline-block rounded-full bg-forest px-6 py-3 text-on-forest">Sign in</Link>
      <InvitationRefusalForm nonce={refusal.nonce} />
    </section>
  );
  return <CoParentReviewForm review={review} countries={jurisdictionChoices()} refusalNonce={refusal.nonce} />;
}
