import type { Metadata } from "next";
import Link from "next/link";
import { DangerZone } from "@/components/settings/danger-zone";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Data settings" };

export default function DataSettingsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header className="space-y-2"><p className="eyebrow">Settings</p><h1 className="display text-3xl">Your data</h1></header>
      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="font-medium">Export everything</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Download your uploads, observed variants, derived results, consents,
          legal-audit slice, and stored conversations in one ZIP.
        </p>
        <Button asChild variant="outline" className="mt-4"><a href="/api/export">Download export</a></Button>
      </section>
      <DangerZone />
      <Link href="/settings" className="text-sm underline underline-offset-2">← Settings</Link>
    </div>
  );
}
