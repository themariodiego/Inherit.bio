"use client";

import { useRouter } from "next/navigation";
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
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label htmlFor="digest-toggle">Research digest emails</Label>
        <p className="text-sm text-ink-muted">
          Occasional email when new reports are published from the research
          pipeline. Off by default; contains only public report info, never
          your data.
        </p>
      </div>
      <Switch
        id="digest-toggle"
        checked={optIn}
        onCheckedChange={async (checked) => {
          const supabase = createClient();
          await supabase
            .from("profiles")
            .update({ digest_opt_in: checked })
            .eq("id", userId);
          router.refresh();
        }}
      />
    </div>
  );
}
