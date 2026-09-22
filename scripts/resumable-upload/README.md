# Empty resumable-upload diagnostic

This opt-in diagnostic checks offset-read authority on one exact preview. It
does not activate resumable upload in the application or prove file capacity.
The executed preview proof exposed the empty upload offset to an anonymous
bearer. That result fails the proposed authority boundary even though the
provider acknowledged termination of the empty upload.

The runner issues one application grant for a synthetic 512-byte VCF declaration,
creates a TUS upload with **no request body**, observes three HEAD responses,
then attempts DELETE and HEAD in `finally`. No DNA bytes, PATCH, finalization,
preparation, retry, redirect, sign-in, token refresh or provider configuration
change is available. There is at most one app request and six provider requests.
Each request, including reading or cancelling its response, has a 15-second
bound. The 120-second request budget reserves 30 seconds for DELETE and HEAD.

Use Node 22 and the pinned package manager. The command below is an example;
it has not been executed as part of the reusable harness's unit validation.
Run only after authorization for another preview mutation:

```sh
corepack pnpm exec tsx scripts/resumable-upload/run.mts \
  /absolute/private-directory/credentials.json \
  /absolute/private-directory/new-receipt.json \
  create-one-empty-preview-upload
```

Both absolute paths must be outside the repository, inside owner-only `0700`
directories. The existing credentials must be an owned regular `0600` JSON file
with one hard link; symlinks are refused. The output must not exist. It is
created `0600`, and only schema-validated, sanitized receipts are written there.
Each update flushes a private temporary file, atomically replaces the receipt,
and flushes its directory, preserving the previous complete snapshot on a failed
write before replacement.
Do not put credential values or upload Locations in arguments, logs or commits.

The credential object has exactly these fields:

- `project`: `iofjhrtcyawjjhuxbgfd`
- `appOrigin`: `https://inherit-24p1eqxmf-mariodiego.vercel.app`
- `accountId`: `1858a7cf-d37d-408d-a01a-738c4077c8cd`
- `sessionId`: the synthetic account's current authenticated session UUID
- `sessionCookie`: only that preview's current SSR auth cookie or complete chunks
- `anonKey`: that preview project's public anonymous JWT
- `protectionBypass`: that preview deployment's protection bypass credential

The runner checks the session cookie's account, session, issuer and expiry before
issuance. These local decoding checks are sanity checks; the application verifies
the live authenticated session. The issued upload bearer must match that account,
session, upload, staging key, 512-byte declaration and an expiry of at most 30
minutes. Its signature is verified by Storage, not by a local signing secret.

Only canonical upload Locations from that preview's API or direct Storage origin,
encoding the exact bucket and staging key with one UUID version, are accepted.
Bearers and upload Locations remain in memory. The receipt records fixed
stages, timestamps, status codes, bounded numeric offsets/lengths, known protocol
headers and the validated application upload UUID. That UUID can identify the
exact issued row through approved read-only reconciliation if the process stops.
Provider response text, upload-resource versions and arbitrary headers are discarded.
The issuance attempt and then the upload UUID plus creation uncertainty are
flushed to disk before the respective mutating request is sent.

Exit status `2` means an unauthorised offset read was observed and the empty
termination sequence was acknowledged. Exit status `1`
means the probe stopped or termination was unconfirmed. Exit status `0` means
only that this limited probe did not demonstrate an offset disclosure and the
empty termination sequence was acknowledged; it is **not** a passing activation
or capacity proof. Every receipt marks physical fragment cleanup, application
integration and capacity as unproven.

A lost creation response or invalid Location leaves creation outcome uncertain;
the runner never guesses a URL or retries creation. DELETE `204` followed by HEAD
`404` proves only protocol acknowledgement, never physical fragment erasure.
Interrupted runs cannot resume because provider handles are not persisted. Investigate
uncertain outcomes through the approved preview reconciliation process before
authorizing another run.
