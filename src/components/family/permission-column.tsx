/**
 * <PermissionColumn> — one direction of sharing (brief §5 §5.3): the same
 * five rows, all default off, no master switch, no reciprocal auto-grant.
 * Server component; each row's control is the client row beside it.
 *
 * The column headed "What you will see about {name}" can be set only from
 * that person's own session, so here every one of its rows is disabled and
 * says so. The mirror column on their own permissions screen is where they
 * set it. A single row of the settable column may also be locked with its
 * own reason (the Portrait row before the independent-login marker): the
 * row and its state still render, and the sentence replaces the control.
 */
import { PermissionGrantRow, type RowAction } from "@/components/family/permission-grant-row";
import { COLUMN_DEFAULT_NOTE, PERMISSION_ROWS, type PermissionState } from "@/copy/family/permissions";
import type { PermissionRowId } from "@/copy/family/permissions";

export interface ColumnRow {
  id: PermissionRowId;
  state: PermissionState;
  action?: RowAction;
  /** Set when this one row cannot be changed from this session; renders in place of its control. */
  lockedReason?: string;
}

export function PermissionColumn({
  heading,
  headingId,
  personName,
  rows,
  disabledReason,
}: {
  heading: string;
  headingId: string;
  personName: string;
  rows: readonly ColumnRow[];
  /** Set on the column this session may not change; every row then renders it. */
  disabledReason?: string;
}) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return (
    <section
      data-slot="permission-column"
      data-settable={disabledReason ? "false" : "true"}
      aria-labelledby={headingId}
      className="space-y-3 rounded-2xl border border-line bg-card p-6"
    >
      <h2 id={headingId} className="font-medium">
        {heading}
      </h2>
      <p className="text-sm leading-relaxed text-ink-muted">{COLUMN_DEFAULT_NOTE}</p>
      <ul className="mt-2">
        {PERMISSION_ROWS.map((row) => {
          const state = byId.get(row.id);
          const locked = disabledReason ?? state?.lockedReason;
          return (
            <PermissionGrantRow
              key={row.id}
              label={row.label}
              consequence={row.consequence}
              personName={personName}
              state={state?.state ?? "off"}
              action={locked ? undefined : state?.action}
              disabledReason={locked}
            />
          );
        })}
      </ul>
    </section>
  );
}
