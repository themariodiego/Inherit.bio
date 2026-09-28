/**
 * The words of Settings → Your data → "Export everything", and what the
 * archive says when it has no conversation or legal audit record to carry
 * (F4 and F5, 26 Sep 2026; legal audit, 28 Sep 2026).
 *
 * The body is a promise about what the ZIP holds, so it names only what
 * `src/app/api/export/route.ts` writes. It used to promise legal audit records
 * as well, and an export on production had none: every legal audit event was
 * written without saying who acted, so none can be shown as one person's.
 *
 * The owner decided on 28 Sep 2026 (docs/protocol/decisions.md) that the
 * archive carries `legal-audit.json` with the events a person caused
 * themselves, and ships it empty, saying why, until those can be selected. The
 * sentence below is true in both states: a record that does not say who acted
 * is never shown as anyone's.
 */

export const DATA_EXPORT_HEADING = "Export everything";

export const DATA_EXPORT_BODY =
  "Download one ZIP. It has your uploads, the DNA variants we found, your results and your saved chats. It also has your consent and permission records, your birth date and the country you chose.";

export const DATA_EXPORT_LEGAL_AUDIT =
  "It has a legal audit file of what you did yourself. Records that don't say who acted are left out.";

export const DATA_EXPORT_BUTTON = "Download export";

/** `chats.json` when the chat history has nothing to show. */
export const EXPORT_CHATS_EMPTY = "Your chat history has no saved Copilot conversations.";

/** How `legal-audit.json` is described in the archive's manifest. */
export const EXPORT_LEGAL_AUDIT_DESCRIPTION =
  "Legal audit records of what you did yourself. Records that do not say who acted are left out.";

/**
 * The note at the top of `legal-audit.json`. `since` is the day the ledger
 * began recording who acted. The file may be empty, and the note says why.
 */
export function exportLegalAuditNote(since: string): string {
  return `These are the things you did yourself, as our legal audit records show them, since ${since}. Records from before then do not say who acted, so they cannot be shown as yours. Records of what other people or the service did are left out. If the list is empty, that is why, not because nothing happened.`;
}
