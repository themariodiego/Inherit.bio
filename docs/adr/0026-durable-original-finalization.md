# ADR-0026 — Durable progress for original finalization

- Status: Accepted for the disabled schema slice · 2026-09-09
- Deciders: Inherit engineering, within the owner's approved WGS scope
- Extends: ADR-0016 and ADR-0025; no format, limit or public admission change

## Decision

Record durable progress for one in-flight original finalization, so a failure
stops costing a person their whole upload. Land the progress record, its
authority and its retirement first, disabled and unused, as ADR-0025 landed the
prepared-object authority before its runtime.

Finalization today is one HTTP request that validates the staging object,
copies it, reads the promoted copy back to verify its hash, removes staging and
publishes. Any failure discards every completed byte, and the person uploads
the file again from the beginning.

## What the measurement changed

`docs/hosted-own-upload-readiness.md` records the run. Driving the actual
`validateSubjectStructure` over a synthetic single-sample GRCh38 VCF of
4,930,321 variants: 155,194,392 stored bytes expand to 772,598,414 decoded
bytes, validated in 10.841 s at a peak RSS of 132,710,400 bytes. The copy pass
over the same bytes adds 0.553 s. Peak memory is flat from 100,000 to 4,930,321
variants.

Three consequences decided this design:

1. **The request is bounded by input and output, not by validation.** Under
   twelve seconds of the budget is compute. The rest is transferring the object
   twice in 4,000,000-byte ranges — 78 round trips at that size — each preceded
   by an authority recheck. Making the parser faster would buy nothing; not
   repeating completed transfers would buy everything.
2. **Size is not a memory problem.** Nothing here approaches the 512 MiB guard,
   so the design needs no memory ceiling of its own.
3. **The decoded ceiling, not the stored ceiling, is what refuses a real
   whole-genome VCF**, at 30.7× the observed limit. That is a separate,
   deliberate admission decision and this ADR does not touch it.

## Phases, and what can resume

`validated` · `copied` · `verifying` · `verified` · `staging-removed`.

Only `verifying` carries a byte offset and resumable digest state, because only
the copy pass can resume: it reads plain bytes, so an offset plus a saved digest
resumes it exactly, and a `hash-wasm` SHA-256 state is 116 bytes — far inside
the checkpoint budget.

Validation decompresses, and a gzip decoder's state cannot be serialised. It is
therefore recorded once and, if it was never reached, re-run from the start. A
checkpoint never asserts that a source is readable; it records only what this
exact claim already proved. The phase order is defined once and enforced twice:
`src/lib/uploads/finalization-progress.ts` computes with it, the migration
enforces it, and a test fails if the two disagree.

## Authority, deliberately unchanged

Progress stays bound to the originating session, exactly as ADR-0025 bound
preparation. A checkpoint is readable or writable only on the same grounds as
the finalization it belongs to: the same account, the same session, the same
consent revisions, the exact claim, `validating` status and an unexpired
session. Session expiry, logout or rotation stops finalization as it always did.

**This decision creates no session-independent finalization**, so it needs no
superseding decision about delegated genetic processing. A design that outlived
the session would need one, and this is not it.

The schema refuses a superseded claim's progress, a phase or offset that moves
backwards, a raw or decoded hash unlike what an earlier pass recorded — a
changed hash is a different source, not a resumption — a lease outliving the
upload session, and any key outside the closed set.

## Retention and deletion

A checkpoint exists only while one finalization is in flight. Reaching any
terminal status retires the row through a trigger, so the hashes it held do not
outlive their purpose: the committed file already carries them, and a deleted
file must leave no copy behind in a private table. The row cascades with its
upload session, so account deletion and the two-hour staging purge remove it
with no new purge manifest entry, which the pgTAP test asserts.

Every new private function is revoked from the browser and upload roles. The
storage-authorization test counts exactly which security-definer functions the
upload role may execute; an unrevoked one is a privilege leak, and that guard
caught one in this slice before it merged.

## What this slice does not do

No route writes a checkpoint. No resumption path is enabled. No limit moves and
no admission opens. Nothing a person can do changes.

## Consequences and remaining work

- Finalization spanning more than one request needs `begin_own_upload_
  finalization_v1` to hand the same account and session back their own in-flight
  manifest, which it refuses today because the status is already `validating`.
  The lease column exists for that: re-entry is permitted only once the lease
  has expired, so two concurrent requests cannot drive one finalization.
- The route must then read the checkpoint, do what remains within a budget,
  record progress, and answer a polling contract when the budget is exhausted.
  Small files must keep completing in one request with the current 200, so the
  existing browser contract does not change for them.
- The 30-minute upload-session window still caps total finalization time. That
  is a separate decision and is not changed here.
- None of this admits a larger file on its own. Admission needs the decoded
  ceiling decision, the capacity evidence for preparation, and the hosted
  execution home, each on its own evidence.
