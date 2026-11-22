# Register amendments for the reviewer chunk-acknowledgement address (22 November 2026)

These are the statements of `docs/route-register.json` changed under the owner's decision of 22 November 2026, "G8.5: the reviewer chunk-acknowledgement address accepts either kind of session". The principles of 19 November 2026 ("G8.5: principles for the CSRF register amendments") apply too. Each statement is given by its JSON pointer, with the text before and after. The register was edited as text, and nothing else in it changed: 3 statements, 2 new and 1 changed. Route indices are those of the amended file, and the route id is named beside each. Every new or rewritten statement carries `registered-2026-11-22-G8.5`.

The principles, for reference:
1. The `X-Inherit-CSRF` header carries only the session token.
2. Other one-time values move to their own header or body field and keep working as they do.
3. Chunked uploads keep one session-bound value, and each chunk is reserved once.
4. Cookie names in the register follow the names the code really sets. This one is not used here: the archive's `__Host-inherit-download` cookie and the reviewer's download cookie are unchanged.

## A. The address takes either kind of session (the owner's decision)

1. `/routes/171/policy/sessionCsrf` (api.claim-review-chunk-acknowledgement). New statement.
   - Old: (absent)
   - New: `registered-2026-11-22-G8.5 (owner decision: the reviewer chunk-acknowledgement address accepts either kind of session): X-Inherit-CSRF-is-a-one-time-session-token-of-the-signed-in-reviewer-checked-first-or-of-the-signed-in-account-checked-second-for-the-TEST-account-archive's-acknowledgement-on-this-path (INHERIT_TEST_ACCOUNT_ARCHIVE_R2-closed-in-production); the-route-spends-the-token-of-whichever-it-finds-and-runs-only-that-principal's-branch; the-acknowledgements-of-one-download-go-one-after-another-each-spending-a-one-time-token-and-carrying-the-previous-answer's-successor (not-a-chunk-stream: principle-3-names-uploads); the-reviewer's-one-time-acknowledgement-nonce-stays-in-body.nonce; no-other-reviewer-route-takes-two-kinds`

2. `/routes/148/policy/sessionCsrf` (api.future-person-claim-objection). Changed. The 19 November statement said no other route takes two kinds, and that is no longer true.
   - Old: `registered-2026-11-19-G8.5 (owner decision: the claim-objection address accepts either kind of session): X-Inherit-CSRF-is-a-one-time-session-token-of-the-emailed-link's-rights-session-checked-first-or-of-the-signed-in-account (accountEquivalent)-checked-second; the-route-spends-the-token-of-whichever-it-finds-and-runs-only-that-principal's-branch; each-branch's-one-time-objection-nonce-stays-in-body.nonce; no-other-route-takes-two-kinds`
   - New: `registered-2026-11-19-G8.5 (owner decision: the claim-objection address accepts either kind of session): X-Inherit-CSRF-is-a-one-time-session-token-of-the-emailed-link's-rights-session-checked-first-or-of-the-signed-in-account (accountEquivalent)-checked-second; the-route-spends-the-token-of-whichever-it-finds-and-runs-only-that-principal's-branch; each-branch's-one-time-objection-nonce-stays-in-body.nonce; one-other-route-takes-two-kinds (registered-2026-11-22-G8.5, owner decision: the reviewer chunk-acknowledgement address accepts either kind of session): api.claim-review-chunk-acknowledgement-reviewer-first-and-account-second; no-other-route-takes-two-kinds`

## B. Where the archive branch's own value travels (principle 2)

3. `/routes/171/policy/archiveAcknowledgementProof` (api.claim-review-chunk-acknowledgement). New statement. Until now this value travelled in `X-Inherit-CSRF` both ways, the chunk's GET answer handing it over and the acknowledgement sending it back. It was recorded only as the `csrfOwnDesign` ledger row that this change removes, because the archive branch is not registered on this path.
   - Old: (absent)
   - New: `registered-2026-11-22-G8.5 (principle 2): the-TEST-account-archive-branch's-per-chunk-acknowledgement-proof (a-keyed-digest-of-the-account-download-cookie-ordinal-and-the-chunk's-challenge-digest-and-size)-is-handed-over-by-that-chunk's-GET-answer (api.download-chunk)-in-X-Inherit-Operation-Proof-and-sent-back-on-that-chunk's-one-acknowledgement-in-X-Inherit-Operation-Proof-checked-exactly-as-before-and-not-X-Inherit-CSRF-which-is-the-one-time-account-session-token`

## Not amended, and why

- `/routes/171/requestContract/requiredSignals` (`X-Inherit-CSRF-distinct-from-the-operation-nonce`). This is still true of both branches: the reviewer's nonce is in the body, and the archive's proof is in its own header.
- `/routes/171/auth` (`reviewer`), `policy.mode` and `policy.authority`. The route's register `auth` is still its first kind (`SESSION_CSRF_ROUTES`). The second kind is declared in `SESSION_CSRF_SECOND_KINDS` and stated in amendment 1, as on the claim-objection address. The archive branch is TEST-only and is not registered on this path; amendments 1 and 3 name it.
- `authContracts.reviewer-api-v1.stateChangingRequest` (`exact-Origin-same-origin-fetch-metadata-X-Inherit-CSRF-and-a-distinct-route-declared-operation-nonce`). The reviewer's branch is unchanged.
- `mutationSecurityBindings.csrfTransport.binding` (`one-time-and-bound-to-the-current-authenticated-or-purpose-session; ... api.evidence-chunk ...`). This is true as written. The account token is an authenticated session's token, and this route is not a chunk stream, so principle 3's one exception is unchanged.
- `/routes/<api.download-chunk>` and `responseContracts.download-chunk-v1`. They name no answer header, and the archive's `X-Inherit-CSRF` answer header was never registered. Amendment 3 now says where the proof is handed over. `objectPathOrCredentialHeaders: forbidden` is unchanged in kind, because the header carries the same keyed acknowledgement proof as before.
- `responseContracts.empty-acknowledgement-v1`. The 204 is unchanged. The gate sets the successor in `X-Inherit-CSRF`, as on every other gated route.

New names this introduces: none. `X-Inherit-Operation-Proof` is already the register's name for a derived proof (stage two: `exportProof` on api.export and api.subject-export, `derivedProof` on api.future-person-identity-profile). It is used here for the first time as an answer header, on the TEST archive's chunk GET. It is not in any `requiredHeaders`, so `scripts/route-gate.ts` counts nothing new ("3 of 3 required headers read by the product", unchanged).

## Ledger (not the register)

`docs/register-contract-divergence.json`: the `csrfOwnDesign` row for api.claim-review-chunk-acknowledgement is removed, and the list is now `[]`. `csrfOwnDesignNote` gains a dated sentence for 22 November. In `csrfTransportNote`, the sentence "csrfOwnDesign keeps one branch row, the TEST account archive's acknowledgement on api.claim-review-chunk-acknowledgement's path" becomes "no branch either since 2026-11-22: csrfOwnDesign is empty (...)". The file is written with `json.dumps(indent=2, ensure_ascii=True) + "\n"`, and it round-trips.
