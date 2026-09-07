# Hosted own-upload rollout prerequisites

Rollout preparation checkpoint, 7 September 2026. This is not a feature-release receipt.
The new upload/report runtime is verified in a protected hosted canary; production is the independently released
PR75 at `a7d5a8e6ac827beb2db464e4dbe34b2bfed8507b`, with its pause off.

## Current local prerequisites · 7 September 2026

The protected hosted canary remains `9ffb68a` (unchanged `8166c3b` runtime),
with the successful hosted source/report/withdrawal evidence recorded below.
The new export, revocation executor and ready-notice runtime is still local.
At `6e9acd6`, all **69 selected browser cases pass together**, with no
skips/retries and 33 actual provider uploads; see
[the local receipt](local-upload-browser-verification.md). Runtime `6c25379`
passes 2,702 units and typecheck. Full CI remains incomplete.

A fresh isolated cluster replayed all **68 migrations** at `6c25379`, with
exact lexical history and file hashes verified. Eleven rollback-only fixtures
pass **299/299 assertions**, including 67 canonical notice checks and the
existing export, generation, revocation, mail and deletion contracts. Successful
isolated projects were removed; earlier failures remain retained. This supersedes
the previous 67-migration / 124-assertion checkpoint. The corrected new notice
migration SHA-256 is `875c9e94b549783d72658905cc92b95ec90d16b51f06ac358e051741d7a4cbfa`.

Fresh replay exposed a packaging defect in
`20260906135854_own_report_layer_language.sql`: its table lock depended on
an outer transaction. One DO statement now wraps the same SQL operations and
unchanged consent bodies/hashes. Hosted staging already applied those operations
transactionally; **do not reapply that migration** to the existing hosted
project or rewrite its history. Earlier staged-body comparisons remain dated
evidence for the original file. Test fixtures now declare their bounded upload
configuration and synthetic template/PGS references inside rollback transactions
instead of depending on the older local database's seed. All initial failures
are retained in the task receipts.

The three executor/export/notice migrations are now staged and independently
verified hosted. Assigned history versions are `20260907072516`,
`20260907072527` and `20260907072542`, respectively. Exact canonical file
bytes match after removing the recorded BEGIN / 5-second lock timeout /
60-second statement timeout / COMMIT wrapper. All 30 function bodies, owners
and execution privileges, five columns, seven enabled triggers and the phase
registry match. Client roles retain no new execution or table access. The
legacy staging policy remains and the incompatible cutover is still absent.
No report generation, retention worker or provider call was performed.

Current Vercel cycle usage at `2026-09-07T07:10:26Z` is about $1.72 against
$20 included credit, with billed usage rounding to $0.00. This establishes
headroom for one bounded candidate build, not an enforced spending cap.
The stable alias `inherit-env-own-upload-canary-mariodiego.vercel.app` still
targets `dpl_9W634MRCEadvBBvoB4tHg5KhEU5p` at the 07:20 UTC read. A replacement
must set `NEXT_PUBLIC_SITE_URL` to that protected alias at build and runtime.
Public aliases and scheduled jobs remain PR75; acceptance stays **18/65**.

### Shared mail-worker transition

PR75 and this candidate have identical mail-worker, sender, crypto and
report-ready template code. The new migration retains claim/pre-submit RPC
signatures and legacy eligibility while adding canonical checks. The live
minute cron can therefore consume and decrypt newly queued canonical notices.
Excluding mail credentials from preview does **not** isolate that shared outbox.
Successful chosen-report completion or completed-work replay may trigger mail;
source-only preparation does not.

Before hosted generation, obtain explicit delivery authorization for a designated
owner-controlled synthetic recipient, or establish a separately reviewed hold on
all mail invocations including in-flight work. A post-enqueue cleanup races the
worker and is insufficient. No hold, provider call or delivery has been performed.
On application rollback retain the additive database migration and its contact,
readiness and submission guards; application rollback alone does not stop queued
delivery. Compatible staging and source-only canary checks can proceed without
claiming notification delivery or changing production scheduling.

## Previous staging checkpoint · 18:35 UTC, 6 September 2026

The owner completed signing-key activation. The authenticated dashboard labels
replacement `d5e4e50d-7017-4c8f-9435-22c07b5234a9` Current and both older keys
Previous. No revocation or private-key retrieval was performed. Vercel confirms
the signing variable exists as a sensitive Production-only variable; its value
was not inspected. Successful hosted token minting and actual Storage acceptance
remain unverified.

All twelve compatible own-upload migrations were applied sequentially through
Supabase migration operations, each with an explicit transaction and 5-second
lock timeout. Independent poststage verification matched each complete SQL body
to the local file, checked the current v2 consent artifact hashes and enabled
immutability trigger, and confirmed all 23 public RPCs are service-only. The
four new private tables have RLS and deny ordinary-user table privileges.
The upload role retains only the intended Storage insertion capability.

The incompatible `20260906133807_cutover_subject_upload_transport.sql` remains
unapplied: the existing legacy staging policy is preserved. Configuration rows,
canonical leases/source markers, normalization rows and analysis rows are all
zero. No real genetic file was changed. Security advisor reports zero errors;
its existing definer and leaked-password-protection warnings remain open.

Vercel Standard Protection is enabled for all deployment URLs except custom
domains. The public custom domain still returns HTTP 200; the generated URL
requires Vercel authentication. A detached canary checkout at `8166c3b` passed
a deployment-file dry run: 1,058 tracked files, 19,349,767 bytes, with no actual
credential files. No canary has yet been deployed. Existing active cron targets
still point to PR75. Scheduler isolation, explicit upload capacity, a fresh
synthetic account and the real hosted journey are the next ordered checks.

Existing Vercel included usage was rechecked at $1.71/$20, with $0 on-demand.
The next authorized hosted batch is one protected candidate build and two tiny
synthetic uploads, with bounded HTTP checks and no external model calls,
background-worker invocation, new resources or plan changes.

The following older checkpoints are retained as historical evidence; this
section supersedes their pending-activation and unstaged-schema statements.

### Protected canary preparation · 18:48 UTC

The included first custom environment `own-upload-canary` was created with
Vercel type `preview`, no branch matcher and no public domain. Five necessary
existing variables are shared internally by environment ID: Supabase URL,
public key and service role, BYOK encryption key, and upload signer. Their
Production targets remain intact. No values were retrieved. Worker and email
credentials were excluded; deployment-only worker secrets are explicitly empty.
This avoids the unproven cron behavior of a production `--skip-domain` deploy.

Temporary canonical capacity is now configured and read back: 64 KiB per array
or VCF, 256 KiB per account, two active uploads, exact hosted Auth issuer.
These are tiny protected-canary limits, not public file-size commitments.
The configuration is global to canonical issuance, whose public wrappers are
service-only; PR75 does not consult it. Current provider-wide Storage size
configuration is not independently confirmed; the two canary fixtures total
972 bytes and actual provider acceptance is still required.

First deployment `dpl_FXTojShhFADjYjbRKV3PYcAZFhcA` was BLOCKED before building
because the local commit author's machine-only email is not GitHub-attributed.
Its source remains `8166c3b`. The follow-up documentation commit uses the
existing owner's verified GitHub email without rewriting historical authorship
or changing runtime source. The protected custom environment and all three
active production cron definitions were checked; crons still target PR75.

Synthetic Auth Admin setup through the existing Supabase CLI did not return
within bounded attempts; both processes were stopped before account creation.
No user list, existing account update, consent seed or private signing-key
retrieval occurred. A supported alternative credential path for the actual
new-account operation is being checked; no hosted genetic upload has run.

### First real hosted browser journey · 18:53 UTC

The follow-up candidate `dpl_9W634MRCEadvBBvoB4tHg5KhEU5p` is READY at
`9ffb68a1a9b79e093d986e1e054449fcf9095f9c`; its only changes from the locally
verified `8166c3b` runtime are the two rollout documents. Public aliases and all
three cron definitions independently remain on PR75. Both candidate URLs still
require Vercel authentication. No second build was consumed by the earlier
BLOCKED author-attribution attempt.

A legitimate Auth Admin create operation made exactly one fresh, confirmed
synthetic account, with no consent or result seeding. The fallback retrieved
only the named existing Supabase service credential through Vercel's supported
API for immediate server-side Auth Admin use, kept it in memory, and validated
its project and role. The upload signing private key was never retrieved.
The independent baseline found one profile/subject and zero files, leases,
consents or signatures for the new account.

A fresh browser used a temporary candidate-specific Vercel share URL to install
a secure host-only cookie, then the app's normal password sign-in. It checked
the actual confirmed account identity before making fictional adult declarations
and signing disclosure/store consent through the UI. No trace, HAR, session
export or injected credential headers were used. Independent review corrected
a redirect-prone test-header approach before its first execution.

The single run, 18:52:40–18:53:23 UTC, passed two real uploads totaling 972 bytes:
exact browser hashes, restricted Storage bearers, provider HTTP 200, bodyless
finalization, normalization, explicit trait-report permission and real personal
findings with public sources and honest missing coverage. Grant alone exposed
no findings. The two conflicting files produced the expected disagreement.
Both downloaded byte-for-byte through native app/Storage redirects; deleting
only the second source returned 204 and preserved the first download/report.
PDF and multiple-sample files were refused before issuance/Storage. There were
no browser errors or global-worker, invitation or outside-model requests.

Desktop/mobile screenshots were inspected: controls fit, report coverage and
source facts remain distinguishable. Generic file names and sub-kilobyte sizes
rounded to 0 KB remain usability limitations. The active retained synthetic
source was preserved for independent journal/Storage checks, which passed:
correct 425-byte raw/decoded hash, revision 1, complete normalization, five
source variants and five usable observed calls, current polygenic grant and
completed source/grant-bound analysis. The deleted file and all checked derived
rows/journals are absent; both staging objects and its final object are absent.
The retained final object matches its canonical file/object bindings. No
unchosen grants, ancestry results, workers or mail were created. Provider
owner_id on the service-copied final is null; ownership comes from the checked
canonical bindings. Authorization refusals and purpose withdrawal are next.
This is a protected hosted canary, not a public cutover or a full acceptance gate.

### Restricted-token refusals and withdrawal · 19:11 UTC

A bounded follow-up used a genuine new token signed with public kid
`d5e4e50d-7017-4c8f-9435-22c07b5234a9`. Eight actual Storage operations returned
HTTP 400 envelopes containing explicit provider 403 authorization denials:
wrong bucket/key creation, reading the existing retained synthetic object,
listing its prefix, updating/deleting the new absent key, upsert at that key,
and a real body one byte over the token's exact maximum. Independent SQL then
confirmed the lease remained issued/unconsumed, all new target objects were
absent, and the retained source/object/grant were unchanged. After this explicit
checkpoint, the **same token** accepted the exact 547-byte source, which really
finalized, prepared, downloaded and was deleted through the application.

The first attempt's 60-second acknowledgement timeout is preserved as a setup
failure, not a product failure or a complete token test. Its eight denials had
no same-token positive control. The corrected run retained every assertion,
used a 180-second explicit-ack deadline and promptly executed the lead's separate
SQL verification before acknowledging. Neither timeout grants permission to
continue. The second run passed from 19:10:43 to 19:11:20 UTC.

The previously verified live trait-report permission was then withdrawn through
the real UI. Direct authenticated Data API reads for the retained file changed
from three PRS coverage rows to zero; ancestry remained empty. Fresh report
responses omitted personal results. Exact original download and source A/G
remained available under live store consent. A focused read-only browser check
also waited for the regional API/IGV track to finish and inspected the rendered
region, rather than treating the earlier loading screenshot as complete proof.

Independent final checks confirmed the third file, its derivatives, journals,
staging and final objects are absent. The retained 425-byte source, raw and
normalization bindings, five variants and five observed calls remain intact.
The report grant and direction are revoked, with no remaining PRS/analysis rows,
no unchosen grants, no ancestry and no mail. Exactly one expected purpose-derived
revocation purge job is queued/unstarted; this is not worker-execution evidence.
Operational preflight found no supported executor for `worker_jobs.revoke_purge`:
neither PR75 nor the canonical retention route handles it, and the standalone
worker handles only `annotate_vcf`. No corresponding purpose retention phase or
purge manifest exists. At 19:18 UTC every other checked due-work component was
empty; the generic queue contained only this synthetic job. Its 60-second
physical deadline was 19:12:12 UTC, and the checked derived stores are already
empty through inline revocation. Do not claim manifest/worker completion from
that emptiness or call unrelated retention endpoints. A real executor and its
residual receipt are the next implementation prerequisite.

The unused first-attempt lease `0c0c1188-2802-473e-9e8b-9539afbb53b7` has no
object. It remains untouched, with token expiry 19:36:22 UTC and the ordinary
two-hour cleanup deadline 21:06:22 UTC. No deadline or state was shortened to
manufacture cleanup proof. In total, three successful synthetic uploads stored
1,519 source bytes; two sources were deleted and one remains for verification.

Absent-target UPDATE/DELETE and empty-key upsert are limited probes, not complete
existing-object overwrite/deletion proofs. Expiry, validly signed excessive
claims, store-consent revocation, cross-account boundaries and ordinary-session
transport denial after the deferred legacy cutover remain open. This evidence
supports the protected own-file milestone; full-plan acceptance remains 18/65.

## Historical verified scope before schema staging

- Inherit Supabase project: `zuvloczwgrayonqabnss`, reported ACTIVE_HEALTHY.
- Vercel project: `prj_K7bVowhjFr0uIapXraH41hthJkgy`, team slug `mariodiego`.
- Production PR75 deployment: `dpl_GdFqNrewbxF28SCT23LuR5qwxGVJ`, READY,
  with both `inherit.bio` and `www.inherit.bio` assigned to the exact merge.
  Authenticated `/files/upload` and `/files` were checked after deployment:
  both retain an enabled Choose file button. No real file was submitted,
  downloaded, deleted or reprocessed. Pause-on behavior is CI/local evidence,
  not a production assertion.
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

The dashboard was checked again around 17:51 UTC: the replacement remains
Standby, current and legacy keys are unchanged. The Rotate signing key dialog
is prepared, with no confirmations selected and no final submission. Browser
tool policy requires owner submission for a credential change; an asynchronous
handoff requests that activation while retaining both older keys. No private
key is needed in chat or reread from Vercel. The dialog warns about the three
retired Edge Functions already verified as unconditional 410 tombstones.

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

### Reviewed schema staging and recovery boundary

Independent read-only review found the own-upload migrations can be staged
in filename order while PR74 remains live, **except**
`20260906133807_cutover_subject_upload_transport`. Keep that policy removal
for the coordinated cutover. The reviewed range starts at `20260906102710`
and ends at `20260906165130`; the language migration still requires its
transaction lock and exact prerequisite hashes. This is a reviewed sequence,
not evidence that any hosted migration has been applied.

A protected production-environment candidate without production aliases could
use the already saved Production-only signing secret. A non-aliased URL alone
is not access protection; verify access controls and a fresh bounded cost plan
before deployment. Retaining legacy Storage policy permits preliminary
integration checks, **not** restricted-upload denial acceptance. Repeat the
full authorization matrix after policy removal.

The public transition requires a server-side pause on new legacy issuance,
completion of existing uploads through their deadlines, actionable recovery
for refreshed clients, and a canonical issuance stop switch. Original PR74
tabs cannot receive new JavaScript without reloading. Before policy removal,
PR74 remains the recovery deployment. After canonical uploads begin, recovery
must retain a compatible canonical app, stop issuance and fix forward; bare
PR74 cannot serve the complete new-source journey. Do not automatically
restore broad Storage policy or revoke working keys.

The replacement private key is already reported saved: do not ask for another
copy or generation. Its public entry remains Standby; accepted hosted signing
and matching deployed secret are unverified. Controlled activation is already
authorized, but any owner-only dashboard submission remains an access handoff.

### Aggregate retention preflight

At `2026-09-06 17:16:01 UTC`, a SELECT-only hosted inventory returned zero
candidates in all eleven installed retention selectors: account notice/resume,
adult contact/pending expiry, embryo cohort/disposition/contact expiry,
invitation refusal-receipt/terminal-notice expiry and refused adult/embryo
cleanup. Predicates were checked against live function definitions. No IDs,
contacts or genetic data were read and no worker was invoked.

Canonical normalization and own-upload cleanup are **unavailable**, not zero:
the canonical tables, cleanup functions and necessary source columns are
absent. This snapshot does not authorize a later worker as synthetic-only;
newly due work can enter its global selection. Refresh the aggregate inventory
immediately before any proposed composite canary.

### Remaining ordered rollout

Local prerequisites advanced at `9b45b75`: 24 actual-provider browser cases
pass, including canonical pause/resumption with 18 uploads and exact bytes.
The unchanged runtime passed 2,661 units at `a8d82b5`. A separate default-off
legacy bridge PR75 passed CI run `34050146592` at `9e92ea6`: 2,236 units,
220 browser cases with zero skips/retries and database/build/repository gates.
It merged at `a7d5a8e` and is deployed with its pause off. The refreshed Vercel dashboard
still reports $1.71/$20 included usage and $0 on-demand charges. This bridge
requires no hosted DDL and preserves existing completion handlers.

The authenticated GET retention adapter is implemented locally at `77dbad1`
and included in those unit checks. It rejects HEAD, foreign credentials,
selectors and bodies before invoking the unchanged bodyless POST once with
server-owned authorization. No schedule is configured and no hosted retention
worker was invoked. Refresh the aggregate due-work inventory before that step.

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
