# Hosted own-upload rollout prerequisites

Rollout preparation checkpoint, 6 September 2026. This is not a rollout receipt. The
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
- Vercel's signed-in list was subsequently inspected without revealing values.
  The owner created the Production-only signing secret; its stored value is
  write-only and has not been read back or verified by a deployment.
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
uploads first. The initial preparation below was followed by owner-executed
replacement-key generation, Vercel saving and Supabase standby import. No
activation, revocation or deployment has occurred in this setup sequence.

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

### Latest verified owner-completed state

The owner generated a replacement after the first new private key appeared
in a chat screenshot. Never reuse that exposed key or reproduce its material.
The owner reports saving the replacement in Vercel and creating its Supabase
standby entry. The authenticated dashboard and public JWKS now show replacement
`d5e4e50d-7017-4c8f-9435-22c07b5234a9` alongside the unchanged current ES256 key.
The dashboard still labels the replacement **Standby** and retains the original
legacy key. The exposed key is not among the dashboard's listed current,
standby or previous entries, nor the fetched public JWKS.

This verifies public registration, not possession of the same private key in
Vercel or successful hosted upload authorization. Do not infer either from
the write-only editor appearing blank: Vercel's save-success notification
confirms the write, while stored secret contents cannot be revealed in Edit.

The browser upload now sends the existing public project key in `apikey`,
separately from its restricted upload bearer in `Authorization`. Missing or
malformed public-key configuration is refused before lease issuance. No
server credential or ordinary user-session token is substituted. This follows
the signing-key guide's gateway requirement; a read-only unauthenticated GET
to an invented object returned a bucket refusal and was **not** treated as
proof that a real hosted upload works. Positive hosted authorization remains
unverified until the ordered synthetic canary is possible.

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

### 6 September follow-up: compatibility and bounded cost preflight

Read-only live checks still identify PR73 as production, no open PR at the
start of the batch, and no hosted own-upload migrations. The local ref had a
single-branch fetch configuration; `origin/main` was explicitly refreshed to
the GitHub-confirmed PR73 commit before reviewing the release base.

The migrations are **not all additive**. `20260906133807` drops the ordinary
session staging policy used by PR73; both legacy upload API aliases also have
new incompatible contracts. Stage reviewed compatible schema separately,
then coordinate the transport policy and app cutover, including old tabs and
in-flight uploads. A Vercel-only rollback is not a complete recovery plan.
The consent-language migration also requires its transaction-held lock and
exact prerequisite artifact hashes; never apply its statements piecemeal.

Authenticated usage dashboards were read without changing settings. Both
accounts are already Pro. Vercel showed $1.71 of $20 included credit consumed
and $0 on-demand charges. Supabase showed 1.042/100 GB average Storage,
0.926/250 GB egress, 1.204/250 GB cached egress, 4,920/2,000,000 Edge Function
invocations and 111/100,000 MAU, with no quota exceeded and overage billing
disabled. Inherit has an existing 8 GB disk. These are a time-bound usage
snapshot, not permission to add resources or a production-wide capacity cap.
Existing compute/subscription charges are not caused or changed by this work.

For the isolated Overview release, bound hosted work to one preview and one
production build, with local preflight and ordinary page verification only.
The public repository uses standard `ubuntu-latest` CI. Recheck allowances if
the scope expands or a further hosted attempt is needed. No external model,
new scheduler, paid add-on, plan upgrade or bulk processing is part of this
release. An own-upload hosted canary still needs a separately bounded plan.

The retention POST is a composite executor: it also processes due invitations,
embryo expiry/notices and account purges. Before any hosted canary invocation,
read only the due-work counts and establish its full scope. Do not describe a
call to this handler as synthetic-only merely because its intended fixture is
synthetic. Existing working keys and real genomic records remain untouched.

### Remaining ordered rollout

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
