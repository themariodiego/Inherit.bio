import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Embryo Analysis" };

export default function EmbryoAnalysisPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <p className="eyebrow">Embryo Analysis</p>
      <h1 className="display mt-4 text-4xl sm:text-5xl">A bounded record, held for a future person.</h1>
      <p className="mt-6 max-w-2xl text-base leading-relaxed text-ink-muted">
        Inherit can explain supported findings on non-sex chromosomes. It does
        not rank embryos, suggest which embryo to transfer, predict sex, or
        guess when data is missing.
      </p>
      <section className="mt-10 rounded-2xl border border-line bg-card p-6">
        <h2 className="font-medium">Not available in any production jurisdiction yet</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          Embryo tools need a review by a legal expert and a list of approved
          models. Neither is ready, so these tools stay off on the hosted service.
        </p>
      </section>
      <section className="mt-6 rounded-2xl bg-tint p-6">
        <h2 className="font-medium">If a child is born from this</h2>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          The record belongs to the future person. They retain rights to know,
          not know, correct, export, restrict analysis, and delete it.
        </p>
        <Link href="/legal/future-person" className="mt-3 inline-block text-sm underline underline-offset-2">Read the Future Person Charter</Link>
      </section>
      <Button asChild variant="outline" className="mt-8"><Link href="/overview">Open Inherit</Link></Button>
    </div>
  );
}
