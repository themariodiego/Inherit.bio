# Comprehension run records

This directory holds the committed record of every simulated comprehension
run made with a real model provider (G3.1). **As of 28 September 2026 it holds
no run.** No model credential exists for the harness, so no paid call has
been made. Nothing here is a human result; human results belong in
`docs/comprehension-results-<date>.md`, written only by a facilitator who ran
a round.

Runs made with the local deterministic stub are harness self-tests. They are
never written here. `scripts/comprehension/run-record.ts` refuses to write a
stub run under this directory, and refuses to write a real run anywhere else.

## Layout

One directory per run: `docs/comprehension-runs/<date>/<runId>/`.

| File | What it holds |
|---|---|
| `manifest.json` | What the run was, pinned before the first session, and its outcome |
| `responses.jsonl` | One line per simulation, appended and flushed as it finishes |
| `assessment.json` | G3.3's arithmetic over `responses.jsonl`, for a full run |

`manifest.json` records:

- the run kind: `live-run` (30 personas on all ten tasks), `calibration` or
  `smoke`. Only a `live-run` counts toward G3.3;
- the product revision, and whether the working tree differed from it;
- the build it drove: `next start` of this checkout's production build on
  port 3100 under TEST-LOCAL, with the build id checked against the server
  and TEST-LOCAL checked by a capability only it permits;
- SHA-256 digests of the rubric, the pattern file, the bindings and the
  persona bank, the rubric slice version, and each bound fixture file;
- the sampling seed for the 10% re-grade;
- the participant and grader temperatures, step, token and time limits, and
  the token prices the spend journal reserved against;
- the inference label, the identity commitment and the isolation probe's
  report (see below);
- skipped tasks with the binding's reason, and every remaining blocker;
- at the end: status, failure reason and measured spend per simulation.

Each line of `responses.jsonl` records the task, persona and session; whether
the task was completed, decided mechanically from the bound routes and
database facts; the path; counted in-app actions and separately recorded
entries; the steps taken; the **verbatim answer**; the blind verdict and any
independent re-grade; the deterministic prohibited-pattern result; digests of
the exact grading requests; and the session's cost. A skipped task is a line
with its reason and no answer. It is never a pass.

## Model identity: a stated tension

The brief (G3.1) says the run artifact records the pinned model identifier.
The owner decided on 25 September 2026 that the identifier may appear in the
run records in this directory. The standing rule for this work forbids model
identifiers in anything committed or pushed.

The harness follows the stricter rule until the owner chooses otherwise:

- `manifest.json` carries a non-identifying label such as
  `provider-a/config-1`, and a salted SHA-256 commitment to the exact
  identifier and endpoint.
- The exact identifier, the endpoint and the salt are written only to
  `<effortDirectory>/identity/<runId>.json`, a private `0600` file outside
  any Git checkout. With it, anyone can recompute the commitment and prove
  which model ran.
- Every record carries the blocker `pinned-identifier-held-locally-not-in-record`,
  so no run can qualify for G3.3 until the owner either accepts the
  commitment as meeting G3.1 or allows the identifier here.

No line may contain the identifier or its salt. The writer refuses such a
line and the run stops.

## Checking a record without a model

```sh
pnpm comprehension:records check docs/comprehension-runs/<date>/<runId>
```

This re-applies `scripts/comprehension/prohibited-patterns.json` to every
verbatim answer and recomputes the assessment. It fails if either differs from
what the run recorded. Either detection path failing an answer fails the gate.

## The stopping rule

```sh
pnpm comprehension:records status
```

G3.3 is met when the last two full runs, in the order they were run, share one
product revision and one set of settings and both meet every threshold. A
full run that is not clean breaks the sequence, including one with skipped
tasks: until participant-c can be seeded (embryo ingest, G2.6), T6 and T7 are
skipped and no run can be clean. A changed provider label, identity
commitment, temperature or limit is a different set of settings.

If three successive product revisions close without two clean runs, the
affected capability enters the withheld path, with these records as its
evidence. Calibration and smoke runs are listed and never counted.
