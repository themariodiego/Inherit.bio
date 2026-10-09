"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function InvitationRefusalReceipt() {
  return <section className="mx-auto max-w-5xl px-6 py-16" role="status">
    <h1 className="display">You have declined this invitation</h1>
    <p className="lede mt-5 text-ink">You do not need to sign in or do anything else. We will send a short notice. The cancelled draft and its evidence are queued for deletion.</p>
    <p className="mt-3 max-w-measure text-base leading-relaxed text-ink-muted">This does not delete your account or your own genome files.</p>
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
  if (status === "done") return <p role="status" className="surface-inset surface-pad-sm mt-10 max-w-measure text-base leading-relaxed text-ink">Your choice is recorded. You do not need to do anything else.</p>;
  return <form onSubmit={submit} className="mt-12 border-t border-line pt-8">
    <h2 className="title text-ink">Do not want to take part?</h2>
    <p className="mt-3 max-w-measure text-base leading-relaxed text-ink-muted">You can decline without an account, a signature or a reason. This cancels the draft and queues its evidence for deletion. It also stops other pending invitations to this address.</p>
    <div className="mt-5"><Button type="submit" variant="outline" disabled={status === "pending"}>
      {status === "pending" ? "Saving your choice…" : "Decline invitation"}
    </Button></div>
    {status === "failed" ? <p role="alert" className="mt-3 max-w-measure text-sm leading-relaxed text-ink">We could not confirm your choice. You can try again. If this form has expired, reload this page.</p> : null}
  </form>;
}
