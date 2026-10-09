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
import { submitFamilyPermission, type PermissionAction } from "@/lib/family/permission-response";

/**
 * <PermissionGrantRow> — one purpose, one direction, one control (brief §3
 * §4.2, §5 §5.3). Permission state carries no colour: a glyph and one of the
 * three words, both in the ink. There is no master switch, and nothing is
 * pre-ticked.
 *
 * A row in the column this session may not set renders disabled with the
 * sentence naming who can. A row this session may set carries either the
 * single-use presentation token minted for exactly this endpoint, or the
 * grant id to revoke — never both.
 */

/** Geometric shapes Inter carries; "expired" is the empty ring struck through in CSS (family.css). */
const GLYPHS: Record<PermissionState, string> = {
  on: "●",
  off: "○",
  expired: "○",
};

/** The exact closed operation the server built for this one endpoint. */
export type RowAction = PermissionAction;

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
    <li data-slot="permission-row" data-permission-state={state} className="fam-permission">
      <div className="space-y-1">
        <p className="flex flex-wrap items-center gap-x-2 text-base text-ink">
          <span aria-hidden="true" data-slot="permission-glyph">
            {GLYPHS[state]}
          </span>
          <span data-slot="permission-label" className="font-medium">
            {label}
          </span>
          <span data-slot="permission-state" className="text-ink">
            {PERMISSION_STATES[state]}
          </span>
        </p>
        <p className="caption max-w-measure">{consequence}</p>
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
            try {
              if (!await submitFamilyPermission(action)) {
                setFailed(true);
                return;
              }
              router.refresh();
            } catch {
              setFailed(true);
            } finally {
              setPending(false);
            }
          }}
        >
          {action.kind === "grant" ? TURN_ON_BUTTON : TURN_OFF_BUTTON}
        </Button>
      ) : (
        <p data-slot="permission-locked" className="caption max-w-xs">
          {disabledReason}
        </p>
      )}
    </li>
  );
}
