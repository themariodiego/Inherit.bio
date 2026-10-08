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
    <div className="page-stack rec-column stack-sections">
      <header className="rec-head">
        <p className="eyebrow">Settings</p>
        <h1 className="display">Your data</h1>
      </header>
      <section className="surface surface-pad rec-stack">
        <h2 className="title">{DATA_EXPORT_HEADING}</h2>
        <p className="max-w-measure text-sm leading-relaxed text-ink-muted">{DATA_EXPORT_BODY}</p>
        <p className="max-w-measure text-sm leading-relaxed text-ink-muted">{DATA_EXPORT_LEGAL_AUDIT}</p>
        <div><Button asChild variant="outline"><a href="/api/export">{DATA_EXPORT_BUTTON}</a></Button></div>
      </section>
      <DangerZone deletion={deletion} />
      <p className="text-sm"><Link href={route("settings.index")} className="link-target quiet-link">← Settings</Link></p>
    </div>
  );
}
