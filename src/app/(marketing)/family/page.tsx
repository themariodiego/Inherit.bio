import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Family" };

export default function FamilyPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <p className="eyebrow">Family</p>
      <h1 className="display mt-4 text-4xl sm:text-5xl">Understand shared inheritance.</h1>
      <p className="mt-6 max-w-2xl text-base leading-relaxed text-ink-muted">Family features require each adult&apos;s own account, directional consent, and a current jurisdiction-specific human legal review.</p>
      <section className="mt-10 rounded-2xl border border-line bg-card p-6">
        <h2 className="font-medium">Not available in any production jurisdiction yet</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">No real jurisdiction has the required human sign-off. Invitations, shared analysis, and inheritance portraits remain off.</p>
      </section>
      <section className="mt-6 rounded-2xl bg-tint p-6">
        <h2 className="font-medium">If a child is born from this</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">Their genetic record belongs to them. Any future use must preserve their right to know, not know, correct, export, restrict, and delete it.</p>
        <Link href="/legal/future-person" className="mt-3 inline-block text-sm underline underline-offset-2">Read the Future Person Charter</Link>
      </section>
      <Button asChild variant="outline" className="mt-8"><Link href="/overview">Open Inherit</Link></Button>
    </div>
  );
}
