"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createClient } from "@/lib/supabase/client";

export function DigestToggle({
  userId,
  optIn,
}: {
  userId: string;
  optIn: boolean;
}) {
  const router = useRouter();
  // The switch awaited a write and stayed live throughout, so a reader could
  // flip it again mid-request and had no sign the first flip was in flight.
  // Same fix and same day as the revoke control in `consent-list.tsx`.
  const [busy, setBusy] = useState(false);
  return (
    // The row inside the "Email" plate on /settings (round-3 R3): the plate is
    // the box, so the row draws none of its own.
    <div className="rec-settings-row">
      <div className="rec-settings-text">
        <Label htmlFor="digest-toggle" className="text-base">Research digest emails</Label>
        <p className="mt-1 max-w-measure text-sm text-ink-muted">
          We may email you when we add reports from new research. This is off
          by default. Emails contain public report details, never your data.
        </p>
      </div>
      <Switch
        id="digest-toggle"
        checked={optIn}
        disabled={busy}
        onCheckedChange={async (checked) => {
          setBusy(true);
          try {
            const supabase = createClient();
            await supabase
              .from("profiles")
              .update({ digest_opt_in: checked })
              .eq("id", userId);
            router.refresh();
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
