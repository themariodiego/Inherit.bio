"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { providerDisplayName } from "@/lib/llm";

export function ConsentList({
  grants,
}: {
  grants: {
    id: string;
    provider_key: string;
    data_classes: string[];
    granted_at: string;
    revoked_at: string | null;
  }[];
}) {
  const router = useRouter();
  /**
   * The grant currently being revoked, or null. Held per row rather than as
   * one flag, because revoking one provider is no reason to freeze another.
   *
   * Added 2026-09-12: this button posted a revocation and changed nothing
   * until the refresh landed under the reader, so a person withdrawing a
   * consent had no acknowledgement that anything had happened and could press
   * it again meanwhile. Every comparable control in the product — auth,
   * permissions, invitations, deletion, Copilot settings — shows a pending
   * state; this one was the exception. "Working…" is the word the auth forms
   * already use, so a reader meets one vocabulary rather than two.
   */
  const [revoking, setRevoking] = useState<string | null>(null);

  if (grants.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No cloud-LLM consent grants. None are needed for local models.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {grants.map((g) => (
        <li
          key={g.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card p-4"
        >
          <div>
            <p className="text-sm font-medium">
              {providerDisplayName(g.provider_key)}
              {g.revoked_at ? (
                <span className="ml-2 text-xs text-ink-muted">
                  revoked {new Date(g.revoked_at).toLocaleDateString()}
                </span>
              ) : null}
            </p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Granted {new Date(g.granted_at).toLocaleDateString()} ·{" "}
              {g.data_classes.length} data classes
            </p>
          </div>
          {!g.revoked_at ? (
            <Button
              variant="outline"
              size="sm"
              data-testid={`revoke-${g.provider_key}`}
              disabled={revoking === g.id}
              onClick={async () => {
                setRevoking(g.id);
                try {
                  await fetch(`/api/consents/${g.id}/revoke`, { method: "POST" });
                  router.refresh();
                } finally {
                  setRevoking(null);
                }
              }}
            >
              {revoking === g.id ? "Working…" : "Revoke"}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
