import type { Metadata } from "next";

export const metadata: Metadata = { title: "Claim a future-person record" };

export default function FuturePersonClaimPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <p className="eyebrow">Future Person Charter</p><h1 className="display mt-4 text-4xl">Claim a record created before you were born</h1>
      <section className="mt-8 space-y-4 rounded-2xl border border-line bg-card p-6">
        <h2 className="font-medium">Claims are not open yet</h2>
        <p className="text-sm leading-relaxed text-ink-muted">No embryo records can be created on the hosted service while the capability lacks human legal approval. The claim intake therefore accepts no documents or identifying information.</p>
        <p className="text-sm leading-relaxed text-ink-muted">Without the Record Key Card we cannot tell which record is yours, and we will not guess.</p>
      </section>
    </div>
  );
}
