# Standard upload grant transport binding

The restricted browser grant is issued for one ordinary Storage object create.
The isolated preview's empty-upload probe showed it could also create a TUS
upload, whose offset and declared length were readable with a public bearer and
the provider URL. The source bytes sent by that probe were zero.

This change binds `genomes_upload_token_create_only` to the exact trusted
`storage.object.upload` operation. It retains the existing bucket, staging key,
declared-size and live account/session/subject/consent predicates. A missing
operation, a client metadata/header assertion or another protocol cannot select
the standard path. No new transport is enabled.

Storage sets `storage.operation` from the matched server route, through its
request database scope. This is distinct from a browser-provided header. The
source chain reviewed at revision
`0e7910fc85e974d494230015eee7cfa9d9b4d38d` is:

- [Route operation definitions](https://github.com/supabase/storage/blob/0e7910fc85e974d494230015eee7cfa9d9b4d38d/src/http/routes/operations.ts).
- [Server route selection](https://github.com/supabase/storage/blob/0e7910fc85e974d494230015eee7cfa9d9b4d38d/src/http/plugins/log-request.ts#L112).
- [Database request scope](https://github.com/supabase/storage/blob/0e7910fc85e974d494230015eee7cfa9d9b4d38d/src/internal/database/postgres/scope.ts#L21).

Read-only preview SQL on 22 September confirmed that its `storage.operation()`
helper reads this same transaction-local setting. That query did not establish
the deployed Storage application revision or prove HTTP propagation. The latter
requires the installed-provider integration test and a preview check before any
hosted rollout. Missing propagation deliberately refuses the upload; it is not
a reason to allow an unspecified operation.

The service-role completed-object trigger is unchanged. It still requires the
exact completed size, owner and current authority, and atomically consumes the
session. Its existing tests now also run with the operation setting absent.
Finalization, Storage cleanup, retention deadlines and file/preparation limits
are unchanged.

The pgTAP authority suite adds refused provider operations, including TUS, S3,
signed upload, update, missing operation and spoofed headers. It retains its
standard-create, consumption, revocation and elevated completion cases. The new
browser regression issues a real grant after the consent screens, attacks TUS
creation and upsert, then uses that same grant for standard storage and exact
byte finalization through the installed provider. The existing complete UI
upload journey remains in the full suite.

Local validation: 159 targeted tests passed across token signing, issuance,
finalization and retention cleanup. Changed-file lint and TypeScript passed.
Playwright discovered the new provider regression and the existing positive
upload journey. Discovery is not browser execution. pgTAP and provider execution
remain pending CI; Docker was unavailable locally and no stack was started.

This restriction prevents new upload-role permission probes for TUS. It does
not repair the provider's known-URL HEAD authorization, inventory old TUS
fragments or prove physical deletion. Those remain separate prerequisites for
any resumable implementation. No hosted migration or provider write was made
while preparing this change.
