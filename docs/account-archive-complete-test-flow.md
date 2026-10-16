# Complete account archive: controlled TEST qualification

This is authored source, not an executed provider or browser result. Ordinary
`approvedAccountArchiveGeneration()` remains null. No production configuration,
jurisdiction review, source consent or acceptance row is changed by this flow.

Root must admit a fresh controlled TEST fixture with the same native database,
actual application, existing source readers and private gateway. The standard
closed browser servers have no qualified private account-archive R2 binding.
The prior assembly-only evidence does not supply that missing binding.

Required setup, without values:

- The exact source and native migration must be installed and pinned by Root.
- The actual account/profile jurisdiction is TEST and
  `INHERIT_TEST_JURISDICTION=1`, `INHERIT_TEST_ACCOUNT_ARCHIVE_R2=1` and the
  existing gateway's `INHERIT_TEST_REQUESTER_STATEMENTS=1` are explicit.
- Root supplies the actual `INHERIT_TEST_ACCOUNT_ARCHIVE_R2_DATABASE` and,
  where required, `INHERIT_TEST_ACCOUNT_ARCHIVE_R2_DATABASE_CA_CERT`. The owner
  connection retains its original TLS/role/single-connection and finite limits.
- Root supplies the existing private gateway configuration variables
  `INHERIT_TEST_STATEMENT_GATEWAY_URL`, `INHERIT_TEST_STATEMENT_GATEWAY_KEY`,
  `INHERIT_TEST_STATEMENT_R2_BUCKET` and `INHERIT_TEST_STATEMENT_R2_BINDING_SHA256`.
  No value or provider origin belongs in repository source or public receipts.
- The real native singleton's enabled/bucket/binding configuration must match
  that actual private service. Only Root enables it. Default configuration is
  OFF; a mismatch refuses before due discovery or object allocation.
- The actual app's selected `JOBS_SECRET` or `CRON_SECRET` is supplied at call
  time only. No fixed hosted fallback is used by the controlled journey.
- The read-only admission requires zero prior account archive jobs, live
  account download sessions and undisposed allocations. It does not reset,
  adopt or erase an earlier obligation.

The caller creates real Auth/session, uploads, reports and consent through the
existing genuine flows before invoking
`exerciseCompleteAccountArchiveDelivery` in
`e2e/helpers/account-archive-complete-journey.ts`. Its file-picker sink observes
the actual verified browser writes only; native/source/provider/HTTP remain
real. The helper uses Prepare, the real authenticated generation worker,
status polling, a fresh SSR open action, and Save. It compares the full ZIP,
manifest, all selected subject base members, actual original bytes, separate
raw-authorized CSV members, complete native receipt/dispositions and final
download sequence ACK. It retains a hash of the entire immutable allocation
bag without returning provider keys or credentials. All counts and authority
must come from native capture, not caller-supplied empty records.

The fixed operator HTTP door is `POST /api/jobs/account-export`, with an empty
body, no query, the current job bearer, and the single operation header
`X-Inherit-Account-Export-Operation: generation` or `disposal`. It returns an
empty 204 only after the selected actual worker naturally completes; private
failures return a fixed refusal. An uncertain response is not retried.

The existing public one-shot worker entry points are also retained:

```
node --conditions=react-server --import ./scripts/server-only-shim.mjs --import tsx scripts/account-export-worker.run.mts --test-r2-once
node --conditions=react-server --import ./scripts/server-only-shim.mjs --import tsx scripts/account-export-disposal.run.mts --test-r2-once
```

Delivery ACK does not expire or dispose the archive. After the actual original
expiry/lease predicate becomes due, the unchanged cleanup `stop` transition
must naturally commit and its real `cleanup_not_before` fence must pass. All
allocations also retain their original deadline plus 30 seconds. These clocks
are neither shortened nor backdated. A successful stop-only worker pass is a
separate transition, not proof that physical deletion happened.

Only then invoke `exerciseCompleteAccountArchiveDisposal`. It refuses a live
or unstopped attempt before its worker call. After one natural disposal call,
it requires the same complete immutable allocation bag, every actual native
physical-absence ACK and every segment delete acknowledgement. The actual
worker retains the all-writer terminal fence, verified payload/empty-marker
EOF, conditional current-object deletion and two absence checks. Provider
history and platform-copy erasure remain separately qualified policy; current
object absence cannot be relabelled as whole-provider erasure.

Other subjects' raw rows remain excluded without their complete separate
recipient-bound raw-export authority. Embryo analysis consent alone never
authorizes parent raw or uncovered report export. Exclusions retain actual
source counts and explicit reasons, including the consent-covered base-member
and history inventory; they are not fake empty sources. Production delivery
and G5.6 completion require the remaining genuine native/provider/browser,
expiry, disposal and independent-subject-route proofs.
