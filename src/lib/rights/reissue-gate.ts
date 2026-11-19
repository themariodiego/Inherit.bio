/**
 * Whether `POST /api/rights/reissue` is open. It is not (owner decision
 * 2026-10-22, "Routes that need unapproved mail or notice text"): rights
 * recovery sends a mail whose wording the owner has not approved, so the
 * route answers resource-not-found-v1 everywhere, TEST-LOCAL included, until
 * that wording and its template exist. The form, lookup, limits and candidate
 * behind the door are built and proven; opening it is this one line.
 */
export function rightsReissueOpen(): boolean {
  return false;
}
