import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { adultInvitationAvailable } from "@/lib/adult-invitations";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review invitation" };

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
  const result = typeof searchParams.result === "string" ? outcomes[searchParams.result] : null;
  const available = !result && await adultInvitationAvailable(token);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const outcome = result ?? (!available ? outcomes.unavailable : null);

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <p className="eyebrow">Your rights</p>
      <h1 className="display mt-4 text-4xl">Review invitation</h1>
      {outcome ? (
        <section className="mt-8 rounded-2xl border border-line bg-card p-6">
          <h2 className="font-medium">{outcome.title}</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">{outcome.body}</p>
          {searchParams.result === "accepted" ? (
            <Link href="/settings/people" className="mt-4 inline-block text-sm underline underline-offset-2">
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
