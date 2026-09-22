# Large-file upload proposal · 22 September 2026

Status: proposal only. The hosted objective requires an owner decision before
adding a resumable upload path. No transport, deadline, artifact budget or
production setting has been changed for this proposal.

A fresh 768 MiB plain synthetic VCF failed during transfer from the owner
computer, after the page reached 82%. No HTTP status was captured and no file
or preparation job was created. A gzip copy of exactly the same records,
161,905,161 stored bytes and 805,306,509 decoded bytes, uploaded in 139.296
seconds and finalized on its first attempt in 64.717 seconds. Its preparation
did not publish before the unchanged one-hour deadline. At that point 2,065
reservations used 820,317,668 bytes, with 2,064 acknowledged artifacts totaling
820,301,367 bytes. Count and byte budgets remained; time ran out. No report was
rendered. These results do not establish a larger supported preparation ceiling.
The failed plain-file receipt is in
`evidence/hosted-proof-20260919/journeys/vcf-768mib-upload-failed-20260922.json`.

## Recommended first implementation

Add resumable TUS transfers on the existing private Supabase original-file
store, with Cloudflare continuing to prepare files and hold prepared artifacts
in R2. Keep the current file-size, account, concurrency and thirty-minute upload
lease limits for this first implementation. A temporary connection failure
could then retry the remaining chunks while that same lease and authority are
still live. A connection too slow to finish inside the lease would still be
refused; this stage does not promise all large files will finish.

Supabase recommends TUS for large files and unstable networks. Its current
client guidance uses the direct Storage hostname and 6 MiB chunks. Provider
upload URLs can live longer than this app's upload grant, so the provider URL
must never become independent permission to upload. See the
[resumable-upload documentation](https://supabase.com/docs/guides/storage/uploads/resumable-uploads).

The existing dedicated upload grant remains the authority. The implementation
must prove that creation, offset checks, every continued write and completion
respect the same exact staging object, account, originating session, subject,
consent and declared byte limit. Ordinary login bearers remain unable to create
raw storage objects. Do not replace the grant with the provider's generic
example or allow overwriting another attempt's object. Finalization still
validates the entire stored file, decoded size, format and hash before admission.

Use an explicit transport version in issuance and its receipt. An older client
must not receive a size or protocol it cannot carry. Within the first version,
resume only the current live upload, with bounded retries and cancellation;
do not silently adopt an expired grant or another login session. No persistent
browser credential store is required for this first stage.

Before activation, prove interrupted transfer and continuation, refusal after
revocation or expiry, conflicting writers, tampered paths and lengths, browser
cancellation, and cleanup of incomplete provider uploads within the existing
retention contract. Test those properties on the isolated preview with synthetic
files. If the provider cannot satisfy the cleanup contract, stop at that finding
and revise the design; do not extend the retention promise implicitly.

The first implementation milestone is a provider-contract proof. Read-only
review of [Supabase Storage's request lifecycle at a pinned revision](https://github.com/supabase/storage/blob/74ad989b6f1c5f7097fa2018e50a4d8288961fd8/src/http/routes/tus/lifecycle.ts#L106)
found that `HEAD` skips the per-object `canUpload` check used by continued
writes. That does not mean it skips JWT authentication, and it is not a
measurement of the preview's deployed version. It does mean a direct client
library switch cannot be assumed to preserve the app's current account,
session and revocation checks on offset reads. Prove that boundary and orphan
cleanup first; if a separate authority gateway is needed, document its exact
contract and costs before proposing activation. No provider write or TUS
upload was made during this source review.

## Larger capacity remains a separate measurement

The standard request path is still capped by its measured transport boundary.
The [provider's standard-upload guidance](https://supabase.com/docs/guides/storage/uploads/standard-uploads)
retains a 5 GB request limit. A larger global bucket limit does not change that.
TUS can remove this request boundary, but it does not increase preparation's
one-hour deadline, 4,096-artifact cap or 1 GiB artifact-byte budget.

The earlier 2 GiB run already showed that preparation needs additional work;
its extrapolated artifact requirement is not a successful measurement. The
768 MiB comparison now shows source merging followed by canonical merging and
materialization still in progress at the deadline. Use its recorded checkpoints
to profile repeated artifact reads, writes and merge passes before changing the
pipeline. The partial acknowledged ratio was already 1.018620063 per decoded
byte; the older 0.87 ratio is not a reliable capacity promise. Reduce measured
work within the existing bounds and rerun the same synthetic journey. The full
receipt is `evidence/hosted-proof-20260919/journeys/vcfgz-768mib-deadline-20260922.json`.
Reaching
2 GiB VCF or 8 GiB gVCF requires a complete measured journey at each intended
size. Raising a setting, or completing only storage, is insufficient evidence.
Any longer upload lease, larger preparation budget or cross-attempt preparation
recovery is a separate decision, with its own tests and cost evidence.

## Cost and release boundary

The current preview container is standard-2: one vCPU, 6 GiB memory and 12 GB
disk. At the published rates, one hour at full CPU is at most USD 0.129024 for
those three resources before included allowances. Workers, Durable Objects,
logs, network, R2, Supabase and Vercel charges are additional. This is a rate
calculation, not measured billed usage; no plan or upgrade was purchased. See
[Cloudflare Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/).

Keep incremental work within the owner's USD 50 cap and stop before spending
past it. Implement and verify on a draft topic branch and the isolated preview.
The objective reserves production activation and preview teardown to the owner.
