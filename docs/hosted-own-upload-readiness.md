# Hosted own-upload rollout prerequisites

Read-only checkpoint, 6 September 2026. This is not a rollout receipt. The
new upload/report work is local; production remains the independently released
PR73 at `a6b68a9d79e2901d9665cc2a4b5a4bcb58c489bc`.

## Verified scope

- Inherit Supabase project: `zuvloczwgrayonqabnss`, reported ACTIVE_HEALTHY.
- Vercel project: `prj_K7bVowhjFr0uIapXraH41hthJkgy`, team slug `mariodiego`.
- Production PR73 deployment: `dpl_8J7MvprofssBdKKqGJvdVcPjQ2cz`, READY,
  with `www.inherit.bio` assigned.
- The scoped hosted database audit found no `upload_authorization_config`,
  `own_normalization_runs` or `own_analysis_runs` yet. It found neither
  `pg_cron` nor `pg_net` installed. The genomes bucket is private; its
  bucket-specific size and MIME limits are null.
- Public Auth JWKS advertises an ES256 key. Advertisement does not show that
  the application possesses its private key or can mint a trusted upload JWT.
- Vercel environment-name/target inventory was not completed in this audit.
  No secret value was fetched, printed, rotated or changed.
- Hosted Edge Functions `bootstrap`, `seed-reference` and `prs-backfill` are
  ACTIVE with `verify_jwt: true`. Their deployed versions 5, 4 and 2 are
  unconditional HTTP 410 tombstones: no request processing, credentials or
  database/storage access. No callers were found in current `src` or `scripts`;
  this does not prove they have no external callers. Leave them unchanged.
  The specific [function authentication guide](https://supabase.com/docs/guides/functions/auth-headers)
  supports asymmetric keys, whereas the general signing-key guide retains a
  compatibility warning. No live function invocation was performed or needed
  to establish that these retired handlers contain no active workflow.

## Owner authorization and access checkpoint

On 6 September 2026 the owner explicitly approved controlled signing-key
import and activation, retaining the existing key and testing synthetic
uploads first. This is authorization, not evidence of execution. No key has
been generated, imported, activated or revoked at this checkpoint.

The connected Supabase tools expose database and Edge Function operations,
but no signing-key management operation. The owner completed GitHub login in
Brave. The authenticated Inherit JWT dashboard confirms current ES256 key
`1591c25b-673c-45f3-b60d-f20bfd5c59bb`, previous legacy key
`1cc85c83-b89b-437d-87ad-4cc1de0c9daf`, and no standby key. The import form was
opened with ES256 selected; no private material was entered or submitted.
Browser credential changes require owner completion of entry and submission.

Neither `SUPABASE_ACCESS_TOKEN` nor `VERCEL_TOKEN` is set in the current shell.
The existing Supabase CLI can list projects through its saved authentication,
but its inspected commands expose no JWT signing-key import operation.
Vercel's environment-settings dashboard is signed out. Do not extract browser
or connector session credentials; use a supported management interface or an
owner-assisted dashboard handoff. Never ask the owner to paste private signing
material in chat. Establish production-only secret storage before creating a key.

The owner subsequently signed into Vercel. Its environment list has no
`INHERIT_UPLOAD_SIGNING_JWK`. The new-variable form is prepared with that name,
Secret type and Production only, with an empty value and no save submission.
Existing values were not revealed. Both credential forms await owner entry;
first import as standby and save the identical key securely, then verify the
public key identifier before activation. Do not redeploy merely to save a key.

The owner explicitly requires no spending: no new paid resources, upgrades or
paid add-ons. Prefer existing resources and free limits, including Cloudflare
where appropriate. This checkpoint provisions no service and initiates no
deployment. Any usage-bearing canary or scheduler requires a verified bounded
cost plan rather than assuming the provider is free.

## Hosted trust is not the local harness

The local browser harness gives an isolated instance of the actual Storage
provider an extra ephemeral public key. It does not alter project Auth keys,
and proves provider authorization/real stored bytes locally. Hosted Supabase
does not thereby acquire that key or the same configuration facility.

The official [signing-key guide](https://supabase.com/docs/guides/auth/signing-keys)
documents importing a privately held key and rotating it into use. Existing
keys remain usable until separately revoked. It does not promise that merely
publishing a new standby key enables every hosted service to trust arbitrary
new tokens. The guide also distinguishes the API key header from the custom
JWT Authorization header. Validate the exact hosted Storage request, including
gateway headers, rather than inferring success from the isolated provider.

An imported project signing key is privileged: it can sign other project roles,
not only upload-role claims. The application constrains emitted claims, but
key custody must receive the same care as other privileged server credentials.
Do not export an existing Supabase-managed private key; the documented design
does not allow that. Do not put a private key in browser configuration, chat,
source control, build artifacts or verification traces.

## Ordered release work

1. Finish local integrated regression and review the additive migrations,
   including account/source/grant transitions and exact-purpose cleanup.
2. Establish the production signing-key custody and rotation plan, with an
   explicit rollback path and no revocation of currently valid keys. Verify
   any existing verifier/Edge Function compatibility before activation.
3. Apply the reviewed hosted schema and bounded capacity settings in a staged
   rollout. Check effective ACLs, RLS and database advisors; never copy the
   local test-jurisdiction flag into production.
4. With a synthetic canary only, prove the exact issuer/audience/role token
   through hosted Storage: the permitted create succeeds; overwrite, read,
   foreign object, extra capability, expired/revoked consent and finalized
   nonce requests fail. Confirm the original bytes and cleanup independently.
5. Provision and verify recurring retention execution. Vercel cron invokes
   GET; the registered retention handler is bodyless POST. Do not silently
   change its method contract or assume adding its path to vercel.json works.
   Use a reviewed authenticated POST-capable scheduler/adapter and prove
   stalled/expired cleanup, not merely scheduler configuration.
6. Verify the production browser journey and existing file controls before
   calling the own-file milestone delivered. Ancestry, other-adult uploads,
   embryo workflows and broader full-plan gates remain separate work.

No production schema, credentials, scheduler, real account or real genomic
record was changed during this audit.
