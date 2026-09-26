/**
 * The words of Settings → Your data → "Export everything", and the one
 * sentence the archive says when it has no conversation to carry (F4 and F5,
 * 26 Sep 2026).
 *
 * The body is a promise about what the ZIP holds, so it names only what
 * `src/app/api/export/route.ts` writes. It used to promise legal audit records
 * as well, and an export on production had none: every legal audit event is
 * written with a null principal, so nothing can yet select one account's rows
 * (docs/export-member-selection-design.md, the missing "requester resolver").
 * That gap is said plainly rather than left out, because a reader told the
 * records were included would reasonably rely on having them.
 */

export const DATA_EXPORT_HEADING = "Export everything";

export const DATA_EXPORT_BODY =
  "Download one ZIP. It has your uploads, the DNA variants we found, your results and your saved chats. It also has your consent and permission records, your birth date and the country you chose.";

export const DATA_EXPORT_NOT_YET_INCLUDED = "Legal audit records are not in it yet.";

export const DATA_EXPORT_BUTTON = "Download export";

/** `chats.json` when the chat history has nothing to show. */
export const EXPORT_CHATS_EMPTY = "Your chat history has no saved Copilot conversations.";
