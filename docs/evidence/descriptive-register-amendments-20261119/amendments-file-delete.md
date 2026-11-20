# Register amendments: `api.file-delete`'s one-time value (20 November 2026)

Rule: owner decision of 19 November 2026, "G8.5: where the register is stricter, engineering codes to it". The register already required the value (`authenticated-mutation-v1.destructiveNonce`: "delete-revoke-refuse-restrict-transfer-and-account-wide-actions-also-require-a-distinct-recent-one-time-operation-nonce-in-the-exact-route-declared-body-or-X-Inherit-Operation-Nonce-header"; `mutationSecurityBindings.operationNonceIssuance`; `tokenSecurityContract.operationNonce`: "every-confirm-refuse-delete-or-other-state-change-requires-a-distinct-one-time-session-bound-nonce-consumed-atomically-with-the-operation"), but `api.file-delete` declared no place for it, which is what the census and the route gate read. Three additions say where it travels and what is built. No existing register sentence changes; every new value carries `registered-2026-11-20-owner-decision-2026-11-19-G8.5-where-the-register-is-stricter-engineering-codes-to-it`. `docs/route-register.json` was edited by hand (three insertions), never re-serialised; it still parses.

1. `routes[api.file-delete].requestContract`
   - Old: `{ "body": "forbidden", "pathParameter": { "id": "canonical lowercase UUID of a file the caller's account owns" } }`.
   - New: the same, plus
     - `"requiredHeader": "X-Inherit-Operation-Nonce-from-the-files-page"` (the shape the census and `scripts/route-gate.ts` read: the header name before `-from-`; no `-for-the-` clause, so it is unconditional);
     - `"operationNonce": "registered-2026-11-20-…: authenticated-mutation-v1.destructiveNonce-for-deleting-one-file; files.index-renders-one-value-per-file-row-as-mutationSecurityBindings.operationNonceIssuance-says (a-stateless-HMAC-bound-to-the-account-its-originating-auth-session-the-operation-file_delete-and-that-file, expiring-within-10-minutes, stored-nowhere); prepare_own_prepared_file_cleanup_with_nonce_v1-records-its-hash-in-account_operation_nonces-in-the-same-transaction-as-the-deletion's-first-write-and-before-it (20261120110000), so-a-refused-deletion-spends-nothing-and-a-replayed-value-writes-nothing; a-missing-malformed-expired-spent-or-foreign-value (another-account-session-operation-or-file) is-refused-with-authenticated-mutation-v1.failure-before-anything-is-deleted; each-request-spends-its-own-value, and-a-file-delete-v1.pending-answer-issues-the-next (file-delete-v1.pending.nextOperationNonce); X-Inherit-CSRF-is-the-one-time-account-session-token-and-never-carries-it (operationNonceIsNotCsrf)"`.
   - Why: the route-declared place `destructiveNonce` refers to, and the refusal it gets (authenticated-mutation-v1's own failure, 403 `request_forbidden`, already bound to the route through its auth contract; the client already words it).

2. `mutationSecurityBindings.destructiveBindings`
   - Old: no row for `api.file-delete` (the list's other delete routes, `api.subject-delete`, `api.llm-settings` DELETE, `api.future-person-identity-profile` DELETE, carry one).
   - New, after `api.subject-delete`: `{ "routeId": "api.file-delete", "method": "DELETE", "operation": "file-deletion", "nonce": { "header": "X-Inherit-Operation-Nonce" }, "registeredBy": "registered-2026-11-20-…" }` (`operation` is the route's own `policy.operation`).
   - Why: the register's index of destructive one-time values names every other delete route with its header.

3. `responseContracts.file-delete-v1.pending`
   - Old: `when` "the-database-cleanup-has-not-completed; the-client-repeats-the-same-owner-authorized-DELETE-with-its-next-X-Inherit-CSRF-and-a-timeout-never-means-deleted" (unchanged).
   - New key: `"nextOperationNonce": "registered-2026-11-20-…: this-answer-alone-also-carries-an-X-Inherit-Operation-Nonce-response-header, the-next-one-time-file_delete-value-minted-for-the-same-account-session-and-file-as-the-Files-page-mints-it, which-the-repeat-sends-and-spends (mutationSecurityBindings.operationNonceIssuance: a-registered-response-issues-the-next-nonce); a-pending-answer-without-one-ends-the-repeats-as-pending-and-the-Files-page-renders-a-fresh-value"`.
   - Why: every request spends its own value ("consumed-once-by-the-state-changing-request"), and `operationNonceIssuance` allows a value to be issued only by the page "except-where-a-registered-session-response-issues-the-next-nonce"; the repeat the register already describes needs one. The body stays closed (`{ "error": "file_delete_pending" }`); the value is a response header.

Not amended, because the code now does what they say:
- `routes[api.file-delete].policy.sameOriginRequired` ("sec-fetch-site-must-equal-same-origin-or-the-request-is-refused-before-the-account-context-is-read"): the refusal now comes before the account context is read. The predicate is still `isSameOrigin`'s (see the open items).
- `authenticated-mutation-v1.failure` and `responseContractBindings.routes[api.file-delete]`: the refusal is the auth contract's 403; no response contract is added.

Not amended, and not the owner's decision to make here: the brief (`docs/inherit-v2-brief.md`) is unchanged; nothing in it names the file delete's transport.
