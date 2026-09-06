import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadCoParentReview } from "@/lib/embryos/co-parent-review";
import { CoParentReviewForm } from "@/components/embryo/co-parent-review-form";
import { InvitationRefusalForm, InvitationRefusalReceipt } from "@/components/embryo/invitation-refusal-form";
import { loadInvitationRefusal } from "@/lib/embryos/invitation-refusal";
import jurisdictions from "../../../../../data/jurisdictions.json";

export const metadata: Metadata = { title: "Review your request", robots: { index: false, follow: false } };

export default async function RightsSessionPage() {
  const incoming = await headers();
  // Only the cookie header is needed. Never derive authority from URL input.
  const request = new Request("https://inherit.bio/withdraw/session", {
    headers: { cookie: incoming.get("cookie") ?? "" },
  });
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
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const countries = jurisdictions.realJurisdictionCatalog.codes.map(code => ({ code, name: names.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return <CoParentReviewForm review={review} countries={countries} refusalNonce={refusal.nonce} />;
}
