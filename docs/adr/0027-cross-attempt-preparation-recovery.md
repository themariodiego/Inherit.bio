# ADR-0027 — Cross-attempt recovery for preparation

- Status: **Proposed** · 2026-09-09 · not decided here
- Deciders: Inherit engineering, within the owner's approved WGS scope
- Extends: ADR-0025 and ADR-0026; proposes no format, limit or admission change

## The question

Preparation records durable progress for the attempt that is running, and
refuses to adopt a previous attempt's progress. `claim_next_own_preparation_v1`
re-claims a lapsed job up to three times, but each re-claim gets a fresh
`attempt_id`, and the worker requires a newly claimed attempt to start empty.
Recovery is therefore a restart, not a resumption.

Should a later attempt be able to take over what an earlier one finished?

## Why this is now a question worth deciding

`job_deadline` is set once and is immutable: it is absent from the mutable
column list in `guard_own_preparation_identity_v1`, and
`own_preparation_jobs.sql` pins that it cannot be renewed. A retry therefore
inherits the original deadline, and a restart has to fit in what is left of it.

Against the measured whole-genome preparation of **2,745.38 s**
(`docs/hosted-own-upload-readiness.md`), that arithmetic decides the design:

| Deadline | Restart-recoverable window | Share of the run |
|---|---:|---:|
| `max_job_seconds` 900, the default | none — the run does not fit at all | 0% |
| 3,600, the schema maximum | 855 s | 31% |

Only a failure inside that opening window can be recovered by starting over.
A whole-genome job that dies after minute fifteen cannot be restarted within
its own deadline however many attempts remain. For a 1,000,000-variant file at
502.871 s the picture is comfortable — 397 s of window under the default
deadline, 79% of the run — which is why this has not bitten yet.

**So for large files resumption is not an optimisation of recovery; it is the
only recovery that can exist.** That is the finding that makes this a decision
rather than a preference, and it is why the question is raised now.

## What any design has to respect

These are not preferences either; they are the existing structure, and each
exists for a reason.

- `own_preparation_artifacts` is `unique(job_id,sequence)`. One job owns one
  artifact sequence namespace, so a second attempt cannot reuse a position an
  earlier attempt took.
- `artifact_count` and `reserved_bytes` are monotonic per job, enforced by
  trigger. They fence storage writes; letting them fall would weaken the fence
  that stops a zombie writer from a superseded attempt.
- Every artifact receipt carries its `attempt_id`, and the pipeline's writer
  refuses an acknowledgement from any other attempt.
- `write_fence_at` records the latest write lease, which is what makes "no
  previous writer can still be writing" a checkable fact rather than an
  assumption.
- Authority is re-resolved on every renewal: the same account, session,
  consent revisions and unexpired session. ADR-0026 said this creates no
  session-independent finalization, and the same must hold here.
- A checkpoint is retired on any terminal status, so recorded hashes do not
  outlive their purpose.

## The shape a design would take

Admit a prior attempt's **acknowledged** artifacts to a later attempt of the
**same job**, once `write_fence_at` has passed, each verified against the hash
already recorded for it, and adopt that attempt's checkpoint phase — with
every authority check above unchanged, and the sequence namespace continued
rather than reused.

What it must not do: adopt anything from a different job or a changed source;
resume across a source whose recorded hashes differ, which means a different
file rather than a resumption; reuse a sequence position; or outlive the
originating session, which would need its own superseding decision about
delegated genetic processing.

## Alternatives, and why they are worse

- **Continue the sequence and re-run from the beginning.** The dead attempt's
  payload permanently consumes `reserved_bytes`, and that cap is already the
  binding ceiling at 8.79× under for a whole genome. This makes the tightest
  constraint tighter, and buys nothing that the deadline arithmetic above does
  not already refuse.
- **Reset the counters on re-claim.** They fence storage writes, and the
  sequence namespace is unique per job. A reset would have to delete the
  earlier artifacts first, which is storage work that SQL cannot do inside a
  claim.
- **Leave it as it is.** Defensible while every prepared file is small. It
  stops being defensible the moment a file takes more than its deadline minus
  its own runtime, which a whole genome already does.

## What this ADR does not do

It decides nothing and changes nothing. No migration, no route, no limit and
no admission accompany it. It records that the measurement turned recovery
from a quality-of-life question into a correctness one for large files, and
states the constraints any answer has to satisfy, so the decision can be taken
deliberately rather than discovered during an incident.

Separately and already done, because it needed no decision:
`20260909230000_own_preparation_retry_requires_empty_sequence.sql` stops the
claim offering a retry that no attempt could take. That removes a wasted
budget and a misleading `integrity_mismatch`; it does not make recovery
possible.
