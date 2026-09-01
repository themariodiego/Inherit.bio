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
          Inherit has not received the jurisdiction-specific human legal review
          required to enable this capability. It remains off, and no analysis
          or consent record is created.
        </p>
        {children}
        <p className="text-sm leading-relaxed text-ink-muted">
          This is a deployment restriction—not a result about you or anyone
          else. Inherit fails closed when legal authority is unknown.
        </p>
        <Button asChild variant="outline">
          <Link href={backHref}>Go back</Link>
        </Button>
      </section>
    </div>
  );
}
