# Register divergences: what closed, and what needs the owner

28 September 2026. This covers acceptance rows G8.5 ("Every live
surface/endpoint/prefix matches its register") and G2.1 item (2). It closes
what could be closed without an owner decision. For the rest, it writes out the
exact change to the brief or the register that each option would make.
**It does not edit `docs/inherit-v2-brief.md`;** the register edit in section 3 came after the owner answered.
Any brief edit also means repinning `briefSha256`, which `pnpm gate:routes`
checks. The brief diffs below are generated, not hand-typed. They have zero
lines of context, and `git apply --unidiff-zero` applies either one cleanly
to the brief as it stands. Both rows stay NO.

**The owner answered on 2026-09-28 (evening)** (`docs/protocol/decisions.md`,
the "2026-09-28 (evening)" entry). Each answer is the recommended option:

1. **Nonces (section 2): B.** This becomes brief X1.5. It is built on
   `claude/register-divergences-2`, not in this pull request.
2. **`/withdraw/request` (section 3): A.** Registered as
   `rights.withdraw-request`, an HTML endpoint. This edits
   `docs/route-register.json` but not the brief; see "What was built" in
   section 3.
3. **`generated-artifacts` (section 4): A.** Dropped, and the single-object
   export archive form is retired; see "What was built" in section 4.
4. **D-081 (section 5):** the hard stop stays. Nothing changes.

The sections below keep the questions as they were asked. The table in
section 1 shows the state after this pull request.

## 1. Where every recorded divergence stands

The ledgers are `docs/route-divergence.json` (checked by
`scripts/route-register-correspondence.test.ts` and `pnpm gate:routes`) and
`docs/register-contract-divergence.json`.

| Ledger row | Status after this change | What closes it |
|---|---|---|
| `storageBucketDivergence` `genomes-staging` | **Closed.** `20260930140000_drop_genomes_staging_bucket.sql` drops the bucket, and the row is removed. The lead applies the migration with the guarded process. | Nothing further. The two D-130 literals are kept in `allowlistedBucketNotCreated` (see section 7). |
| `builtButNotRegistered` `/api/withdraw` (D-081) | **Dated.** `deleteAfter: 2026-10-14`. After that date the correspondence test fails while the row exists. | Delete the route, the `[token]` directory, the one e2e test on that path, and both rows (section 5). |
| `permissiveDynamicSegment` `/withdraw/[token]` (D-081) | **Dated**, the same way. | Same change as the row above. |
| `methodDivergence` `api.account-delete` | **Decided: B** (2026-09-28, evening). Built on `claude/register-divergences-2`. The row stays here until that lands. | Brief X1.5, then the GET is deleted and the row goes stale. |
| `methodDivergence` `api.export` | **Build work; no decision outstanding.** Row text refreshed: the layers underneath have landed, and the route itself has not changed. | The POST, the polling GET, the producer and delivery, with the synchronous GET deleted in the same change. |
| `kindDivergence` `/withdraw/request` | **Closed.** The owner chose A on 2026-09-28 (evening). The register now names `/withdraw/request` as `rights.withdraw-request`, an HTML endpoint, and the row is removed. `kindDivergence` is empty and still checked in both directions. | Nothing further. |
| `storageBucketDivergence` `generated-artifacts` | **Closed.** The owner chose A on 2026-09-28 (evening). `20260930140100_drop_generated_artifacts_bucket.sql` drops the bucket and retires the single-object export archive form, and the row is removed. The lead applies the migration with the guarded process. | Nothing further. The three column CHECK literals are kept in `allowlistedBucketNotCreated` (section 4). |
| `storageBucketDivergence` `legal-evidence` | **Unbuilt.** It stays declared but not created. | Evidence ingest is built. |
| `storageBucketDivergence` `future-person-identity` | **Unbuilt.** It stays declared but not created. | Future-person claim review is built. |
| `unregisteredServerActions` `acknowledgeEmbryoGate` | **Deliberate; not a defect.** | Nothing. |
| `unhashableAttestationFields` (5 rows) | **Decided on 2026-09-13** (keep the code, record the divergence). Unchanged. | A `policy.jurisdiction` artifact is authored. |
| `unreadRequiredHeaders` `api.evidence-chunk` | **Unbuilt route.** Unchanged. | The legal-evidence ingest design. |
| `redirectStatusDivergence`, `taskDepthCeilingDivergence` | Empty. Both are still checked in both directions. | None. |

**Update, 2026-09-28 (evening):** the `api.account-delete` row is closed. The
owner chose B, and brief X1.5 is built; see the end of section 2.

## 2. Who issues an operation nonce: the `GET /api/account/delete` question

**What runs today.** `src/app/api/account/delete/route.ts` exports a GET that
the register does not declare. The GET does four things:

- checks same-origin and the authenticated session;
- calls `issue_account_operation_nonce_v1`, which requires re-authentication
  within 15 minutes and MFA when enrolled;
- stores only the SHA-256 of a 10-minute nonce, bound to the account, the
  session and one operation (`account_delete`, or `account_delete_cancel`
  during the notice period);
- returns that nonce together with the current deletion status, under
  `Cache-Control: no-store`.

`src/components/settings/danger-zone.tsx` calls this GET on mount. So every
visit to `/settings/data` writes a nonce row. When the session is more than 15
minutes old, the GET returns 403, and the danger zone then shows no deletion
status at all, including the end date of a running notice period.

**Why it cannot simply be transcribed.** The brief describes no way to issue
this nonce, and the gap is wider than one route:

- 37 registered request contracts require an operation nonce.
- Only the embryo-ingest and appeal session responses say how theirs is issued.
- The one related owner decision, on 2026-09-25 for large exports, goes the
  other way from this GET. Action forms render stateless nonces after a
  read-only check, only a POST consumes one, and "GET never creates or
  rotates those rows, sessions or cookies".

### Option A: describe this GET as the mint

This adds one sentence to the brief's account-deletion hard case:

```diff
--- a/docs/inherit-v2-brief.md
+++ b/docs/inherit-v2-brief.md
@@ -2157 +2157 @@
-- *Account deletion.* `owner_account_id` is `on delete restrict`, and `POST /api/account/delete` is the only deletion path. **It purges every subject the account owns, including subjects other accounts hold live consents for**, then deletes the auth row. The earlier draft's ownership-transfer rule is deleted: it contradicted both the FK cascade and the deletion test, and it meant "delete my account" silently left copies of genomes behind. Grantees receive an email 7 days before the purge and the claimed subject can take their own copy first (`GET /api/subjects/[id]/export`, §A.11). `audit_log` rows survive with `account_id` nulled and no subject-identifying content.
+- *Account deletion.* `owner_account_id` is `on delete restrict`, and `POST /api/account/delete` is the only deletion path. **It purges every subject the account owns, including subjects other accounts hold live consents for**, then deletes the auth row. The earlier draft's ownership-transfer rule is deleted: it contradicted both the FK cascade and the deletion test, and it meant "delete my account" silently left copies of genomes behind. Grantees receive an email 7 days before the purge and the claimed subject can take their own copy first (`GET /api/subjects/[id]/export`, §A.11). `audit_log` rows survive with `account_id` nulled and no subject-identifying content. `GET /api/account/delete` is the only issuance surface for the one-time operation nonce that `POST /api/account/delete` and `POST /api/account/delete/cancel` require. It is same-origin and `Cache-Control: no-store`, requires the account's current auth session re-authenticated within 15 minutes (MFA when enrolled), stores only the SHA-256 of a nonce that expires in 10 minutes and is bound to the account, that session and one operation (`account_delete`, or `account_delete_cancel` during the notice period), and returns the nonce with the current deletion status. Apart from pruning expired and consumed nonces, it writes nothing else.
```

The register entry it would allow, for `api.account-delete`:

```json
"methods": ["POST", "GET"],
"methodRequestContracts": {
  "POST": { "…": "the current requestContract, unchanged" },
  "GET": { "body": "forbidden", "query": "forbidden" }
},
"policy": {
  "…": "unchanged",
  "methodPolicies": {
    "POST": "create-the-deletion-hold-as-today",
    "GET": "issue-one-10-minute-session-bound-operation-nonce-stored-sha256-only-for-account_delete-or-account_delete_cancel-and-return-it-with-the-current-deletion-status; no-other-write-beyond-pruning-expired-or-consumed-nonces"
  }
}
```

It also needs:

- a response contract `account-operation-nonce-v1`, with status 200, `no-store`,
  and a closed body `{ status: "active" | "notice_period", noticeEndsAt?:
  only-in-notice_period, operationNonce: 43-char-base64url }`;
- that contract added to `responseContractBindings["api.account-delete"]`;
- a `securityRateLimitContract.bindings.routes` entry, because this GET writes
  a row on every call and has no rate limit today. The owner sets the numeric
  ceiling.

The code stays as it is. The cost is that this writes into the brief a GET
that stores state, which is the opposite of the 2026-09-25 rule. It also
leaves the other 36 nonce-bearing routes with no stated way to get their
nonces.

### Option B, recommended: one rule for every operation nonce

This adds one paragraph after X1.4:

```diff
--- a/docs/inherit-v2-brief.md
+++ b/docs/inherit-v2-brief.md
@@ -2391,0 +2392,2 @@
+**X1.5 Operation nonces are rendered, never fetched.** Every route whose registered request contract requires a one-time operation nonce obtains it the way the large-export action forms in G5.6 do, unless a registered session response issues it (the embryo-ingest and appeal sessions). The authorized page that offers the operation renders a stateless nonce after a read-only authority check, bound to the principal, the originating auth session, the operation and its target, and expiring within 10 minutes. Only the explicit state-changing request consumes it, once, recording its hash in the same transaction as the operation; a replayed, expired or foreign nonce changes nothing. No GET creates, rotates or stores a nonce, and there is no nonce-issuing endpoint. For account deletion, `/settings/data` renders the nonce for `POST /api/account/delete` and, during the notice period, for `POST /api/account/delete/cancel`; re-authentication within 15 minutes (MFA when enrolled) is checked by those POSTs, not by the page. (Owner decision, <date>.)
+
```

The register gets no new route. `api.account-delete` stays POST-only, as it
is registered today. One clause states the rule where the nonce requirements
already live, `mutationSecurityBindings`:

```json
"operationNonceIssuance": "rendered-by-the-authorized-page-that-offers-the-operation-after-a-read-only-authority-check-as-a-stateless-HMAC-bound-to-principal-originating-session-operation-and-target-expiring-within-10-minutes; consumed-once-by-the-state-changing-request-in-the-operation-transaction; no-GET-issues-rotates-or-stores-a-nonce; except-where-a-registered-session-response-issues-the-next-nonce"
```

The code work that closes the row:

1. `/settings/data` reads the deletion status and renders the nonce on the
   server. It reuses the HMAC pattern in
   `src/lib/exports/export-operation-token.ts`.
2. `POST /api/account/delete` and `/cancel` verify the HMAC. Their database
   functions then consume the nonce by inserting its hash once, in the same
   transaction as the hold, instead of looking up an issued row. This needs a
   migration. `issue_account_operation_nonce_v1` is revoked.
3. The GET is deleted. The danger zone takes its state as props and refreshes
   after each POST. Deleting the GET makes the `methodDivergence` row stale,
   and `pnpm gate:routes` then fails until the row is removed.

**Why B.**

- One sentence answers the issuance question for all 37 routes. Without it,
  each new route either gets its own minting GET or stays undeclared.
- It follows the owner's own 2026-09-25 rule instead of making an exception
  to it.
- It removes a GET that stores state, and with it the rate-limit binding that
  A needs.
- As a side effect, the deletion status stops depending on the 15-minute
  re-authentication window. Re-authentication is still checked by the POSTs
  that need it.

### Option C: keep the row

The divergence stays recorded and checked in both directions. This is the
right interim state under B until the code work lands.

### Decided 2026-09-28 (evening): B. What was built

The brief now carries X1.5 exactly as the diff above, dated 2026-09-28.
`briefSha256` is repinned. `mutationSecurityBindings.operationNonceIssuance`
states the rule in the register. `api.account-delete` stays POST-only, as it
was always registered, and its `methodDivergence` row is removed.

- **The nonce.** `src/lib/account-operation-nonce.ts` has the form
  `<expiresAt>.<random>.<mac>`. The MAC binds it to the account, the auth
  session, the operation and the expiry. The nonce carries none of them: the
  POST recomputes the MAC from its own live context, so a nonce for another
  account, session or operation fails. It lives ten minutes.
- **The page.** `/settings/data` calls `deletionControlState()` in
  `src/lib/account-deletion-state.ts`. That function reads the live account
  and the current deletion request, then mints the nonce for the one
  operation the page offers. It writes nothing. `danger-zone.tsx` takes this
  as a prop, fetches nothing, and calls `router.refresh()` after each POST to
  get the new state and a fresh nonce. The deletion status no longer depends
  on the 15-minute re-authentication window. Re-authentication is checked by
  the POST.
- **The POSTs.** `POST /api/account/delete` and `/cancel` verify the nonce,
  then call `request_account_deletion_v2` or `cancel_account_deletion_v2`.
  These are public invoker doors over private definer bodies, in the house
  style. Each body records the nonce hash once and runs the unchanged v1 body
  in the same transaction. A replay inside the lifetime fails as `invalid_operation_nonce`,
  and a failed operation spends nothing. The GET is deleted, so a GET on the
  path is not served.
- **Two migrations, in deploy order.**
  - `20260930140200_account_operation_nonce_rendered.sql` only adds the
    recorder and the v2 functions. Apply it **before** the code deploys.
  - `20260930140300_retire_stored_account_operation_nonce.sql` drops
    `issue_account_operation_nonce_v1` and revokes v1 from the service role.
    Apply it **after** the code deploys.

  In either other order, account deletion would briefly call a function that
  is missing or refused.

**One more site the rule now covers.** The upload page renders an own-upload
consent or account-completion token. It stores that token's nonce hash
through `issue_own_upload_nonce_v1` on every render (`prepareOwnUpload`). X1.5
forbids this too. It is recorded in
`docs/register-contract-divergence.json#nonceStoredBeforeUse` and compared in
both directions, with the same rebuild as its closing. No owner decision is
needed for it.

## 3. `/withdraw/request`: a registered page built as a `route.ts`

**Decided 2026-09-28 (evening): option A.** What was built is at the end
of this section.

**What was true when the question was asked.**

- The register pins `/withdraw/[token]` to the literals `request` and
  `session`, with kind `page`.
- `/withdraw/request` is a `route.ts`. It returns a hand-written HTML document
  that sets the rights-activation candidate cookie and sends
  `Content-Security-Policy: default-src 'none'` with one nonce'd script and one
  nonce'd style.
- The register itself requires this shape.
  `tokenSecurityContract.urlCredentialInterstitial.behavior` says: "the GET only
  sets a short-lived non-authorizing CSRF candidate cookie and renders a generic
  interstitial". It also says that before render, "a minimal inline script
  reads the fragment exactly once".
- A Next.js page cannot set a cookie while rendering. The Next.js 16 docs
  (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`)
  allow `cookies().set` only in Server Functions and Route Handlers. A page
  also ships the framework runtime beside that script.
- The accessibility cost the row used to name is already paid. Since
  2026-09-11, `e2e/a11y.spec.ts` audits this URL in both themes through
  `ENDPOINT_RENDERED_PAGES`.

**Why this needs the owner.** Closing it means changing either the binding
authority to match the code, or the code to match the authority. On a surface
that every mailed token lands on, that choice belongs to the owner. The G8.5
row warns against writing handler-shaped authority into the register without
one.

### Option A, recommended: register the literal as what it is

This needs no brief change: the brief lists `/withdraw/[token]` as a public
route and does not say what kind of route it is. The register gains one entry:

```json
{
  "id": "rights.withdraw-request",
  "path": "/withdraw/request",
  "kind": "endpoint",
  "domain": "rights",
  "auth": "public",
  "methods": ["GET", "HEAD"],
  "methodRequestContracts": {
    "GET": { "body": "forbidden", "query": "forbidden" },
    "HEAD": { "body": "forbidden", "query": "forbidden" }
  },
  "stateProfile": "endpoint",
  "policy": {
    "requestMode": "the-browser-holds-the-fragment-only-in-ephemeral-memory-and-the-server-GET-reads-no-target; explicit-activation-posts-it-to-api.rights-activate",
    "contracts": ["tokenSecurityContract.urlCredentialInterstitial"]
  },
  "successResponseContract": "rights-interstitial-v1",
  "disposition": "kept"
}
```

It also gains a response contract, `rights-interstitial-v1`:

- status 200, `text/html`;
- CSP `default-src 'none'`, with one per-response script and style nonce,
  `connect-src 'self'`, and `base-uri`, `form-action` and `frame-ancestors`
  all `'none'`;
- `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex, nofollow`;
- the candidate `Set-Cookie` on GET only;
- HEAD returns no cookie and no body;
- the accessibility bar is audited by URL, at the level of a registered page.

Four existing places change with it:

- `rights.withdraw.parameterContract.token.enum` becomes `["session"]`;
- `urlCredentialInterstitial.requestTarget` and `historyReplacement` switch to
  `routeFrom: "rights.withdraw-request"` with no params;
- the correspondence test's "expands a pinned parameter" expectation changes;
- the D-081 row's `pinnedTo` changes.

The reason for A is the one-script CSP. It is what makes the fragment rule
provable, because no other code on the page can read `location.hash` before
the script clears it.

### Option B: move the mint into `src/proxy.ts` and render a page

The proxy can set response cookies (`proxy.md`, "Using Cookies"). The page
would then have to do three things:

- place the fragment script ahead of the framework runtime;
- admit Next's scripts under its CSP;
- keep every other client module away from `location.hash` until the script
  has cleared it.

The register stays as written. More code runs on the page that holds a live
credential in its URL, and the fragment rule becomes something to test for
rather than something the CSP guarantees.

### Option C: keep the row

### What was built

`docs/route-register.json` changes as follows. It still round-trips exactly,
and the brief and `briefSha256` are unchanged.

- **New entry.** `rights.withdraw-request` at `/withdraw/request`: kind
  `endpoint`, auth `public`, method `GET`. HEAD is implied by GET, as the gate
  reads it. Its stateProfile is `endpoint`. The page entry's `requestMode`
  sentence moves to it, and it names
  `tokenSecurityContract.urlCredentialInterstitial` as its interstitial
  contract.
- **New response contract.** `rights-interstitial-v1`, bound to the route. It
  gives:
  - the exact headers the route sends, with the CSP's per-response nonce as a
    template;
  - the one-script rule;
  - the candidate cookie on GET only;
  - HEAD with no body and no cookie.
- **Page entry.** `rights.withdraw` pins its segment to `session` alone.
- **Resource authorization.** The `request` branch of `rights.withdraw` moves
  unchanged to the new entry.
- **References.** Five references to `rights.withdraw` with
  `token: const request` now name `rights.withdraw-request`:
  - the `mail-token-delivery-v1` link;
  - the interstitial's `requestTarget` and `historyReplacement`;
  - `platformLogging.requestTarget`;
  - `token-candidate-api-v1`'s `issuedBy`.
- **Headers.** `sensitiveResponseHeaderBindings.tokenPageOrEndpoint` keeps
  covering the literal. The route now sends
  `X-Robots-Tag: noindex, nofollow, noarchive`, which is what that binding
  asks for. Before, it sent `noindex, nofollow`. This is the one code change.

New checks, each planted and seen to fail:

- `src/lib/embryos/rights-entry.test.ts` holds GET and HEAD to every header
  the registered contract names, and to the token-page binding. It fails when
  the robots header is reverted or the binding is removed.
- `scripts/route-register-correspondence.test.ts` now resolves every
  `routeFrom` in the register to a route, and every pinned `params` literal
  to one its `parameterContract` allows. It fails when a contract still names
  the page literal.
- `scripts/route-gate.test.ts` plants `request` back onto the page entry and
  expects the kind divergence again.
- `e2e/a11y.spec.ts` reads its endpoint-rendered pages from the register:
  every endpoint whose success contract is `text/html`.

## 4. The `generated-artifacts` bucket

**Decided 2026-09-28 (evening): option A.** What was built is at the end
of this section. The rest of the section is kept as it was asked.

**What was true when the question was asked.**

- The bucket was created on 2026-08-31 for single-object export archives.
  Those were to be recorded as `public.genome_storage_objects` rows with
  `generated_export_id` set. That table's bucket CHECK still admits
  `generated-artifacts`, and so do the CHECKs on
  `account_deletion_storage_entries` and `embryo_ingest_delete_objects`.
- `20260923123240` keeps that single-object form valid for "existing exports":
  `archive_version` is null and `object_id` is not null.
- Nothing in `src` has ever written the bucket.
- The register never declares it as a prefix. It puts every archive object in
  `exports` (`storage.export-v1`). Its `lifecycleDispositionContracts`
  selectors call the single-object form "the legacy archive handle", and place
  it in bucket `exports`.
- So the schema and the register disagree about where that handle lives. The
  choice is about the handle, not only about an empty bucket.

### Option A, recommended: drop the bucket and retire the single-object form

A migration built like `20260930140000`:

- **Refuses** if `storage.objects`, `storage.s3_multipart_uploads`, or
  `genome_storage_objects` hold anything in `generated-artifacts`.
- **Refuses** if a pending `account_deletion_storage_entries` or
  `embryo_ingest_delete_objects` row names the bucket.
- **Refuses** if any `generated_exports` row has `object_id` set and is not
  terminal.
- **Then** tightens `generated_exports_ready_representation` so that a ready
  row must be `archive-segments-v1`.
- **Finally** deletes the bucket under `storage.allow_delete_query`.

The remaining CHECK literals then go into `allowlistedBucketNotCreated`. The
correspondence test forces that. The drop has to be coordinated with the
exports stream, because `generated_exports` is its table.

Read-only prechecks for production:

```sql
select count(*) from storage.objects where bucket_id = 'generated-artifacts';
select count(*) from public.genome_storage_objects where bucket_id = 'generated-artifacts';
select count(*) from public.generated_exports where object_id is not null;
```

### Option B: declare a prefix

This would declare a filename contract and retention for objects that nothing
writes. It is the mistake the 2026-09-21 G8.5 note warned against for
`genomes-staging`.

### Option C: keep the row

### What was built

`supabase/migrations/20260930140100_drop_generated_artifacts_bucket.sql`
refuses, and rolls back, in seven cases. Each one was planted and refused:

- the bucket holds an object;
- it holds an unfinished multipart upload;
- a `genome_storage_objects` row names the bucket;
- a `genome_storage_objects` row has `generated_export_id` set;
- a `generated_exports` row has `object_id` set, whatever its status;
- a pending `account_deletion_storage_entries` row names the bucket;
- a pending `embryo_ingest_delete_objects` row names the bucket.

A completed deletion entry does not block it. The retirement is two additive
constraints rather than a rewrite of `generated_exports_ready_representation`:

- `generated_exports_single_object_retired`, `check (object_id is null)`. A
  ready row with no `archive_version` still needs `object_id`, so no legacy
  row can become ready. Queued legacy rows stay valid, which the existing
  `export_archive_persistence.sql` assertions rely on.
- `genome_storage_objects_genomes_only`,
  `check (bucket_id = 'genomes' and generated_export_id is null)`. The
  account-deletion builder copies its bucket from these rows, so it can no
  longer produce `generated-artifacts`.

Nothing live reads or writes the bucket. That was checked before the drop:

- `src/`: no reference to the literal. The retention job and the file-deletion
  backstop take their bucket from database rows, and those rows now cannot
  name it.
- Export reader and writer (`src/lib/exports/`): segments in `exports` only.
- Retention: the literal survives only as the retention target id over
  database rows (`purge_target_stores`, five stores, used by the two own-report
  purge functions). That is a different name, and it stays.
- Deletion manifests: the account-deletion and embryo-unwind builders carry no
  `generated-artifacts` literal.

The register is unchanged. Its `lifecycleDispositionContracts` selectors
still say "legacy archive handle if present". That is now never present, so
the wording is true, just unreachable.

Read-only prechecks for production. Each must return 0:

```sql
select count(*) from storage.objects where bucket_id = 'generated-artifacts';
select count(*) from storage.s3_multipart_uploads where bucket_id = 'generated-artifacts';
select count(*) from public.genome_storage_objects where bucket_id = 'generated-artifacts' or generated_export_id is not null;
select count(*) from public.generated_exports where object_id is not null;
select count(*) from public.account_deletion_storage_entries where bucket_id = 'generated-artifacts' and status = 'pending';
select count(*) from public.embryo_ingest_delete_objects where bucket_id = 'generated-artifacts' and state = 'pending';
```

The shared local development database fails the first check. It holds one
leftover `e2e/rls.spec.ts` victim object,
`<account>/rls-generated-artifacts/victim.txt`, from a run before the bucket
list came from the migrations. The drop refuses there, as it should, until
that object is removed.

## 5. The D-081 date

- #118 merged on 2026-09-13 at 13:10 UTC (`e06b0a9c`). From then on the adult
  invitation mail links to `/withdraw/request#<token>`.
- A token mailed before that lives 30 days (`invitation.pending-30d`), so the
  last one expires by 2026-10-13. Both D-081 rows carry
  `deleteAfter: 2026-10-14` (one day of margin), with the basis written next
  to it.
- The new test "deletes a dated divergence by its date" fails after
  2026-10-14 23:59:59 UTC while either row exists. That is deliberate, but it
  means CI goes red for everyone from 2026-10-15 until the deletion lands.
- **To confirm:** the date production received #118. If it deployed later than
  the merge, move both dates by the same amount.

## 6. The upload routes the brief denied (assignment item 2)

This item is already done, and no brief diff is needed. Commit `18234314`
(2026-09-21) corrected the paragraph that the assignment quotes. It is now
line 2196, and it says the route "is in the tree; corrected 21 September
2026".

The same commit registered all three routes under ADR-0016's authority:

- `api.subject-upload-issue`: `POST /api/uploads`;
- `api.subject-upload-complete`: `POST /api/uploads/[id]/complete`;
- `api.file-delete`: `DELETE /api/files/[id]`.

`builtButNotRegistered` fell from 4 to 1, and the remaining entry is
`/api/withdraw`, which is dated above. The phrase "there is no such route" no
longer appears in the brief. The G8.5 row's quote of line 2194 is historical,
and the row's own 2026-09-21 note supersedes it.

## 7. Storage buckets

| Bucket | Created | Declared | State |
|---|---|---|---|
| `genomes` | yes | `storage.subject-v2`, `storage.cohort-v2`, `storage.raw-legacy` | Matches. |
| `exports` | yes (`20260923123240`) | `storage.export-v1` | Matches. Closed before this change; there is no row for it. |
| `genomes-staging` | **dropped** (`20260930140000`) | no | Closed here (section 1). |
| `generated-artifacts` | **dropped** (`20260930140100`) | no | Closed (section 4). |
| `legal-evidence` | no | `storage.legal-evidence-v1` | Unbuilt. |
| `future-person-identity` | no | `storage.future-person-identity-v1` | Unbuilt. |

Notes on the rows above:

- **`legal-evidence`** already has a live call site:
  `drainRefusedInvitationCleanup` calls `remove()` on it. That is recorded in
  `docs/register-contract-divergence.json#liveCallSiteOnUncreatedBucket`, whose
  text now names the two buckets that remain.
- **`genomes-staging`** is still admitted by the CHECK constraints on the two
  manifest tables, because the D-130 builders still carry the literal. The
  ledger row `allowlistedBucketNotCreated` records this. The test fails if the
  bucket is created again, or if the named migration stops dropping it.
- **`generated-artifacts`** is still listed by three column CHECKs written
  before the drop. The added `genome_storage_objects_genomes_only` makes all
  three unreachable. It has its own `allowlistedBucketNotCreated` row.

## 8. What the gates enforce now

All of these only tighten. Each one was checked by planting the regression it
exists to catch and watching it fail.

- **Dropped buckets.** `scripts/storage-buckets.ts` reads bucket drops as well
  as creations, in migration order. `pnpm gate:routes`, the correspondence
  test and the three browser specs that sweep buckets (`e2e/rls.spec.ts`,
  `e2e/file-deletion.spec.ts`, `e2e/account-deletion-purge.spec.ts`) all read
  the set from the migrations instead of a hand-written list. A delete
  statement it cannot parse makes it throw.
- **Evidence on storage rows.** A `created-not-declared` row must name, in
  `createdBy`, a migration that creates the bucket. A `declared-not-created`
  row must name, in `declaredBy`, a prefix over the bucket.
- **Evidence on method rows.** A method row must name the file where the route
  is built.
- **Dated rows.** A row with `deleteAfter` fails after that date.
- **Pending work in the drop.** The `genomes-staging` drop refuses in five
  cases: the bucket holds an object, an unfinished multipart upload, a live
  legacy session, a pending account-deletion entry, or a pending embryo-unwind
  entry. The last two would otherwise stall a deletion when `remove()` hits a
  missing bucket. Each refusal was planted and seen. A completed entry does
  not block the drop.
