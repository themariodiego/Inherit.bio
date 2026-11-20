# Register amendments made in G8.5's migration stage (19 November 2026)

These are the statements of `docs/route-register.json` changed in the migration stage, under the owner's decisions of 19 November 2026: "G8.5: principles for the CSRF register amendments" (principles 1 to 4) and "G8.5: the claim-objection address accepts either kind of session". Each is given by its JSON pointer, with the text before and after. The register was edited as text; nothing else in it changed (12 statements: 7 changed, 5 new). Route indices are those of the amended file; the route id is named beside each. Every new or rewritten statement starts `registered-2026-11-19-G8.5`.

The principles, for reference:
1. The `X-Inherit-CSRF` header carries only the session token.
2. Other one-time values move to their own header or body field and keep working as they do.
3. Chunked uploads keep one session-bound value, each chunk reserved once.
4. Cookie names in the register follow the names the code really sets (not used in this stage: every cookie these routes read is already named as the code sets it).

## A. The chunk stream (principle 3)

1. `/authContracts/evidence-session-api-v1/csrfHeader`. The evidence session's chunks keep one session-bound value; the completion still spends a one-time token.
   - Old: `X-Inherit-CSRF-bound-to-the-evidence-session-and-rotated-or-consumed-on-every-state-changing-request`
   - New: `X-Inherit-CSRF-bound-to-the-evidence-session-and-rotated-or-consumed-on-every-state-changing-request-except-the-chunk-stream; registered-2026-11-19-G8.5 (principle 3): api.evidence-chunk-carries-the-evidence-session's-one-session-bound-chunk-stream-value-on-every-chunk-verified-and-never-spent-or-rotated-because-each-session-sequence-is-reserved-once (api.evidence-chunk.requestContract.chunkAuthority); api.evidence-complete-spends-a-one-time-token-and-each-of-its-answers-carries-the-successor`

2. `/routes/131/requestContract/requiredHeaders/X-Inherit-CSRF` (api.evidence-chunk). The header name, which `scripts/route-gate.ts` counts, is unchanged; only its description.
   - Old: `one-time-token-bound-to-the-evidence-session`
   - New: `registered-2026-11-19-G8.5 (principle 3): the-evidence-session's-one-session-bound-chunk-stream-value-from-the-opening-answer's-X-Inherit-Evidence-CSRF-sent-unchanged-on-every-chunk-verified-and-never-spent; each-session-sequence-is-reserved-once (chunkAuthority)`

3. `/mutationSecurityBindings/csrfTransport/binding`. The general rule names its one exception.
   - Old: `one-time-and-bound-to-the-current-authenticated-or-purpose-session`
   - New: `one-time-and-bound-to-the-current-authenticated-or-purpose-session; registered-2026-11-19-G8.5 (principle 3): api.evidence-chunk's-value-is-the-evidence-session's-one-session-bound-chunk-stream-value-verified-on-every-chunk-and-not-spent (authContracts.evidence-session-api-v1.csrfHeader)`

Not used for api.claim-review-chunk-acknowledgement, as the design notes proposed: principle 3 names uploads, and the acknowledgements of one download go one after another, so each spends a one-time reviewer token and carries the previous answer's successor. No statement about it changes (its register text already says `X-Inherit-CSRF-distinct-from-the-operation-nonce`).

## B. The first tokens of a session an answer opens (principles 1 and 2)

4. `/routes/129/policy/evidenceSessionCsrf` (api.legal-evidence-upload-session). Stage two's statement said the chunks and the completion send the opener's evidence value unchanged; they now send the session's own tokens, both handed over in the one header.
   - Old: `registered-2026-11-19-G8.5: the-201-answer-hands-the-browser-the-new-evidence-session's-X-Inherit-CSRF-value (authContracts.evidence-session-api-v1.csrfHeader)-in-the-X-Inherit-Evidence-CSRF-answer-header-because-this-answer's-own-X-Inherit-CSRF-carries-the-successor-of-this-route's-one-time-account-session-token; each-chunk-and-the-completion-send-that-value-in-X-Inherit-CSRF-unchanged`
   - New: `registered-2026-11-19-G8.5: the-201-answer-hands-the-browser-the-new-evidence-session's-first-two-X-Inherit-CSRF-values (authContracts.evidence-session-api-v1.csrfHeader)-in-the-X-Inherit-Evidence-CSRF-answer-header-as-'<chunk> <complete>': the-chunk-stream's-one-session-bound-value-for-api.evidence-chunk (principle 3) and-the-first-one-time-token-for-api.evidence-complete-whose-answers-carry-each-successor; this-answer's-own-X-Inherit-CSRF-carries-the-successor-of-this-route's-one-time-account-session-token`

5. `/routes/140/policy/evidenceSessionCsrf` (api.appeal-document-session). The same, for the appeal's evidence session (rights session).
   - Old: as 4, with `rights-session-token` in place of `account-session-token`.
   - New: as 4, with `rights-session-token` in place of `account-session-token`.

6. `/routes/130/policy/evidenceSessionCsrf` (api.future-person-claim-document-session). New statement. This opener handed the evidence value over in its own `X-Inherit-CSRF`; that header now carries the claim session's successor, minted for the cookie the request rotated.
   - Old: (absent)
   - New: `registered-2026-11-19-G8.5: the-201-answer-hands-the-browser-the-new-evidence-session's-first-two-X-Inherit-CSRF-values-in-the-X-Inherit-Evidence-CSRF-answer-header-as-api.legal-evidence-upload-session's-does; this-answer's-own-X-Inherit-CSRF-carries-the-successor-of-this-route's-one-time-claim-session-token-minted-for-the-rotated-claim-cookie (authContracts.claim-session-api-v1.rotation)`

7. `/routes/126/policy/uploadSessionCsrf` (api.embryo-cohorts). New statement. The answer that opens the embryo upload session hands over its three routes' first tokens in a new answer header, on the evidence pattern (a header, so `upload-session-v1`'s closed body is unchanged).
   - Old: (absent)
   - New: `registered-2026-11-19-G8.5: the-201-answer-that-opens-the-embryo-upload-session-hands-the-browser-its-first-one-time-X-Inherit-CSRF-tokens (authContracts.upload-session-api-v1.stateChangingRequest)-in-the-X-Inherit-Upload-CSRF-answer-header-as-'<configure> <mapping> <complete>'-one-per-token-route-bound-to-the-session-id-and-its-inherit-ingest-<session>-cookie; each-answer-of-those-routes-carries-its-route's-successor; api.embryo-ingest-chunk-carries-none; this-answer's-own-X-Inherit-CSRF-carries-the-successor-of-this-route's-one-time-account-session-token`

8. `/responseContracts/claim-review-receipt-v1/success/headers/X-Inherit-CSRF`. The receipt answer's `X-Inherit-CSRF` is the receipt route's own successor; it handed over a receipt digest the acknowledgements carried.
   - Old: `receipt-session-bound-CSRF-distinct-from-every-chunk-operation-nonce`
   - New: `registered-2026-11-19-G8.5: the-successor-of-this-route's-one-time-reviewer-session-token; each-chunk-acknowledgement-carries-its-own-route's-reviewer-token-from-the-review-page's-chain-and-no-receipt-session-value`

## C. The ingest completion's operation value (principle 2)

9. `/routes/99/requestContract/operationToken` (api.embryo-ingest-complete). New statement. `requiredHeader` (`X-Inherit-CSRF-bound-to-the-upload-session`) is unchanged and now true of the session token.
   - Old: (absent)
   - New: `registered-2026-11-19-G8.5: X-Inherit-Operation-Nonce-carries-the-one-time-ingest_complete_csrf-operation-value (the-csrfToken-the-configure-or-mapping-answer-issued)-and-not-X-Inherit-CSRF-which-is-the-upload-session's-one-time-token (operationNonceIsNotCsrf)`

10. `/responseContracts/embryo-vcf-transport-v1/configured/body/csrfToken` and 11. `/responseContracts/pgt-mapping-challenge-v1/transport/body/csrfToken`. The field keeps its name (principle 2: the operation value is not renamed into the session token); its description says where it travels.
   - Old: `the-X-Inherit-CSRF-value-bound-to-this-upload-session-that-api.embryo-ingest-complete-requires`
   - New: `the-one-time-ingest_complete_csrf-operation-value-bound-to-this-upload-session-that-api.embryo-ingest-complete-requires-in-X-Inherit-Operation-Nonce (registered-2026-11-19-G8.5: not-the-X-Inherit-CSRF-session-token)`

## D. The claim-objection address (owner decision "G8.5: the claim-objection address accepts either kind of session")

12. `/routes/148/policy/sessionCsrf` (api.future-person-claim-objection). New statement.
   - Old: (absent)
   - New: `registered-2026-11-19-G8.5 (owner decision: the claim-objection address accepts either kind of session): X-Inherit-CSRF-is-a-one-time-session-token-of-the-emailed-link's-rights-session-checked-first-or-of-the-signed-in-account (accountEquivalent)-checked-second; the-route-spends-the-token-of-whichever-it-finds-and-runs-only-that-principal's-branch; each-branch's-one-time-objection-nonce-stays-in-body.nonce; no-other-route-takes-two-kinds`

## Not amended

- The reviewer routes: `reviewer-api-v1.stateChangingRequest` already says `X-Inherit-CSRF-and-a-distinct-route-declared-operation-nonce`; no review-case response contract names an `X-Inherit-CSRF` answer header, so the case GETs' no longer setting one needs no statement.
- auth.reset-password-submit: `X-Inherit-CSRF-header-bound-to-the-reset-session` is now true of the session token; the register does not name the Lax cookie that carries the first token, so nothing changes. Its `transaction` already says `consume-the-recovery-session-and-CSRF-token`.
- `claim-session-api-v1.csrfHeader` (`rotated-or-consumed-on-every-state-changing-request`) and `upload-session-api-v1.stateChangingRequest` are now true as written.
- api.future-person-claim-document-session `requestContract.closedBody.nonce` (`required-claim-session-bound-one-time-CSRF-nonce`) describes the body's one-time nonce, which is unchanged and is not the header; its wording ("CSRF nonce") predates principle 1 and is left for the owner to rename if wanted.
- Principle 4: every cookie these routes read is named in the register as the code sets it (`__Host-inherit-evidence`, `__Host-inherit-claim`, `__Host-inherit-download`, the reset session's host-only cookie; the ingest cookie was corrected in stage two).

New names this introduces, none in `requiredHeader(s)` (counted by `scripts/route-gate.ts`): the answer header `X-Inherit-Upload-CSRF`; `X-Inherit-Evidence-CSRF` (stage two's) now carries two tokens, separated by one space.
