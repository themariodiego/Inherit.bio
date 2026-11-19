import "server-only";

import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";

/**
 * Whether the reviewed-document Path B's evidence doors are open here: the
 * permission document ingest, scan and named-human review share the claim and
 * appeal evidence routes, and answer for permission sessions only under
 * TEST-LOCAL (INHERIT_TEST_JURISDICTION=1), exactly as Path B itself does.
 * The database requires its own flag again on every entry point.
 */
export function permissionDocumentsOpen(): boolean {
  return isTestJurisdictionEnabled();
}
