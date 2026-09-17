# Family ancestry release verification — 17 September 2026

Status: released. PR #128 (`Read shared ancestry through current Family
permissions`) merged to `main` as `6588ca2d509ce3231178c5aab1901afad83210d9`
after its migration was applied to the Inherit Supabase project and a
rollback-only production probe passed. Production deployment
`dpl_JBJLAveM91qXaYNDRB2fvBtj8EE4` is READY on `www.inherit.bio` and
`inherit.bio` at that commit. This record fixes D-123. It closes no
acceptance gate, and the limits at the end are part of the record.

## Identities

| Item | Value |
| --- | --- |
| PR head | `12807a9aac9c2012319945625811f83a62caf141` (branch `codex/family-ancestry-authority`, preserved) |
| Merge commit | `6588ca2d509ce3231178c5aab1901afad83210d9`, parents `6a8612b` and `12807a9` |
| Tree | `7aec4a036b126d34976efe1f50b8f6c6d2cf9f04`: equal to the PR head tree and to the tree CI tested, because `main` before the merge (`7d7d0ef8…`) equalled the CI merge base tree |
| Migration file | `supabase/migrations/20260915120846_family_ancestry_shared_authority.sql`, SHA256 `5a4de2062fd9c5979ee292bc7d8084db89a38a77619b379968a1118d149e8e6b`, 34,237 bytes |
| Hosted ledger row | name `family_ancestry_shared_authority`, version `20260917180516` (the hosted runner stamps application time; names are the identity) |
| Supabase project | `zuvloczwgrayonqabnss`, Postgres 17.6; executed as `postgres` (bypassrls, not superuser) through the management SQL API |
| Vercel | project `prj_K7bVowhjFr0uIapXraH41hthJkgy`, team `team_XInx0PxxHVKb2DXdL3asLX8R`, region `iad1` |

## Continuous integration

`ci-evidence.json` records the exact-head run [34981687918](https://github.com/themariodiego/Inherit.bio/actions/runs/34981687918):
306 unit files with 5,097 tests and no skips; 82 pgTAP files with 3,151
assertions including `family_ancestry_shared_authority.sql`; 424 browser cases
passed with no skips and no retries, including the synthetic Family ancestry
journey in `e2e/family-ancestry.spec.ts`; no `not ok` line anywhere in the log.
The job checked out the merge of `12807a9` into `6a4c751`, whose tree is the
tree that now sits on `main`. The post-merge run on `main`,
[35258394909](https://github.com/themariodiego/Inherit.bio/actions/runs/35258394909)
at `6588ca2`, completed 19:04 UTC with the same totals: 306 unit files with
5,097 tests, 82 pgTAP files with 3,151 assertions, 424 browser cases passed
with no skips and no retries, 89 provider uploads and no `not ok` line. Its
figures are recorded in the same file from its downloaded job log.

## Database release, in order

1. **Read-only catalog preflight** (`catalog-preflight.json`, 17:54 UTC). The
   ledger held 112 names ending in `own_upload_finalization_fenced_recovery`
   and lacked the Family name; none of the 13 functions, the private table or
   the three triggers existed; every prerequisite table, column, function
   (with owner, security mode and search path), role, enum value, constraint
   and enabled event trigger was present as the migration expects. Production
   held three ancestry purpose grants and **zero** current subject-to-recipient
   ancestry directions, so no existing customer is forced into a fresh
   confirmation by this release.
2. **DDL guard** (`ddl-guard.sql`, SHA256
   `29a60cc8d80ab89b65e93a6fc30b0260e77ab26b452117107bed3608a45d2e84`) re-checked
   all of that immediately before application and raised on any difference. It
   passed at 18:00:45 UTC.
3. **Transcription check.** The migration text pasted into the management API
   was hashed on the server before application: MD5
   `6aabaa66e1d31b4d128b39848ed516ed`, identical to the repository file.
4. **Application** through the migration API under the repository name at
   18:05 UTC.
5. **Postflight** (`postflight.json`). All 13 function bodies match the
   file byte for byte (`expected-prosrc.json` holds the per-function MD5s
   computed from the file); owners are `postgres`; the four public wrappers and
   their private counterparts are executable by `service_role` only; the five
   internal helpers and the trigger function are executable by no application
   role; the private table has row security enabled, a cascading foreign key to
   `public.purpose_grants`, the exact 390-character comment and no privilege for
   any application role; the three triggers are enabled with the expected
   definitions. The name-based drift comparison found 113 applied names equal
   to the 112 repository migrations plus the one recorded operator migration
   (C-collation MD5 `a662037098df1965157e6e7bf5892df5` on both sides).
6. **Advisors.** No error-level finding. The security advisor shows the same
   two pre-existing warnings and one more informational `rls_enabled_no_policy`
   row for the new private table; the performance advisor is identical to the
   15 September baseline.

## Production probe

`probe.sql` (SHA256
`e038584562cb0a0fcbd8aa197757e1cf404b7d9e117868cbb84e85bce17b1906`) is the
executable Family write probe the earlier packet lacked. It follows the reviewed
ancestry and recovery pattern: fresh random synthetic identities, the actual
consent, normalization and report-generation writers, bounded timeouts, a
single inner block that always ends by raising a sentinel so every write is
discarded, and an explicit residue check across 22 fixture-keyed tables before
the sanitized receipt returns. Any failed check raises instead of returning.

`probe-receipt.json`: **93 of 93 checks passed** in 671 ms inside the
discarded transaction, mirroring the pgTAP suite one for one: current sharing,
canonical v3 and legacy reads, fresh affirmative confirmation replacing an old
grant, nonce replay refusal, owner and recipient session loss, owner-purpose and
directional withdrawal, pause, source drift, completed-result immutability,
historical v1 and v2 captures through the real withdrawal/regrant/generation
lifecycle, stale recipient binding, an unrelated recipient, an invalid mode,
exact statement keys, prepared-source refusal, 100-file pagination with a
locked cursor-chain confirmation, operational-proof preservation across
no-op writes and pause/resume, proof removal on revocation, base and direction
revision changes, the three terminal direction states, parent and direction
deletion with the sibling direction preserved byte for byte, every real file
status with a stale legacy result present, and exact restoration of the whole
page after every nested rollback. Residue after rollback was zero everywhere;
no mail row was created; the one worker row (the revoke purge job) and five
legal-audit rows existed only inside the discarded transaction, and the
audit chain showed zero rows beyond its starting sequence afterwards.

## Deployment and public verification

The Vercel deployment for the merge commit built in 36 seconds and became
READY at 18:22:49 UTC with the production aliases assigned. `production-public/
receipt.json` records real Chromium 141 checks (script in `check.mjs`) at
desktop 1280×800 and phone 390×844 against `https://www.inherit.bio`:

| Route | Result |
| --- | --- |
| `/`, `/privacy`, `/about`, `/family`, `/auth/sign-in` | 200, expected heading, no horizontal overflow, no console or page error |
| `/genome/me/ancestry`, `/family/invite`, `/family/permissions` | 200 after redirect to `/auth/sign-in?next=…`, no overflow, no error |

The only failed subresource requests were same-origin Next.js prefetches
cancelled when each page closed (`net::ERR_ABORTED`); no third-party host was
contacted. The runtime error aggregator for the project was empty for the
preceding two hours, and the deployment's logs in the 30 minutes around the
checks held no error, warning or fatal entry and only 200 and 307 responses.

## Hosted lifecycle state after the release (aggregate, read-only, 18:38 UTC)

Counts only, no identities: 7 accounts; 4 genome files (2 `stored`, 2
`annotated`), 2 single-sample verified and normalized; 1 completed own
analysis run each for ancestry, monogenic and polygenic; 0 finalization
attempts under the fenced recovery table; 0 preparation jobs and 0 prepared
manifests; `private.own_preparation_config` disabled with provider `supabase`
and no R2 bucket; `private.own_original_retention_config` enabled since
2026-09-13 with 0 retirements registered; mail outbox 11 delivered. The
Cloudflare account holds no `inherit-prepared-*` bucket and no Inherit worker,
so the prepared-object backend and a hosted preparation executor remain
unactivated and need infrastructure, credentials and an owner decision before
the single-sample VCF journey can be proven end to end in production.

## Observations for the owner

- The production deployment carries the aliases `sequence.plus.bio` and
  `sequence-murex.vercel.app` alongside the Inherit domains. They come from
  project configuration, were not changed by this release, and are worth
  reviewing against the requirement that Inherit stays separate from Plus Bio.
- The hosted `postgres` role is not a superuser but bypasses row security;
  every probe write relied on that, exactly as the earlier probes did.

## Limits

- No authenticated production journey was exercised. The Family ancestry
  browser evidence is the CI run; the production browser checks are public
  and anonymous.
- No provider bytes were uploaded, read or deleted; the probe's storage row was
  synthetic metadata only. No Auth API sign-up or email delivery occurred.
- Time-only grant expiry still denies reads without removing operational
  snapshot proof; only terminal or revision transitions and parent deletion
  remove it. Ancestry from a prepared genome remains explicitly unavailable in
  Family. Broader Family graph export and deletion gaps remain open on their
  own records.
- An empty runtime error scan is not upload-health proof; hosted provider
  transfer, throughput, background dispatch and monthly capacity remain
  unproved (D-124).
