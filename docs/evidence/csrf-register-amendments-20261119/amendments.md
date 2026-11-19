# Register amendments made under the CSRF principles (19 November 2026)

These are the statements of `docs/route-register.json` changed in G8.5 stage two, under the owner's decisions of 19 November 2026: "G8.5: principles for the CSRF register amendments" (principles 1 to 4) and "G8.5: sign-out keeps an open rights session". Each is given by its JSON pointer, with the text before and after. Nothing else in the register changed. Route indices are those of the amended file; the route id is named beside each.

The principles, for reference:
1. The `X-Inherit-CSRF` header carries only the session token.
2. Other one-time values move to their own header or body field and keep working as they do.
3. Chunked uploads keep one session-bound value, each chunk reserved once (not used in this stage).
4. Cookie names in the register follow the names the code really sets.

## A. Where each one-time value now travels (principles 1 and 2)

1. `/routes/82/requestContract/requiredSignals/2` (api.account-completion). The completion's presentation token was sent twice, in the body and again in `X-Inherit-CSRF`. It now travels only in the body field the register already names.
   - Old: `X-Inherit-CSRF-header-matching-the-account-completion-presentation`
   - New: `X-Inherit-CSRF-header-bound-to-the-current-live-authenticated-session-and-spent-once; the-account-completion-presentation-travels-only-in-body.presentationToken`

2. `/routes/120/requestContract/operationToken` (api.invitations). New statement. Both bodies' one-time operation token moves from `X-Inherit-CSRF` to `X-Inherit-Operation-Nonce`.
   - Old: (absent)
   - New: `registered-2026-11-19-G8.5: X-Inherit-Operation-Nonce-carries-the-one-time-operation-token-the-page-rendered-for-the-target-draft (invitation_create-for-a-cohort-draft-or-request-send-for-a-path-b-subject-esignature-draft)-and-not-X-Inherit-CSRF-which-is-the-one-time-account-session-token (operationNonceIsNotCsrf)`

3. `/routes/125/requestContract/operationToken` (api.embryo-cohort-drafts). New statement, as above for the draft's operation token.
   - Old: (absent)
   - New: `registered-2026-11-19-G8.5: X-Inherit-Operation-Nonce-carries-the-one-time-cohort_draft_create-operation-token-the-upload-page-rendered-for-this-account-session-and-not-X-Inherit-CSRF-which-is-the-one-time-account-session-token (operationNonceIsNotCsrf)`

4. `/routes/129/requestContract/operationToken` (api.legal-evidence-upload-session). New statement, as above for the reviewed-document card's operation token.
   - Old: (absent)
   - New: `registered-2026-11-19-G8.5: X-Inherit-Operation-Nonce-carries-the-one-time-document-session-operation-token-the-reviewed-document-card-rendered-for-this-draft-and-not-X-Inherit-CSRF-which-is-the-one-time-account-session-token (operationNonceIsNotCsrf)`

5. `/routes/129/policy/evidenceSessionCsrf` (api.legal-evidence-upload-session). New statement. This route opens an evidence session and used to hand the browser that session's value in its answer's `X-Inherit-CSRF`. That header now carries this route's own session-token successor, so the evidence value has its own answer header. The chunk and completion requests still send it in `X-Inherit-CSRF`, checked as before (their own move is the next stage).
   - Old: (absent)
   - New: `registered-2026-11-19-G8.5: the-201-answer-hands-the-browser-the-new-evidence-session's-X-Inherit-CSRF-value (authContracts.evidence-session-api-v1.csrfHeader)-in-the-X-Inherit-Evidence-CSRF-answer-header-because-this-answer's-own-X-Inherit-CSRF-carries-the-successor-of-this-route's-one-time-account-session-token; each-chunk-and-the-completion-send-that-value-in-X-Inherit-CSRF-unchanged`

6. `/routes/140/policy/evidenceSessionCsrf` (api.appeal-document-session). New statement, the same handover for the appeal's evidence session (rights session).
   - Old: (absent)
   - New: `registered-2026-11-19-G8.5: the-201-answer-hands-the-browser-the-new-evidence-session's-X-Inherit-CSRF-value (authContracts.evidence-session-api-v1.csrfHeader)-in-the-X-Inherit-Evidence-CSRF-answer-header-because-this-answer's-own-X-Inherit-CSRF-carries-the-successor-of-this-route's-one-time-rights-session-token; each-chunk-and-the-completion-send-that-value-in-X-Inherit-CSRF-unchanged`

7. `/routes/84/methodRequestContracts/POST/exportProof` (api.export). New statement. The explicit export action's sealed proof moves from `X-Inherit-CSRF` to its own header. Its hash is bound into the operation and the database exactly as before; no database function or stored binding changed.
   - Old: (absent)
   - New: `registered-2026-11-19-G8.5: X-Inherit-Operation-Proof-carries-the-sealed-one-time-export-proof-the-page-rendered-with-the-explicit-action-bound-to-the-account-auth-session-origin-authority-receipt-and-operation-whose-hash-the-operation-envelope-and-the-database-bind-as-the-request's-csrf-binding-exactly-as-before-and-not-X-Inherit-CSRF-which-is-the-one-time-account-session-token; a-GET-poll-sends-neither`

8. `/routes/105/methodRequestContracts/POST/exportProof` (api.subject-export). New statement, the same for one record's export.
   - Old: (absent)
   - New: the same text as 7.

9. `/routes/136/methodRequestContracts/PUT/derivedProof` and 10. `/routes/136/methodRequestContracts/DELETE/derivedProof` (api.future-person-identity-profile). New statements. The profile page's keyed proof, derived from its one-time operation token, moves from `X-Inherit-CSRF` to its own header and is checked with the token as before.
   - Old: (absent)
   - New: `registered-2026-11-19-G8.5: X-Inherit-Operation-Proof-carries-the-profile-page's-keyed-proof-derived-from-the-claims-of-its-one-time-operation-token-in-X-Inherit-Operation-Nonce-and-checked-together-with-it-as-before-and-not-X-Inherit-CSRF-which-is-the-one-time-account-session-token`

11. `/routes/102/requestContract/pathBDraftNonce` (api.subject-drafts). The two Path B bodies' one-time draft nonce moves from `X-Inherit-CSRF` to `X-Inherit-Operation-Nonce`.
   - Old: `both-path-b-bodies-carry-the-upload-page's-one-time-draft-nonce-in-x-inherit-csrf-recorded-in-account_operation_nonces-before-the-draft-is-written-20261023130000`
   - New: `both-path-b-bodies-carry-the-upload-page's-one-time-draft-nonce-in-X-Inherit-Operation-Nonce-recorded-in-account_operation_nonces-before-the-draft-is-written-20261023130000; X-Inherit-CSRF-is-the-one-time-account-session-token-on-every-body`

12. `/routes/113/requestContract/oneTimeValues` (api.consents). New statement. The embryo bodies' operation token moves to `X-Inherit-Operation-Nonce`; every other body's one-time value is its `artifactPresentationToken`, no longer repeated in the header.
   - Old: (absent)
   - New: `registered-2026-11-19-G8.5: the-two-embryo-bodies (sign-artifact-with-cohortDraftId-and-grant-purpose-with-cohortId)-carry-the-page's-one-time-embryo-operation-token (artifact_sign-or-cohort_purpose_grant)-in-X-Inherit-Operation-Nonce; every-other-body's-one-time-value-is-its-body.artifactPresentationToken; X-Inherit-CSRF-is-the-one-time-account-session-token-on-every-body-and-never-repeats-either-value (operationNonceIsNotCsrf)`

Not amended, because the register already says what the code now does: api.embryo-record-key-cards-rights (`X-Inherit-CSRF-bound-to-the-rights-session` and the body `nonce`), and the claimant routes, api.future-person-export and api.third-party-subject-export, whose register text names no CSRF value of their own (each operation's nonce travels where it always did).

## B. Cookie names (principle 4)

13. `/authContracts/token-candidate-api-v1/credential/shape`. The activation candidate cookie is named as the code sets it (`src/lib/embryos/rights-activation.ts`).
   - Old: `non-authorizing-secure-httpOnly-sameSite-strict-__Host-inherit-candidate-cookie-plus-a-one-time-form-nonce; it-is-not-bound-to-or-evidence-of-a-token-until-the-activation-transaction`
   - New: `non-authorizing-secure-httpOnly-sameSite-strict-__Host-inherit-rights-candidate-cookie-plus-a-one-time-form-nonce; it-is-not-bound-to-or-evidence-of-a-token-until-the-activation-transaction`

14. `/responseContracts/upload-session-v1/embryoSetCookie`. The embryo upload session's cookie is one per session, named by the session id, as the code sets it (`src/lib/embryos/ingest-session.ts`).
   - Old: `secure-httpOnly-sameSite-strict-__Host-inherit-upload`
   - New: `secure-httpOnly-sameSite-strict-__Host-inherit-ingest-<session>-one-cookie-per-upload-session-named-by-its-session-id`

## C. Sign-out (principle 4 and "sign-out keeps an open rights session")

15. `/routes/80/policy/transaction` (auth.sign-out). The model-capability cookie it named is removed (no code sets one), and it says the rights cookie is not cleared.
   - Old: `...before-returning-success-clear-the-host-only-session-upload-evidence-export-download-and-model-capability-cookies-and-write-no-user-session-token-or-capability-detail-to-observability; a-stolen-pre-signout-...`
   - New: `...before-returning-success-clear-the-host-only-session-upload-evidence-export-and-download-cookies-and-write-no-user-session-token-or-capability-detail-to-observability; the-rights-cookie-is-not-cleared-at-sign-out (sign-out-v1.sessionEffect); a-stolen-pre-signout-...` (the rest of the statement is unchanged)

16. `/responseContracts/sign-out-v1/sessionEffect`. The rights cookie leaves the list of cookies cleared, as the owner decided.
   - Old: `revoke-the-current-server-session-and-clear-every-Inherit-auth-rights-upload-evidence-claim-download-and-candidate-cookie-before-the-response`
   - New: `revoke-the-current-server-session-and-clear-every-Inherit-auth-upload-evidence-claim-download-and-candidate-cookie-before-the-response; the-rights-cookie-is-not-cleared-at-sign-out-so-an-open-rights-session-whose-mailed-link-is-already-spent-survives (owner-decision-2026-11-19-G8.5-sign-out-keeps-an-open-rights-session)`

New headers this introduces, both outside `X-Inherit-CSRF`: `X-Inherit-Operation-Proof` (a request header, for the export routes' sealed proof and the identity profile's derived proof) and `X-Inherit-Evidence-CSRF` (an answer header, for the evidence session's first value). Both are declared in prose keys, as the most recent amendments do, not in `requiredHeader(s)`: those are counted by `scripts/route-gate.ts`, whose planted check for the singular declaration shape would no longer trip with seven more mapped declarations.
