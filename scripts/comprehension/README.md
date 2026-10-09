# Comprehension execution

The rubric, task bindings, persona bank, prohibited-answer patterns, accounting,
assessment, dry conductor **and the live harness** are implemented. The live
harness drives the local production build under TEST-LOCAL with a fresh
browser context and a freshly seeded account per simulation, runs every
inference call in its own isolated process, and writes the durable run record
under `docs/comprehension-runs/<date>/`. **It has run end to end only with the
local deterministic stub. No model credential exists, so no paid call and no
qualifying run has happened.** G3.1 and G3.3 remain NO.

The owner authorized two full runs (600 task simulations at minimum), their
grading and an independent 10% re-grade, with **US$50 maximum incremental spend**
on 22 September 2026. This replaced the earlier US$25 choice. The cap includes
inference, any CI charges and any required first month of the hosting plan.

## Running the live harness

```sh
pnpm comprehension:run /absolute/path/run.json --plan   # validate and print the plan
pnpm comprehension:run /absolute/path/run.json          # run it
pnpm comprehension:run /absolute/path/run.json --close-revision   # before full runs move to a new revision
pnpm comprehension:records status                       # the stopping rule over committed runs
pnpm comprehension:records check docs/comprehension-runs/<date>/<runId>
```

`comprehension:run` validates the configuration, prints what the run will do
and the most it can reserve, and then runs `e2e/comprehension-run.spec.ts`
through the browser suite's own bootstrap (`scripts/run-upload-browser.mts
--full`): the production build on port 3100 with `INHERIT_TEST_JURISDICTION=1`,
the local Supabase stack and the real Storage provider proxy. On this
machine, run it the way every browser run is run:

```sh
flock "$S/locks/browser.lock" env -u NEXT_PUBLIC_SUPABASE_URL \
  PLAYWRIGHT_BROWSERS_PATH="$S/pw-browsers" INHERIT_DISPOSABLE_LOCAL_E2E=true \
  pnpm comprehension:run /absolute/path/run.json
```

The spec is excluded from every default Playwright project. It has its own
project only when `comprehension:run` sets `INHERIT_COMPREHENSION_RUN=1`,
because it is stochastic and G8.4 excludes it from the whole suite. A run
with no participant-a task uploads nothing, so the bootstrap's final "No
browser upload crossed the actual provider proxy" check then fails after
the run itself has passed; include at least one participant-a task.

Before the first session the spec checks three things and stops if any fails:

1. the server on port 3100 serves the production build `.next/BUILD_ID` names;
2. a declared account sees a capability only TEST-LOCAL permits
   (the `/family/invite` form, which any real jurisdiction withholds);
3. an isolation probe spawned exactly like a real call runs outside the
   checkout and sees only the environment it was given.

### The configuration file

A local JSON file, never committed. It is the only place an endpoint, a
credential variable name or a model identifier appears.

```json
{
  "schemaVersion": 1,
  "kind": "smoke",
  "effortDirectory": "/absolute/private/directory/outside/any/checkout",
  "tasks": ["T1", "T8", "T9", "T10"],
  "personas": 1,
  "samplingSeed": "<64 hex characters, chosen before the run>",
  "settings": { "temperature": 0, "maxSteps": 8, "maxAttempts": 1, "timeoutMs": 60000,
    "sessionSetupTimeoutMs": 600000, "maximumInputTokens": 24000, "maximumOutputTokens": 600,
    "price": { "inputMicroDollarsPerMillion": 1, "outputMicroDollarsPerMillion": 1 } },
  "limitMicroDollars": 1000000,
  "otherCostsMicroDollars": 0,
  "stubRecordRoot": "/absolute/directory/for/stub/records",
  "provider": { "kind": "local-deterministic-stub" }
}
```

For a real provider, `provider` becomes:

```json
{ "kind": "openai-compatible-chat", "label": "provider-a/config-1",
  "endpoint": "https://<gateway>/v1", "modelIdentifier": "<exact identifier>",
  "apiKeyVariable": "COMPREHENSION_MODEL_API_KEY" }
```

- `kind` is `smoke`, `calibration` or `live-run`. Only a `live-run` of all
  30 personas on all ten tasks counts toward G3.3.
- `effortDirectory` must be `0700`, owned by you and outside any Git
  checkout. It holds the spend journal and raw traces for the whole
  authorized effort. A stub run uses the dry ledger there; a real run
  uses the live one, and neither opens the other.
- `label` must not contain the identifier or any word of it, because the
  label travels where the identifier may not: the journal, traces and logs.
- Keep this file outside every Git checkout; it names the exact identifier.
  Supply its absolute canonical path. The file must be owned by your user,
  have mode `0600`, have only one link and contain at most 64 KiB. File and
  directory aliases are refused. Set the mode before use:

  ```sh
  chmod 600 /absolute/private/run.json
  pnpm comprehension:run /absolute/private/run.json --plan
  ```

  The runner checks the named file and its open descriptor before and after
  reading. A changed file, Git boundary, invalid text or invalid configuration
  stops before a journal, credential check or browser starts. Refusal messages
  do not print the configuration. `--plan` with the local stub needs no key and
  creates no effort ledger or run record. A real provider still needs the named
  key in the operator's shell. These checks do not prove a scored run or erase
  private strings from memory.
- The credential is read from the named variable in your shell and handed
  only to each inference child. It is never deployment configuration, never
  in `.env.example` and never under `src/`, which keeps the commitment that
  LLM keys are not deployment-level.
- A paid `live-run` needs `calibration`: the directory of a completed
  calibration record on the same provider configuration and settings. The
  spec projects its measured maximum cost per simulation over the planned
  sessions with a 25% margin and refuses to start if that exceeds what the
  journal has left.

### What a session is

Each (task, persona) pair gets:

- **its own browser context** (`live-browser.ts`) that can reach only the app
  and its local Supabase API. The participant sees the page as text, with
  every visible control as `[id kind] label`, and acts on those ids. Real
  `click` and `submit` events are counted in the capture phase exactly as
  `e2e/task-depth.spec.ts` counts them, so pressing Enter in a form with a
  default button counts two. Mailed-link and typed-URL entries are recorded
  separately. No confirmation exclusion is applied, which can only raise a
  count. Only `@e2e.local` or `.invalid` addresses may be typed.
- **its own account**, seeded from `bindings.json` through the product's own
  upload path, the same steps `e2e/comprehension-participants.spec.ts` takes,
  under an address unique to the session. No simulation inherits another's
  deletions, invitations, consents or history. Seeding participant-a takes
  about half a minute and happens before counting starts.
- **T9's fixture**, following the owner's 28 September decision and the
  measured path in `e2e/task-depth.spec.ts`: another adult reserves a record
  for the participant's address and invites them from their own context; the
  participant starts signed out at `/` with that one email shown in an inbox
  beside the page. Opening it is an entry, never a counted action.
- **a fresh isolated process per inference call** (`inference-isolation.ts`,
  `inference-worker.ts`): a new OS process in an empty directory outside the
  checkout, whose environment holds only PATH, a locale and, for a real
  provider, the one credential variable and proxy settings. A participant
  process gets its persona, the task prompt, its own steps and the current
  page; a grader or re-grader process gets the rubric's shared instructions,
  the one task section and the verbatim answer. The worker bounds each prompt
  in bytes to the pinned input limit, so the reservation really is a maximum.
- **mechanical completion** (`completion.ts`): the bound routes and report
  slugs in `bindings.json`, plus two database facts read after the session:
  T8's deletion was scheduled, and T9 and T10's participant created no
  account.

The ordinary `pnpm comprehension:run` entrypoint owns one shared active stack
and therefore still refuses T6/T7 there. Use `pnpm comprehension:fresh` for the
exclusive all-task lifecycle below. A shared-stack skip never becomes an answer.

### Model identity

Under the owner's decision of 25 September 2026, the pinned model identifier
and temperature appear only in the run records under
`docs/comprehension-runs/<date>/`. The harness writes the identifier once, as
`model.identifier` in a real run's `manifest.json`, and refuses it anywhere
else in the record. The run manifest the journal stores carries only the
label; the stopping rule sees a changed model through a hash in the settings
digest. Nothing the runner prints contains it, and
`identity-containment.test.ts` fails if a recorded identifier appears in any
other tracked file or any commit message. Commit messages and pull-request
text about a run name its run id and label, never the model.

### The order of runs

Whenever a key exists in the environment: a stub smoke run first, then a
calibration with the real provider (one task, about five personas), then a
review of its measured cost per simulation, then full runs that name the
calibration. `docs/comprehension-runs/README.md` sets out the order and the
spend-capped credential setup. Nobody is asked for a key; scored runs wait
until one exists.

### Cost and the cap

Every attempt reserves its maximum, `maximumInputTokens` at the input price
plus `maximumOutputTokens` at the output price, before the call, and settles
to the provider's certain usage after it. A session makes at most `maxSteps`
participant calls, one grading call and, for a sampled answer or in a partial
run, one re-grading call. A calibration run re-grades every session so that
all three roles are priced.

A complete ten-task round has 300 independent simulations. A measured
calibration replaces planning estimates before a paid full run, and the
exclusive launcher also reserves every fresh native stack in that same shared
journal. Neither a source plan nor a synthetic control establishes real
hosting cost, model cost or elapsed time.

## Seeding the participant accounts

`pnpm seed:participants` builds `participant-a` and `participant-b` in the
local Docker stack, through the product's own upload path. It runs
`e2e/comprehension-participants.spec.ts`, which reads every email, file, file
type and report choice from `bindings.json`:

- `participant-a@e2e.local` holds the array sample and then the AIMs VCF, each
  with all three report choices. The AIMs file goes last because the ancestry
  page shows the most recently completed estimate, and T2 reads that one.
- `participant-b@e2e.local` holds no file. It is the friend T4 invites.

Both use the synthetic local password in that spec. The seed never deletes.
An account already holding exactly its seeded files and results passes as
seeded. An account holding anything else is refused: clear it through
Settings → Data (T8's own path) or reset the local stack, then seed again.
The full browser suite runs the same spec, so CI shows when the seed breaks.

Re-running it on a stack where both accounts are already seeded is safe. Both
tests pass without uploading anything, and then the runner exits non-zero with
`No browser upload crossed the actual provider proxy`. That guard belongs to the
full suite, which must prove every run used the real Storage provider; a
seeded account needs no upload. The two passing test lines above it are the
seed's result.

`participant-c` is bound to the existing single `embryo-ingest` native case,
`e2e/embryo-ingest-journey.spec.ts`. It consumes the bound one-file/two-embryo
VCF and both bound synthetic parent accounts, signs the actual current
artifacts, uploads through configure/chunks/complete, executes the real worker,
checks whole publication and signs both analysis grants separately. It refuses
old cohort rows and the runtime requires its exact fresh disposable native CI
partition. The ordinary command above continues to seed only a/b; it cannot
create c's isolated runtime. Use the existing full native CI partition that
inventories the `embryo-ingest` project; no custom unsharded embryo execution or
fixture-only result insertion is supported.

The same real case records T6's click/submit trace from the Overview to the
visible no-ranking statement after its genuine setup. Case counts, worker
identity, native partition fences and all prior publication assertions remain.
Full hosted proof of the authored seed/instrument is pending. This metadata is
not an assertion that an arbitrary local stack already contains the seed.

`e2e/participant-c-harness.ts` consumes the credentials and actual cohort ID
from that completed journey. It opens the live harness's fresh browser context,
signs in normally and checks the current publication, both subjects/files and
the real worker's complete canonical-part proof before setup and completion.
The same native case drives its real read/action/record interface without a
model call. It refuses crossed identities, dirty or noncurrent parts, failed
siblings, later publication revisions and any unsupported score. No password
or browser storage state is written to its attachments.

The native read adapter checks current publication before and after each
observation, action and completion read. T7 uses G3.2's honest unavailable state:
the real comparison says no calibrated model is registered and shows only file
quality. The unchanged relative-only prohibition and blind rubric refuse risk
invention or relabelling quality as personal risk.

### Exclusive complete-round launcher (authored; native execution pending)

`pnpm comprehension:fresh /absolute/private/run.json --plan` accepts the same
private run settings nested as `run`, plus the existing
`maximumInfrastructureCostPerStackMicroDollars` ceiling. Omitting `run.tasks`
and `run.personas` plans all ten original tasks and thirty personas. The private
file uses the same protected-file reader as the ordinary launcher; planning
opens no stack, journal, key or model process.

`--prepare` builds once. Every subsequent task/persona pair acquires a distinct
empty disposable Supabase stack, exact owned runtime container and browser,
reusing the source/build/image read-only, with an owned bounded per-container
Next cache. It seeds a/b through the original
product upload/report choices, T9 through the real separate reserver invitation,
and c through both genuine parent signatures, upload and isolated worker. A
fresh read/action context follows setup; T6 and T7 never share an account or
publication with another simulation. The original provider proxy also checks
real denial/CORS/transport and a's actual successful uploads. Close disposes the
read context, browser, owned app children, provider and exact stack before the
next acquisition. Changed authority/currentness, cancellation or uncertain
cleanup stops the run; no adoption, reset, row cloning or model fallback exists.

A complete plan has 300 fresh simulation stacks plus one build bootstrap,
**not 300 builds**. All 301 infrastructure ceilings must fit the existing shared
journal, and every attempted stack's maximum remains reserved even on failure.
For a paid full run, the same completed calibration, model/settings match and
25% projected-cost margin remain required, now alongside all remaining stack
ceilings. These are conservative cost ceilings, not observed hosting cost or
elapsed-time claims. The original 30-persona, regrade, two-run, stopping and
budget policies are unchanged.

The existing manual credential-free workflow now prepares two T6 and two T7
sessions. Standard six-job CI still does not run this stochastic instrument.
Its signed hosted workflow/checkout/run ownership fence, existing 45-minute job
limit and all command/setup/inference limits remain unchanged. Full native
execution, a measured calibration and actual authorized inference are still
unrun. A supplied full configuration is callable by the same exclusive launcher;
completion and qualification require every actual session/cleanup and the
original thresholds, never a source check or stub answer. No G3.1/G3.3 YES is
claimed, and a full round's fit inside the unchanged job limit is unmeasured.

**The paid operator path is not configured.** The current checked-in manual
workflow runs the deterministic stub only; it has no paid secret/configuration
input. A private key kept in the owner's Mac shell cannot be inherited by a
GitHub-hosted Linux process, and this launcher requires genuine signed ownership
of that hosted job. No authorized key/configuration transport to that job has
been established. The complete factory is therefore callable source, not an
executable paid round. Before calibration, a private execution and credential
mechanism consistent with the ownership fence and shared US$50 ceiling must be
explicitly established. Do not upload a private key to GitHub/hosting, fake CI
ownership or relax the fence to make a run start.

## Spending boundary

`budget.ts` provides `SpendJournal`. Use one absolute journal path for the whole
authorized effort, including calibration, both runs, graders and retries. Keep
it outside the checkout. Opening an existing journal requires the exact same
approval and non-inference reserve; a new run must not get a fresh balance.

Before sending a paid request, reserve its **maximum** charge and wait for the
journal write to finish. Bound both input and all billable output tokens,
including reasoning. Use current verified prices; never assume a cache discount.
`maximumTokenCost` rounds upward to an integer millionth of a dollar. A planning
estimate or a requested output limit that excludes billable reasoning is not a
safe reservation.

Settle the reservation only after receiving complete, certain provider usage.
A timeout keeps the full reservation. Give a retry a new request id and reserve
it separately. Unknown, duplicate or oversized usage reports halt spending.
The owner process holds an exclusive lock; after a crash or uncertain journal
write, inspect the journal and provider charges before manually recovering the
lock. Do not delete or reset the journal to resume work.

The journal contains only the approved amounts and opaque request ids. It does
not contain credentials, answers, model identifiers or browser context. Under
the owner's 25 September decision, the pinned model identifier and temperature
appear only in the run records under `docs/comprehension-runs/<date>/`. They
stay out of commits, pull-request text, comments and code.

## Assessing recorded results

`assessment.ts` validates 300 task/persona records per run: 30 distinct personas
for each of the ten tasks, with a fresh session for every simulation. Missing,
duplicated or unknown records cannot shrink the denominator. It requires a
verbatim answer and a recorded blind verdict for every simulation. The caller
must prove those sessions and grading processes happened; this validator checks
the submitted records and is not evidence of a completed run by itself.

Pin the sampling seed before grading. `regradeSample` selects three answers per
task by a seeded hash, independent of their verdicts. Supply independent grades
for exactly those 30 answers. Agreement below 27/30 voids the run. Any safety or
missing-route finding from the independent grader still fails its zero-tolerance
threshold even when overall agreement is high. The deterministic prohibited
patterns remain an additional failure path.

T1–T4, T8 and T9 require 27 completed, passing responses. T9 additionally requires
at most six counted in-app actions; its entry count stays separate. Pass a full
`HumanSuccesses` record only after a real twelve-person round: a task below 10/12
raises its simulated threshold to 29/30. No human results exist yet.

`assessConsecutiveRuns` takes chronological history and checks the last two runs,
using one product revision and settings digest. It rejects reused run/session
identities and cannot skip an intervening failed run. The local conductor retains
chronological instrument history and exercises the three-revision stopping rule;
it does not turn authored adapter answers into participant evidence.
Test fixture answers in `assessment.test.ts` are fabricated instrument checks;
they are never comprehension results and must not enter a run artifact.

Run the local checks with:

```sh
corepack pnpm exec vitest run scripts/comprehension/
```

## Conductor boundary

One session loop (`conductor.ts`) serves the dry instrument and the live
harness, so the isolation and accounting the dry tests prove are what a live
run executes. `runInstrument` below is the dry entry; `runLive` is the live
one, and it accepts only the live environment.

`loadConductorInputs` reads the committed bank, bindings, rubric, pattern file,
protocol, route register and referenced fixture bytes. `createManifest` freezes
their digests, the consumed input data, product revision, temperature, limits,
sampling seed and task variant before any adapter opens. Runtime input changes
invalidate the manifest. The detector uses that pinned pattern snapshot.

`runInstrument` accepts only `instrument-dry-run` and a
`synthetic-local-adapter`. Its injectable factories are test doubles, and its
returned `qualifyingEvidence` is always false, including when the instrument's
assessment is clean. The live harness supplies the real factories: a browser
context per session and an isolated OS process per call, as described above.

Every full dry run exercises all thirty personas on all ten tasks, with a fresh
browser handle for each pair and a fresh inference handle for every call. The
participant sees only its selected persona, the task prompt and its own current
session's visible observations/actions. A grader or independent regrader sees
only the rubric slice and verbatim answer. The rubric slice preserves the
unchanged common instructions and exact relevant task section from one source;
the source digest and deterministic selection version are pinned. Completion,
action counts, entries, persona, page content, prior verdicts and run history
are never added to a grading payload.

The browser adapter records actual click/submit events and separately records
mailed-link/typed-URL entry. The conductor refuses claimed confirmation
exclusions, and the live adapter applies none, so a count can only be higher
than the registered instrument would give, never lower. Participant responses
cannot supply their own completion flag.

## Durable instrument records

Create a new, protected directory outside every Git checkout and open it with
`InstrumentJournal.open(directory, limitMicroDollars, otherCostsMicroDollars)`.
The directory must be owned `0700`; history and spend files are owned `0600`.
The fixed `dry-history.jsonl` and `dry-spend.jsonl` names keep all runs and retries
in that instrument effort on one ledger. **These are synthetic accounting
checks, not incurred charges. Never reuse the real expense journal here.**
No transcripts are written under `docs/comprehension-runs/` by this scaffold.

Before an inference adapter is acquired, its maximum token cost is reserved and
flushed, then its unique request/process/slot identity is appended and flushed.
Only complete, bounded usage may settle a reservation. Unknown replies and
timeouts retain the maximum; a retry receives a new reservation and new process
ID. Both call admission and history replay enforce the pinned retry limit;
settings cannot change between the manifest and a call. A process whose
acquisition or closure is unresolved is not retried. A late acquired handle is
closed without invocation. No partial run can resume a previous call slot, and
no crash recovery deletes a lock or resets a balance.

The append-only history records run starts, browser-session admission, observed
frames, requested actions, verbatim answers, verdicts, session endings and the
final instrument assessment or stopped status. Partial traces and uncertain
calls stay in the history. Failed persistence halts execution and retains the
lock. Actual owner-process death leaves both locks and full outstanding
reservations for manual reconciliation; the unit suite verifies that behavior
with a killed local child process and no provider call.

Unresolved browser/process acquisition or closure records a durable stop tied
to the admitted resource identity. Finishing the run as stopped does not clear
that marker: the history lock remains, replay refuses another run or revision
closure, and no further inference is admitted. Disposal of a late handle does
not silently clear this stop. Cleanup reconciliation is external work; this
scaffold supplies no lock deletion or automatic recovery operation.

A different product revision cannot start until the previous revision is
explicitly closed in the history. Closure uses its last two full runs on the
same settings, including intervening failures. Three consecutive failed closed
revisions stop new instrument runs. This tests the stopping mechanism; actual
capability withholding still requires real transcripts and the release process.

## What still blocks a qualifying run

`preflightQualifyingRun` still refuses every dry run. A live run computes its
own blockers and records them in its manifest; `qualifyingEvidence` is true
only when none remains. What the live harness now provides, and what it
cannot:

| Former blocker | Now |
|---|---|
| Run record with the pinned identity | Built: the identifier and temperatures in the record's `manifest.json` only, per the owner's 25 September decision, held there by `identity-containment.test.ts`. |
| Externally enforced isolation | Built: a browser context and seeded account per session, an isolated OS process per call, and a probe recorded with every run. |
| Production build under the test jurisdiction | Checked before every run: build id served, and a TEST-LOCAL-only capability visible. |
| T9 fixture | Built: the owner's reserved-record invitation path, with the mail in an inbox beside the page. |
| T10 fixture | None needed: T10 starts signed out on public routes, as bound. The Record Key Card path cannot be exercised until embryo ingest lands. |
| T6 and T7 fixtures | The exclusive all-task launcher authors fresh per-simulation native publication and read/action lifetimes for both tasks. The ordinary shared-stack path still refuses them. Native full-round execution and inference qualification remain unrun. |
| Provider token and cost bounds | Blocked on a credential. A calibration run measures them; a paid full run refuses to start without one. |

No real participant, human review, clinical interpretation, expense or
release acceptance is inferred from any of this.
