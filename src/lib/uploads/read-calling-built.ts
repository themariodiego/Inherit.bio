import "server-only";

import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";

/**
 * Whether this deployment offers calling genotypes from BAM or CRAM reads on
 * the person's device (G7.4, ADR 0038): TEST-LOCAL only. Production answers
 * false, so its picker keeps refusing these files before any upload session
 * is issued, with `OWN_UPLOAD_COPY.sequenceReadsUnavailable` shown.
 */
export function readCallingBuilt(): boolean {
  return isTestJurisdictionEnabled();
}
