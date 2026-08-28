"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DangerZone() {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3 rounded-2xl border border-danger/40 p-5">
      <h3 className="font-medium">Delete account</h3>
      <p className="text-sm text-ink-muted">
        Deletes your account, every uploaded file, every derived variant and
        result, and every chat — immediately, from both the database and
        storage. There is no grace period and no backup copy under your
        account. Export first if you want your data.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="delete-confirm">
          Type <strong>delete my genome</strong> to confirm
        </Label>
        <Input
          id="delete-confirm"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="off"
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button
        variant="destructive"
        disabled={confirm !== "delete my genome" || busy}
        data-testid="delete-account"
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch("/api/account/delete", { method: "POST" });
          if (!res.ok) {
            setError(await res.text());
            setBusy(false);
            return;
          }
          router.push("/");
          router.refresh();
        }}
      >
        Permanently delete everything
      </Button>
    </div>
  );
}
