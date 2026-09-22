# Signed jurisdiction review records

Every permitted or prohibited real-jurisdiction decision must satisfy
`data/jurisdictions.json.signedReviewContract`. The gate checks the record's
structure and the decision's history. It cannot verify professional standing,
independence or legal correctness, and it never supplies a determination.

The named qualified reviewer must review the exact decision at a full commit
SHA. That commit must be available and an ancestor of the candidate being
checked. The candidate decision must equal that historical decision after
removing only its top-level `review` member. Object key order may differ;
array order, string contents, dates, status and every other field may not.
A changed decision therefore needs a new review of the changed commit.

The reviewed decision can be recorded in an intermediate local commit before
the signed record and reference are added in a later commit. An intermediate
permitted/prohibited decision without its review will fail the gate and must
not be released. This process binds the review without requiring a commit to
contain its own future SHA. It does not authorize an automated determination
or a generated human signature.

Use `TEMPLATE.md` for the record. Its computed path must be a tracked regular
file; symlinks, including parent directories, and untracked files are refused.
The record and reference must agree exactly, including the final sign-off.
Run `corepack pnpm gate:jurisdictions` on the final candidate with complete Git
history. Missing or shallow history fails for decisions it cannot verify.

The gate's tests construct temporary repositories with invented records and
exercise passing ancestry, different decisions, non-ancestor commits, invalid
object types, replacement objects, missing history and path boundaries. These
are instrument tests, not signed reviews. There are still no real signed
jurisdiction decisions in the product; restricted capabilities remain closed.
