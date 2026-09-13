import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { route } from "@/lib/primary-routes";

export const metadata: Metadata = { title: "Review invitation", robots: { index: false, follow: false } };

/**
 * D-081(a): this page used to call `adultInvitationAvailable(token)` on a
 * plain GET, so following a mailed URL answered the question "is this token
 * still live?" — to a person, and equally to a link scanner, a mail-security
 * bot or a browser prefetching the link. The register's own
 * `tokenSecurityContract.activation` forbids exactly that:
 * `scanner-prefetch-GETs-cannot-see-burn-or-use-a-token`.
 *
 * The lookup is gone. A GET now renders the same screen whatever the token's
 * state, and `respond_adult_subject_invitation_v1` decides on the POST — which
 * it always did; the pre-check was presentational and nothing else read it.
 *
 * THE COST IS REAL AND IS THE TRADE THE CONTRACT ASKS FOR. Someone opening a
 * link that has expired or was already used now sees the actions and learns it
 * failed after choosing one, as `?result=unavailable`, rather than being told
 * first. No copy changed: that outcome and its sentence already existed for
 * the POST path.
 *
 * THIS IS ONE SURFACE OF D-081, NOT ITS CLOSURE. The raw token is still in
 * the path of this URL, in the `next=` query string of the sign-in bounce
 * below, and in the receipt redirect `api/withdraw` sends back here. Those
 * three go when the adult token moves onto the `mail-token-delivery-v1`
 * issuance model the co-parent path already uses — a migration with a
 * thirty-day overlap, because mailed tokens outlive the change.
 */

const outcomes: Record<string, { title: string; body: string }> = {
  accepted: {
    title: "Invitation accepted",
    body: "The reserved subject now belongs to your account. The inviter received no genetic-data access.",
  },
  refused: {
    title: "Invitation refused",
    body: "The reserved subject was closed. This address will not receive another invitation for this target.",
  },
  deleted: {
    title: "Reserved record deleted",
    body: "The empty reserved subject was closed. No genetic file or derived result existed for it.",
  },
  unavailable: {
    title: "This link cannot be used",
    body: "The link is missing, expired, already used, or does not match this account.",
  },
};

export default async function WithdrawPage(props: PageProps<"/withdraw/[token]">) {
  const [{ token }, searchParams] = await Promise.all([props.params, props.searchParams]);
  // The ONLY thing that decides what this page shows: a result the POST
  // redirected back with. No token state is read here.
  const outcome = typeof searchParams.result === "string" ? outcomes[searchParams.result] ?? null : null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <p className="eyebrow">Your rights</p>
      <h1 className="display mt-4 text-4xl">Review invitation</h1>
      {outcome ? (
        <section className="mt-8 rounded-2xl border border-line bg-card p-6">
          <h2 className="font-medium">{outcome.title}</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">{outcome.body}</p>
          {searchParams.result === "accepted" ? (
            <Link href={route("settings.people")} className="mt-4 inline-block text-sm underline underline-offset-2">
              Open people settings
            </Link>
          ) : null}
        </section>
      ) : (
        <section className="mt-8 space-y-5 rounded-2xl border border-line bg-card p-6">
          <div>
            <h2 className="font-medium">No genetic data has been shared</h2>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              Accepting creates a reserved subject under your account. It does
              not give the sender access, permission to upload, or permission
              to analyse your genetic data.
            </p>
          </div>
          {user ? (
            <form action="/api/withdraw" method="post">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="action" value="confirm" />
              <Button type="submit">Accept through my account</Button>
            </form>
          ) : (
            <Button asChild>
              <Link href={`/auth/sign-in?next=${encodeURIComponent(`/withdraw/${token}`)}`}>
                Sign in to accept
              </Link>
            </Button>
          )}
          <div className="flex flex-wrap gap-3 border-t border-line pt-5">
            <form action="/api/withdraw" method="post">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="action" value="refuse" />
              <Button type="submit" variant="outline">Refuse</Button>
            </form>
            <form action="/api/withdraw" method="post">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="action" value="delete" />
              <Button type="submit" variant="destructive">Delete reserved record</Button>
            </form>
          </div>
        </section>
      )}
    </div>
  );
}
