import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSensitiveAccountContext } from "@/lib/account-deletion";
import { testAppealIntakeOpen } from "@/lib/future-person/appeals-open";
import { isCanonicalId } from "@/lib/future-person/review";
import { publicAppealReviewBody } from "@/lib/future-person/public-appeal-review";
import { createClient } from "@/lib/supabase/server";
import { PublicAppealReview } from "@/components/future-person/public-appeal-review";
export const metadata: Metadata = { title: "Review request", referrer: "no-referrer", robots: { index: false, follow: false } };
export default async function AppealReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
 const { id } = await params;
 if (!testAppealIntakeOpen() || !isCanonicalId(id) || Object.keys(await searchParams).length) notFound();
 if (!await getSensitiveAccountContext()) notFound();
 const result = await (await createClient()).rpc("read_public_appeal_review_v1", { p_case: id }).retry(false);
 if (result.error || !publicAppealReviewBody(result.data)) notFound();
 return <main className="mx-auto max-w-4xl px-6 py-12"><h1 className="text-3xl">Review request</h1><PublicAppealReview caseId={id} /></main>;
}
