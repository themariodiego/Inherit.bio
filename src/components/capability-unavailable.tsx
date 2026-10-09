import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Terrain } from "@/components/site/terrain";

export function CapabilityUnavailable({
  eyebrow,
  title,
  backHref,
  children,
}: {
  eyebrow: string;
  title: string;
  backHref: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="quiet-column mx-auto max-w-2xl">
      <div aria-hidden="true" className="quiet-band">
        <Terrain variant="band" seed={11} />
      </div>
      <header>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="display mt-4">{title}</h1>
      </header>
      <section
        role="status"
        className="surface surface-pad mt-block"
      >
        <h2 className="title">Not available in this jurisdiction yet</h2>
        <p className="body-lg mt-4 max-w-measure text-ink">
          Inherit needs a legal expert to review each country before this
          feature can run there. That review is missing here, so the feature
          stays off. We create no analysis or consent record.
        </p>
        {children}
        <p className="mt-4 max-w-measure text-ink-muted">
          This limit comes from how this Inherit site is set up. It says nothing
          about you or anyone else. When the law is unclear, Inherit keeps the
          feature off.
        </p>
        <p className="mt-6">
          <Button asChild variant="outline">
            <Link href={backHref}>Go back</Link>
          </Button>
        </p>
      </section>
    </div>
  );
}
