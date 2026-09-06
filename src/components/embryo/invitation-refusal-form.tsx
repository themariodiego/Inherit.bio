"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function InvitationRefusalReceipt() {
  return <section className="mx-auto max-w-5xl px-6 py-16" role="status">
    <h1 className="display text-4xl">You have declined this invitation</h1>
    <p className="mt-5 max-w-prose">You do not need to sign in or do anything else. We will send a short notice. The cancelled draft and its evidence are queued for deletion.</p>
    <p className="mt-3 max-w-prose text-ink-muted">This does not delete your account or your own genome files.</p>
  </section>;
}

export function InvitationRefusalForm({ nonce }: { nonce: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"ready" | "pending" | "done" | "failed">("ready");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "pending") return;
    setStatus("pending");
    try {
      const response = await fetch("/api/withdraw/session", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "refuse", nonce }),
      });
      const body = await response.json();
      if (response.status !== 202 || body.status !== "accepted" || body.operation !== "refuse") {
        setStatus("failed"); return;
      }
      setStatus("done");
      router.refresh();
    } catch { setStatus("failed"); }
  }
  if (status === "done") return <p role="status">Your choice is recorded. You do not need to do anything else.</p>;
  return <form onSubmit={submit} className="mt-10 border-t border-line pt-6">
    <h2 className="text-xl font-medium">Do not want to take part?</h2>
    <p className="mt-3 max-w-prose text-ink-muted">You can decline without an account, a signature or a reason. This cancels the draft and queues its evidence for deletion. It also stops other pending invitations to this address.</p>
    <button type="submit" disabled={status === "pending"} className="mt-5 min-h-11 rounded-full border border-line px-6 py-3 text-ink disabled:opacity-60">
      {status === "pending" ? "Saving your choice…" : "Decline invitation"}
    </button>
    {status === "failed" ? <p role="alert" className="mt-3 max-w-prose">We could not confirm your choice. You can try again. If this form has expired, reload this page.</p> : null}
  </form>;
}
