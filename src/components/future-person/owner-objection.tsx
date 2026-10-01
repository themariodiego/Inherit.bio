"use client";
import { useState, type FormEvent } from "react";
import { z } from "zod";

export function OwnerObjection({ summary, deadline, explanation, csrf, nonce }: {
  summary: string; deadline: string; explanation: string; csrf: string; nonce: string;
}) {
  const [statement, setStatement] = useState("");
  const [status, setStatus] = useState<"ready" | "pending" | "done" | "failed">("ready");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (status === "pending" || status === "done") return;
    setStatus("pending");
    try {
      const response = await fetch("/api/future-person/claim/session/objection", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "X-Inherit-CSRF": csrf },
        body: JSON.stringify({ statement, nonce }),
      });
      const receipt = z.object({ status: z.literal("suspended_for_review") }).strict().safeParse(await response.json());
      if (response.status !== 202 || !receipt.success) throw new Error("unavailable");
      setStatement(""); setStatus("done");
    } catch { setStatus("failed"); }
  }
  if (status === "done") return <section className="mx-auto max-w-3xl px-6 py-16" role="status">
    <h1 className="display text-4xl">Your choice is recorded</h1>
    <p className="mt-5 max-w-prose text-ink-muted">This claim is paused while a named person reviews your objection. Your record stays as it is.</p>
  </section>;
  return <section className="mx-auto max-w-3xl px-6 py-16">
    <h1 className="display text-4xl">Review this claim</h1>
    <p className="mt-5 max-w-prose text-ink-muted">{summary}</p>
    <p className="mt-4 max-w-prose">You can object through <time dateTime={deadline}>{new Date(deadline).toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "long", timeStyle: "short" })} UTC</time>.</p>
    <p className="mt-4 max-w-prose text-ink-muted">{explanation}</p>
    <form onSubmit={submit} className="mt-8 space-y-4">
      <label htmlFor="owner-objection-statement" className="block font-medium">Why you object</label>
      <textarea id="owner-objection-statement" required minLength={20} maxLength={4000} value={statement}
        onChange={event => setStatement(event.target.value)} aria-describedby="owner-objection-help"
        className="min-h-40 w-full rounded-lg border border-line bg-paper p-3 text-ink" />
      <p id="owner-objection-help" className="max-w-prose text-ink-muted">Use 20 to 4,000 characters. A named person will read your statement. Your statement is not shown to the person making the claim.</p>
      <button type="submit" disabled={status === "pending" || [...statement.trim()].length < 20}
        className="min-h-11 rounded-full bg-forest px-6 py-3 text-on-forest disabled:opacity-60">
        {status === "pending" ? "Saving your choice…" : "Object to this claim"}
      </button>
      {status === "failed" ? <p role="alert" className="max-w-prose">We could not record your objection. Reload this page to get a fresh form if your session has ended.</p> : null}
    </form>
  </section>;
}
