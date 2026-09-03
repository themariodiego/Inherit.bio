import Link from "next/link";
import { Button } from "@/components/ui/button";

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
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-3">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="display text-3xl">{title}</h1>
      </header>
      <section
        role="status"
        className="space-y-4 rounded-2xl border border-line bg-card p-6"
      >
        <h2 className="font-medium">Not available in this jurisdiction yet</h2>
        <p className="text-base leading-relaxed text-ink-muted">
          Inherit needs a legal expert to review each country before this
          feature can run there. That review is missing here, so the feature
          stays off. We create no analysis or consent record.
        </p>
        {children}
        <p className="text-sm leading-relaxed text-ink-muted">
          This limit comes from how this Inherit site is set up. It says nothing
          about you or anyone else. When the law is unclear, Inherit keeps the
          feature off.
        </p>
        <Button asChild variant="outline">
          <Link href={backHref}>Go back</Link>
        </Button>
      </section>
    </div>
  );
}
