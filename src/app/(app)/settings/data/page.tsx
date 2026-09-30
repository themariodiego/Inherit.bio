import type { Metadata } from "next";
import Link from "next/link";
import { DangerZone } from "@/components/settings/danger-zone";
import { Button } from "@/components/ui/button";
import {
  DATA_EXPORT_BODY,
  DATA_EXPORT_BUTTON,
  DATA_EXPORT_HEADING,
  DATA_EXPORT_LEGAL_AUDIT,
} from "@/copy/settings/data-export";
import { deletionControlState } from "@/lib/account-deletion-state";
import { route } from "@/lib/primary-routes";

export const metadata: Metadata = { title: "Data settings" };

/** Brief X1.5: the deletion nonce is rendered here, after a read-only check. */
export default async function DataSettingsPage() {
  const deletion = await deletionControlState();
  return (
    <div className="page-stack mx-auto max-w-2xl space-y-8">
      <header className="space-y-2"><p className="eyebrow">Settings</p><h1 className="display text-3xl">Your data</h1></header>
      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="font-medium">{DATA_EXPORT_HEADING}</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{DATA_EXPORT_BODY}</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">{DATA_EXPORT_LEGAL_AUDIT}</p>
        <Button asChild variant="outline" className="mt-4"><a href="/api/export">{DATA_EXPORT_BUTTON}</a></Button>
      </section>
      <DangerZone deletion={deletion} />
      <Link href={route("settings.index")} className="text-sm underline underline-offset-2">← Settings</Link>
    </div>
  );
}
