import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { route } from "@/lib/primary-routes";

export const metadata: Metadata = { title: "Embryo Analysis" };

export default function EmbryoAnalysisPage() {
  return (
    <div className="mx-auto max-w-6xl px-6 py-section">
      <header className="reading-head">
        <p className="eyebrow">Embryo Analysis</p>
        <h1 className="display display-lg">A bounded record, held for a future person.</h1>
        <p className="lede reading-intro">
          Inherit can explain supported findings on non-sex chromosomes. It does
          not rank embryos, suggest which embryo to transfer, predict sex, or
          guess when data is missing.
        </p>
      </header>
      <div className="mt-section max-w-3xl stack-blocks">
        <section className="surface surface-pad">
          <h2 className="title">Not available in any production jurisdiction yet</h2>
          <div className="legal-prose mt-4">
            <p>
              Embryo tools need a review by a legal expert and a list of approved
              conditions. Neither is ready, so these tools stay off on the hosted service.
            </p>
            <p>
              Embryo scores that add up many small effects are for research only.
              Inherit will not offer them as a service.
            </p>
          </div>
        </section>
        <section className="surface-tint surface-pad">
          <h2 className="title">If a child is born from this</h2>
          <p className="mt-4 max-w-measure text-ink">
            The record belongs to the future person. They retain rights to know,
            not know, correct, export, restrict analysis, and delete it.
          </p>
          <p className="mt-2">
            <Link href={route("legal.future-person")} className="link-target quiet-link text-sm">Read the Future Person Charter</Link>
          </p>
        </section>
        <p>
          <Button asChild variant="outline"><Link href={route("app.overview")}>Open Inherit</Link></Button>
        </p>
      </div>
    </div>
  );
}
