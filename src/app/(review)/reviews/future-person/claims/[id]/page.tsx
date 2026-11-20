import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPageAccountContext } from "@/lib/page-account-context";
import { futurePersonClaimsOpen } from "@/lib/future-person/claims-open";
import { isCanonicalId, reviewCaseBody } from "@/lib/future-person/review";
import { keylessCurrentReview } from "@/lib/future-person/keyless-release";
import { createClient } from "@/lib/supabase/server";
import { ClaimReview } from "@/components/future-person/claim-review";
import { CsrfProvider } from "@/components/security/csrf-provider";
import { reviewerCsrfTokens } from "@/lib/security/session-csrf";

export const metadata: Metadata = {
  title: "Review claim", referrer: "no-referrer", robots: { index: false, follow: false },
};

/** Named reviewer authority is checked under the caller's own JWT before any UI render. */
export default async function ClaimReviewPage({params,searchParams}:{
  params:Promise<{id:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>;
}) {
  const {id}=await params;
  if(!futurePersonClaimsOpen()||!isCanonicalId(id)||Object.keys(await searchParams).length>0)notFound();
  const account=await getPageAccountContext();
  if(!account)notFound();
  const ownJwt=await createClient();
  const {data,error}=await ownJwt.rpc("read_claim_review_case_v1",{p_review_id:id});
  if(error?.code==="42501"){
    const current=await ownJwt.rpc("read_keyless_current_review_v1",{p_review:id});
    const review=current.error?null:keylessCurrentReview(current.data,id);
    if(!review||(review.scope.operation!=="claim-release"&&!review.scope.current))notFound();
  }else if(error||!reviewCaseBody(data))notFound();
  // Identity and operation material come only from the browser's fresh GET.
  return <main className="mx-auto max-w-4xl px-6 py-12">
    <h1 className="text-3xl">Review claim</h1>
    {/* The reviewer's one-time X-Inherit-CSRF tokens, one per reviewer route (G8.5). */}
    <CsrfProvider tokens={reviewerCsrfTokens(account)}><ClaimReview claimId={id}/></CsrfProvider>
  </main>;
}
