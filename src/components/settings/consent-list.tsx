"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { providerDisplayName } from "@/lib/llm";
import { createClient } from "@/lib/supabase/client";

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
              onClick={async () => {
                const supabase = createClient();
                await supabase
                  .from("consent_grants")
                  .update({ revoked_at: new Date().toISOString() })
                  .eq("id", g.id);
                router.refresh();
              }}
            >
              Revoke
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
