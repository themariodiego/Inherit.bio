"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  PERMISSION_STATES,
  SHARING_ERROR_STATUS,
  TURN_OFF_BUTTON,
  TURN_ON_BUTTON,
  rowControlLabel,
  type PermissionState,
} from "@/copy/family/permissions";
import type { GrantPurposeRequest } from "@/lib/family/grant-token";

/**
 * <PermissionGrantRow> — one purpose, one direction, one control (brief §3
 * §4.2, §5 §5.3). Permission state carries no colour: a glyph and one of the
 * three words. There is no master switch, and nothing is pre-ticked.
 *
 * A row in the column this session may not set renders disabled with the
 * sentence naming who can. A row this session may set carries either the
 * single-use presentation token minted for exactly this endpoint, or the
 * grant id to revoke — never both.
 */

const GLYPHS: Record<PermissionState, string> = {
  on: "●",
  off: "○",
  expired: "⊘",
};

export type RowAction =
  /** The exact closed body the server component built for this one endpoint. */
  | { kind: "grant"; request: GrantPurposeRequest }
  | { kind: "revoke"; grantId: string };

export function PermissionGrantRow({
  label,
  consequence,
  personName,
  state,
  action,
  disabledReason,
}: {
  label: string;
  consequence: string;
  personName: string;
  state: PermissionState;
  /** Absent when this session may not set the row. */
  action?: RowAction;
  /** Rendered in place of the control when the row is not settable here. */
  disabledReason?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const controlName = rowControlLabel(
    action?.kind === "grant" ? TURN_ON_BUTTON : TURN_OFF_BUTTON,
    label,
    personName,
  );

  return (
    <li
      data-slot="permission-row"
      data-permission-state={state}
      className="flex flex-wrap items-start justify-between gap-3 border-t border-line py-4 first:border-t-0"
    >
      <div className="min-w-0 space-y-1">
        <p className="flex items-center gap-2 font-medium text-ink">
          <span aria-hidden="true" data-slot="permission-glyph">
            {GLYPHS[state]}
          </span>
          <span data-slot="permission-label">{label}</span>
          <span data-slot="permission-state" className="text-sm font-normal text-ink-muted">
            {PERMISSION_STATES[state]}
          </span>
        </p>
        <p className="max-w-prose text-sm leading-relaxed text-ink-muted">{consequence}</p>
        {failed ? (
          <p role="alert" className="text-sm text-danger">
            {SHARING_ERROR_STATUS}
          </p>
        ) : null}
      </div>
      {action ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={controlName}
          data-slot="permission-control"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setFailed(false);
            const response =
              action.kind === "grant"
                ? await fetch("/api/consents", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(action.request),
                  })
                : await fetch(`/api/consents/${action.grantId}/revoke`, { method: "POST" });
            setPending(false);
            if (!response.ok) {
              setFailed(true);
              return;
            }
            router.refresh();
          }}
        >
          {action.kind === "grant" ? TURN_ON_BUTTON : TURN_OFF_BUTTON}
        </Button>
      ) : (
        <p data-slot="permission-locked" className="text-sm text-ink-muted">
          {disabledReason}
        </p>
      )}
    </li>
  );
}
