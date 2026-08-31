import type { Metadata } from "next";

export const metadata: Metadata = { title: "Withdraw consent" };

export default function WithdrawPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <p className="eyebrow">Rights</p><h1 className="display mt-4 text-4xl">Withdrawal link</h1>
      <section className="mt-8 rounded-2xl border border-line bg-card p-6">
        <h2 className="font-medium">This link cannot be used</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">The token is missing, expired, revoked, or not valid for this deployment. This response does not confirm whether any record exists.</p>
      </section>
    </div>
  );
}
