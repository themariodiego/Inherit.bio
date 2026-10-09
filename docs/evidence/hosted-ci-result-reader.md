# Read a complete hosted CI result

Use this tool after the stated CI run is complete. It reads GitHub with GET
requests. It does not start or repeat CI, tests, an app, a database or a deploy.
It does not send a message or approve a merge.

Use the locked Node 22 and project dependencies. Keep the input and output
outside the source checkout. Each output must be a fresh path under an owned
directory. The tool makes the output private: directory mode 0700 and file
mode 0600. It refuses an existing path, a changed path or an alias of source or
input evidence. Raw job logs stay in that private output. Do not commit them.

Prepare a JSON request with these fields:

```json
{
  "schemaVersion": 1,
  "repository": "example/ci-fixture",
  "runId": 123,
  "runAttempt": 1,
  "workflow": ".github/workflows/ci.yml",
  "head": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "testedHead": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "tree": "dddddddddddddddddddddddddddddddddddddddd",
  "event": "push",
  "branch": "main"
}
```

These values are synthetic examples. Use the actual run and source values.
For a PR request, use `event: "pull_request"`, remove `branch`, and add the
actual `pullRequest` number and `base` commit. `head` is the PR head;
`testedHead` is its tested merge commit. The tested tree must be the exact
reviewed tree. The tool checks the actual parent vector. A merge pushed to
main can have two parents; a push does not imply one parent.
The local Git repository must contain both commits. The PR head and tested
merge must have the same reviewed whole tree. A difference is HOLD.

Capture the stated run once:

```sh
pnpm exec tsx scripts/hosted-ci-result.run.mts capture /private/path/request.json /private/path/fresh-capture
```

Read that saved capture into another fresh output:

```sh
pnpm exec tsx scripts/hosted-ci-result.run.mts review /private/path/fresh-capture /private/path/fresh-review
```

Capture retains original stdout, stderr, command outcomes, readback hashes and
source vectors. It writes an original command result before any raw readback
or source post-check. Each GET has a 60-second limit, with at most three
downloads at a time and no application retry. It reads at most one page of
100 metadata items; an incomplete page is HOLD. It downloads required job
logs and the seven sanitized coverage ZIPs, without extracting a ZIP.
Only exact verified job-log routes use the CLI's `--allow-escape-sequences`
flag. Raw bytes go to private output files, never to the terminal. JSON and
ZIP routes keep their original arguments. Saved review reconstructs the same
exact arguments before it admits the original command result.

The reader checks the pinned workflow and producer code. It requires the full
job family, every declared source step, and success for every required step.
Only a source-declared failure-only artifact upload can be skipped on a green
run. This does not permit a skipped test case. Missing, duplicate, cancelled
or failed evidence is HOLD.
Head checks must be nonempty. A tested PR merge can have no direct check-run
entries only when the exact PR request, base, head, merge and all required CI
jobs have passed the preceding metadata checks. The tool derives each check
revision from that request and its explicit role. A push has no empty-check
exception. Nonzero inventories must be complete and use the exact revision.

Browser counts come from the actual full manifest and six receipts. Existing
checks require full, assigned and executed case equality, one whole file and
project group per job, zero skips or retries, provider uploads, the selected
profile hash, spread accessibility sweeps and isolated queue journeys. There
is no fixed historical case or file count in this reader. The current source
registry remains authoritative.

This first version supports the current producer schema. The tested source
must have the same pinned producer and reader contracts. A new contract,
unknown ZIP member or six-project QC sidecar is HOLD and needs a reviewed
reader change. The reader does not remove or ignore a sidecar to pass a check.

Unit, database, lock and Lighthouse numbers come from unambiguous original
command sections. Missing summaries and failed or skipped cases are HOLD.
These summaries do not create per-case identities that CI did not save.

The receipt keeps required-job wall time separate from the API update
interval, browser body time, setup time and summed case durations. One run's
time is an observation. It does not prove a future speed gain.

`CAPTURED_UNREVIEWED` means that raw files were saved. `VALIDATED_SAVED_RUN`
means that the machine checks passed on those files. A different author must
still review the result. The root must check the current head and base again
before a merge. Native database, provider, clinical and release checks retain
their separate requirements. All complete hosted suites remain required on
the final source.
