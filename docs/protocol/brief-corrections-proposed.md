# Proposed brief corrections — awaiting operator signature

**Status: PROPOSED. Nothing here has been applied to `docs/inherit-v2-brief.md`.**

The operator asked for these to be drafted for sign-off rather than made. Each
item below gives the exact text to replace, the exact replacement, and why.
Apply them together or item by item; each is independent except where noted.

Four are factual corrections about what is in this repository, which the brief
itself invites: §1.1 is headed *"What already exists (ground truth — read the
repository before writing any code)"*, so an inventory that is wrong about the
tree is a defect in the brief's own terms rather than a change of intent. The
fifth is a decision the operator has taken. The sixth is a mechanism that was
believed to exist and does not.

---

## 0. The pin that was never real

**This one is not a proposal. It is a measurement, and it changes how the
others should be read.**

`docs/route-register.json` carries `briefSha256`:
`2914f42bba3ccdb34816f07c23b4cffdee14f3328b4fa5f2a0f231133be9abbe`. The brief
hashes to `2d6bc5194bc5dc936930d4439c34dae34c0409ee478c339b73d46b262bc72162`.

Measured 2026-09-11, and the obvious explanations were ruled out before this
was written:

- The brief has exactly **one** commit in its history, `d2ed086`, and its
  content hash has been `2d6bc519…` since that commit. This is not drift.
- The pin was introduced later, in `c078de4`, already holding `2914f42b…`.
  It has therefore **never** matched the file it names.
- It is not a different hashing convention. Raw bytes, trailing newline
  stripped, whitespace-normalised and CRLF all produce different values, none
  of them the pinned one.
- **No file tracked in this repository hashes to the pinned value.** It
  corresponds to nothing.
- Nothing reads it. `briefSha256` appears in no script under `scripts/` and no
  module under `src/`, so no gate has ever compared it to anything.

Why it matters beyond tidiness: several arguments in `docs/acceptance-matrix.md`
and in this session's pull requests rest on the sentence *"the register is
derived from the brief and pinned to `briefSha256`"*, and use it to conclude
that a register entry cannot be written until the brief changes. The governance
intent is sound and worth keeping. The mechanism claimed to enforce it does not
exist. Any reasoning that leaned on the pin as evidence should be re-read as
leaning on the intent alone.

**Proposed remedy**, which is engineering rather than an operator decision and
can be done without signature: set `briefSha256` to the brief's real hash and
add a check to `scripts/route-gate.ts` that fails when the two differ, so that
editing the brief without revisiting the register is caught. If the intent was
that the register tracks a specific brief *version*, that is exactly what this
makes true for the first time.

---

## 1. `POST /api/uploads` — the brief denies a route that exists

**File:** `docs/inherit-v2-brief.md`, §6, line 2194, in *"Where the PDF refusal
happens"*.

**Replace:**

> ADR-0001 sends every upload browser → Storage over TUS, so no upload transits
> a function and a `POST /api/uploads` rejection is unreachable — there is no
> such route.

**With:**

> ADR-0001 sends every upload browser → Storage over TUS, so no upload transits
> a function and a `POST /api/uploads` rejection of the bytes is unreachable:
> that route exists, but it carries a declaration rather than a file.
> `src/lib/uploads/subject-upload-issuance.ts` reads at most 4096 bytes of JSON
> — `subjectId`, `declaredFormat`, `sizeBytes`, `sha256` — never the file and
> never a filename, and mints the direct-to-Storage bearer.

**Why.** The route exists and the sentence says it does not, which is why no
register entry was ever written for it. The paragraph's *conclusion* is
untouched and was checked rather than assumed: bytes still go browser to
Storage, and a byte-level refusal genuinely cannot live there, which is exactly
why it lives in `sniffFile` and `POST /api/files/[id]/process` as the rest of
the paragraph says. Only the existence claim is wrong.

---

## 2. Three built routes missing from the §1.1 inventory

**File:** `docs/inherit-v2-brief.md`, §1.1, lines 76–77, the `api:` list.

**Replace:**

> `api`: `/api/chat` `/api/export` `/api/account/delete` `/api/browse/region` `/api/files/[id]/download`
> `/api/files/[id]/process` `/api/llm/settings` `/api/jobs/{annotation-refresh,research-publish,research-refresh}`.

**With:**

> `api`: `/api/chat` `/api/export` `/api/account/delete` `/api/browse/region` `/api/files/[id]/download`
> `/api/files/[id]/process` `DELETE /api/files/[id]` `/api/uploads` `/api/uploads/[id]/complete`
> `/api/llm/settings` `/api/jobs/{annotation-refresh,research-publish,research-refresh}`.

**Why.** All three are built and reachable today and none is enumerated, so the
register has no path to transcribe.

- `DELETE /api/files/[id]` is the deletion verb, called by
  `src/lib/uploads/file-delete-browser.ts`. It is bound by registered deletion
  deadlines, which makes an undeclared contract here worse than an ordinary
  gap. The capability is already authorised twice in the brief — line 1073
  requires keyboard-only completion of "delete a file" as one of seven named
  journeys, and line 2003 lists the existing "deletion route" among what v2
  extends — so this enumerates a path for a capability the brief already wants,
  rather than adding one.
- `POST /api/uploads/[id]/complete` is the finalization half of the same
  journey and **carries `maxDuration = 300`**. That is the ~300-second
  finalization ceiling the operator's own priority 1 asks to solve, and it
  currently sits on a surface the register cannot describe.

**Note.** §1.1 is a ground-truth inventory of what existed when the brief was
written, and items 1 and 2 make it accurate rather than aspirational. If the
operator would rather §1.1 stay a frozen historical snapshot, the alternative
is a short "corrections to §1.1" subsection recording what was found later;
say which is preferred and it will be written that way.

---

## 3. The account-deletion nonce mint is undescribed

**File:** `docs/inherit-v2-brief.md`, §6, wherever the account-deletion contract
is stated (proposed as a new sentence in that paragraph).

**Add:**

> `GET /api/account/delete` mints the one-time operation nonce that the
> registered `POST` body requires. It checks same-origin and a sensitive account
> context, then calls `issue_account_operation_nonce_v1` through the service
> role.

**Why.** The registered `POST` body requires a
`required-recent-one-time-operation-nonce` and the brief never says where that
nonce comes from. The code answers with an undeclared `GET` on the same path.
It is real, needed, and load-bearing for account deletion, and it is the one
verb on that path with no declared auth mode, no rate-limit binding and no
response contract.

---

## 4. Routes that cannot reach a fault should not declare `error`

**Decision taken by the operator 2026-09-11.** Recorded here because the
register cannot act on it until the brief says so.

**Add**, in §2 beside the route/state vocabulary:

> A route declares the `error` state only where a fault is reachable. Routes
> that answer bad input with `notFound()` do not declare it.

**Why.** The register requires an `error` state on 62 routes and **no browser
test can reach any of them**, because the product has no fault seam. Verified
2026-09-11 rather than inferred: four error boundaries exist
(`src/app/error.tsx`, `(app)/error.tsx`, `(marketing)/error.tsx`,
`global-error.tsx`), 19 files call `notFound()` so parsed-parameter routes take
the not-found path instead of throwing, and there is no fault, injection or
simulate flag anywhere in `src/` or `scripts/`. `e2e/error-boundary.spec.ts`
already pulls the only lever available — aborting the RSC payload — and proves
that *nothing fails*: Next falls back to a full document load and the page
renders.

**Effect.** 62 of the 219 remaining route/state pairs stop being unprovable
obligations, and 22 routes complete immediately — `/`, `/providers`, `/about`,
`/changelog`, `/privacy`, `/terms`, the three `/science` pages and thirteen
`/legal` pages, each of which currently sits one pair from complete with
`error` as its only gap. The error boundaries keep their unit coverage in
`src/components/site/error-content.test.ts` and `src/app/boundaries.test.ts`;
this changes what the register *declares*, not what the product does.

---

## What happens after signature

1. Apply the signed items to `docs/inherit-v2-brief.md`.
2. Set `briefSha256` to the new real hash and add the gate check from item 0.
3. Transcribe the register entries for items 1–3 — methods, auth modes,
   rate-limit bindings, response contracts — from the brief text, not from the
   code.
4. For item 4, drop `error` from the affected `stateProfiles`, lower
   `UNPROVEN_ROUTE_STATE_PAIRS` by the exact number the gate reports, and diff
   the proven set against the ledger before touching the number.
5. Record the outcome in `docs/protocol/decisions.md`.
