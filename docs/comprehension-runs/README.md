# Comprehension run records

This directory holds the committed record of every simulated comprehension
run made with a real model provider (G3.1). **As of 28 September 2026 it holds
no run.** No model credential exists in the environment, so no paid call has
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
- SHA-256 digests of the rubric, the pattern file, the bindings, the persona
  bank and the inference worker, the rubric slice version, and each bound
  fixture file;
- the sampling seed for the 10% re-grade;
- step, token and time limits, and the token prices the spend journal
  reserved against;
- a `model` block: the inference label, the provider kind, **the pinned model
  identifier**, and the participant and grader temperatures;
- the isolation probe's report;
- skipped tasks with the binding's reason, and every remaining blocker;
- at the end: status, failure reason and measured spend per simulation.

Each line of `responses.jsonl` records the task, persona and session; whether
the task was completed, decided mechanically from the bound routes and
database facts; the path; counted in-app actions and separately recorded
entries; the steps taken; the **verbatim answer**; the blind verdict and any
independent re-grade; the deterministic prohibited-pattern result; digests of
the exact grading requests; and the session's cost. A skipped task is a line
with its reason and no answer. It is never a pass.

## Model identity

G3.1 requires the run artifact to record the pinned model identifier and
temperature. The owner decided on 25 September 2026 (`docs/protocol/decisions.md`,
"Model identity in comprehension evidence") that they appear only in the run
records in this directory, and stay out of commit messages, pull-request
text, comments and code. So:

- the identifier is written once per run, as `model.identifier` in that run's
  `manifest.json`, beside the temperatures;
- `responses.jsonl`, `assessment.json` and every other field of the manifest
  may not contain it; the writer refuses such a write and the run stops;
- outside this directory the harness uses only a non-identifying label such
  as `provider-a/config-1`, which may not contain the identifier or any word
  of it. The spend journal and raw traces carry the label, the runner prints
  the label, and the stopping rule sees a changed model only through a hash
  in the settings digest;
- `scripts/comprehension/identity-containment.test.ts` holds this: every
  identifier recorded here must appear in no other tracked file and no commit
  message, and a run with a real provider shape writes it into its
  `manifest.json` and nowhere else.

Keep the local run configuration, which names the identifier, outside the
checkout. Commit messages and pull-request text about a run name its run id
and label, never the model.

## Credential and spending

The harness reads one credential from a variable in the operator's own shell,
named by `apiKeyVariable` in the local run configuration. The documented name
is `COMPREHENSION_MODEL_API_KEY`. It is handed only to each isolated inference
process. It is never deployment configuration: never in `.env.example`, a
`.env` file, the hosting provider's environment or anything under `src/`, so
the commitment that LLM keys are never deployment-level stands.

Nobody is asked for it. Scored runs wait until a key exists in the
environment. The spend-capped setup that fits the owner's approval:

- one key on an OpenAI-compatible gateway, preferably the existing edge
  provider's, with a hard spending limit of US$50 or less set at the
  provider, so the cap holds even if the harness's own journal were wrong;
- `limitMicroDollars` of at most `50000000` in the run configuration, and
  `otherCostsMicroDollars` covering any CI or plan charge already spent;
- one `effortDirectory` for the whole approved effort, so every calibration,
  run, grader and retry draws on the same journal and balance.

## The order of runs

Whenever a key appears, the order is fixed:

1. **Smoke** with the local stub (`provider.kind: local-deterministic-stub`),
   to prove the build, the seeds and the isolation on this machine. It
   spends nothing and is recorded outside this directory.
2. **Calibration** with the real provider: one task, about five personas,
   `kind: calibration`. It re-grades every session, so all three roles are
   priced. Its record here gives the measured cost per simulation.
3. **Review the measured cost** against what is left of the US$50 before any
   full run. `pnpm comprehension:run <config> --plan` prints the ceiling.
4. **Full runs**, `kind: live-run`, naming the calibration in `calibration`.
   The runner refuses to start one without a calibration on the same model
   and settings, or if the measured cost per simulation, times the planned
   sessions, plus 25%, exceeds what the journal has left.

The exclusive factory now has native source paths for all ten tasks, including
T6/T7. Source/unit checks alone do not qualify those paths: an actual fresh
Linux smoke, cleanup/isolation proof and the existing calibration must precede
paid full rounds. See [the owned Linux operator path](owned-linux-operator.md)
for the separate authenticated owner-shell pipe; ordinary hosted CI remains
a mandatory source qualification and is not impersonated by that path.

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
tasks or an unqualified participant-c native lifecycle. A changed model,
endpoint, label,
temperature, limit or inference worker is a different set of settings.

If three successive product revisions close without two clean runs, the
affected capability enters the withheld path, with these records as its
evidence. Calibration and smoke runs are listed and never counted.
