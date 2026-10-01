import type { Metadata } from "next";
import Link from "next/link";
import { FuturePersonProfile } from "@/components/settings/future-person-profile";
import { identityProfileControls } from "@/lib/future-person/identity-profile-controls";
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
export default async function DataSettingsPage({searchParams}:PageProps<"/settings/data">) {
  const query=await searchParams;
  const after=typeof query.profileAfter==="string"?query.profileAfter:query.profileAfter?"invalid":null;
  const [deletion,profiles] = await Promise.all([deletionControlState(),identityProfileControls(after)]);
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
      {profiles?<section className="space-y-4 rounded-2xl border border-line bg-card p-5" aria-labelledby="matching-details-heading">
        <h2 id="matching-details-heading" className="font-medium">Birth details for your child</h2>
        <p className="text-sm leading-relaxed text-ink-muted">You can add birth details and parent names for a transferred embryo record. These details are optional. Keep the Record Key Card for your child’s later claim.</p>
        {profiles.unavailable?<p role="status" className="text-sm">Refresh this page and try again.</p>:<>
          {profiles.items.length?profiles.items.map(control=><FuturePersonProfile key={control.embryoId} control={control}/>):<p className="text-sm text-ink-muted">No record on this page has matching details you can change.</p>}
          {profiles.nextCursor?<Button asChild variant="outline"><Link href={`/settings/data?profileAfter=${profiles.nextCursor}`}>More</Link></Button>:null}
          {after?<Link href="/settings/data" className="inline-flex min-h-11 items-center text-sm underline underline-offset-2">Back to the first records</Link>:null}
        </>}
      </section>:null}
      <Link href={route("settings.index")} className="text-sm underline underline-offset-2">← Settings</Link>
    </div>
  );
}
