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

**DONE, 2026-09-11, and this section is kept only as the record of why.** The
remedy above was applied in `5410622`: `briefSha256` now holds `2d6bc519…`,
which is what the brief hashes to, and `scripts/route-gate.ts` reads both files
and fails when they differ. `gate:routes` runs in the static half of CI, so the
mechanism this section said did not exist is now the one enforcing the intent.
The old value survives on purpose at `scripts/route-gate.test.ts:283` as a
negative fixture, so the check is proved to fail on a wrong pin rather than
passing vacuously. Nothing in this section is awaiting signature.

Three rows of `docs/acceptance-matrix.md` went on citing the unfixed finding
for a further day; they were corrected separately. The lesson is worth keeping
beside the fix: **a written finding goes stale exactly the way a superseded
migration does**, and both have now cost this project a wrong conclusion.

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

## 5. The register declares `jurisdiction-unavailable` on eleven routes that cannot reach it

**Measured 2026-09-11 against the page components, not estimated.** This is the
same shape as item 4 above and needs the same decision.

`stateProfiles` applies `product-result` (and the settings profile) wholesale,
so twenty routes declare `jurisdiction-unavailable` with no browser proof.
Reading what each page actually does splits them cleanly in two.

**Nine implement the refusal.** It is reachable, and proving it needs a paired
family fixture rather than a register change:

| route | how it refuses |
|---|---|
| `/genome/[subject]/ancestry` | `resolveSubjectRoute` -> `kind: "jurisdiction"` -> `CapabilityUnavailable` |
| `/genome/[subject]/reports` | same |
| `/genome/[subject]/reports/[slug]` | same |
| `/family` | `familyCapability` |
| `/family/[person]/permissions` | jurisdiction guard |
| `/family/health-picture` | `familyCapability` |
| `/family/portrait/[pairId]` | `familyCapability` |
| `/overview` | `familyCapability` |
| `/embryo-analysis` | jurisdiction guard |

**Eleven cannot reach it**, and for the genome trio the reason is precise and
worth stating rather than summarising: `/genome/[subject]`,
`/genome/[subject]/data` and `/genome/[subject]/data/browser` resolve with
`resolveSubjectForAccount` — the OWN-subject resolver — and never with
`resolveSubjectRoute`. A family segment does not resolve on those routes at
all, so the page answers not-found instead of refusing.

**That is not a fail-open.** No family data is served by those routes, so the
missing refusal withholds nothing it should withhold. It is worth saying
explicitly because `G5.1` records that "no complete resolver/gate protects
every data-returning route", and this is one place that sentence could be read
as a security gap when it is not.

The other eight have no jurisdiction guard at all: `/settings`,
`/settings/consents`, `/settings/copilot`, `/settings/data`, `/files`,
`/files/upload`, `/copilot/[scope]`, `/family/[person]`. For `/settings` the
absence is already deliberate and already tested — `e2e/family-invite.nojurisdiction.spec.ts`
visits it on the jurisdiction-off server as its control and asserts a 200 with
the account still signed in, precisely so that a refusal elsewhere cannot be
confused with a broken session.

**Proposed:** drop `jurisdiction-unavailable` from the declared states of those
eleven routes, so the register describes the product that exists.

**THE QUESTION THIS TURNS ON, and it is yours rather than mine.** The proposal
above assumes the product is right and the register over-declares. The opposite
reading is available for exactly one of the two groups: if `/genome/[subject]/data`
and `/genome/[subject]/data/browser` are *meant* to serve a family subject's
data — the brief's §4 does describe viewing a relative's genome — then those
two routes are missing a capability rather than carrying a surplus declaration,
and the correction is the opposite one: leave the state declared and build the
resolver. Nothing here decides that. The settings and files routes are not
affected either way; their absence of a guard is not in question.

---

## 6. `consent-required` is declared on twenty routes and implemented on none of them

**Measured 2026-09-11, by the same method as item 5**, and the result is
cleaner than that one.

Exactly three pages render a consent-required state: `/embryos/[embryoId]` and
`/embryos/compare`, both through `BlockingState` in
`src/components/embryo/states.tsx`, and `/family/portrait/[pairId]` through
`src/components/family/portrait/portrait-blocking.tsx`. **All three are already
proven** in the route-state ledger.

It follows that every route still declaring `consent-required` without a proof
does not implement it at all: `/embryo-analysis`, `/embryos`,
`/embryos/request-data`, `/embryos/upload`, `/family`, `/family/[person]`,
`/family/[person]/permissions`, `/family/health-picture`, `/family/invite`,
`/genome/[subject]`, `/genome/[subject]/ancestry`, `/genome/[subject]/data`,
`/genome/[subject]/data/browser`, `/genome/[subject]/reports/[slug]`,
`/overview`, `/settings`, `/settings/consents`, `/settings/copilot`,
`/settings/data`, `/settings/people`.

Checked three ways rather than one, because a negative is easy to get wrong:
the page components themselves, the call sites of both shared blocking
components, and the absence of any gate above them — there is no
`src/middleware.ts`, and the `(app)` layout carries no consent check. A route
that refused by REDIRECTING rather than by rendering a state would not show up
in the first two checks, which is why the third was done.

### The two authority states together

| state | declared and unproven | implement it | over-declared |
|---|---|---|---|
| `jurisdiction-unavailable` | 20 | 9 | 11 |
| `consent-required` | 20 | 0 | 20 |

**So 31 of the 40 unproven authority pairs are register over-declarations, and
9 are genuine test work.** That is worth putting beside G2.2's own estimate,
which places 50 of the remaining pairs in "needing new test-side setup only".
For these two states the reachable figure is nine, and all nine sit behind one
paired-family fixture.

**Proposed:** drop `consent-required` from the declared states of those twenty
routes, on the same signature as item 5.

**What this does NOT say**, and the distinction matters as much here as in item
5: it does not say those routes should never require consent. `/settings/consents`
in particular is a page *about* consent, and `/genome/[subject]/reports/[slug]`
serves genetic findings. The measurement is only that no such refusal exists
today, so the register currently describes behaviour the product does not have.
If any of these routes ought to gate on consent, the correction for that route
is to build the gate rather than to drop the declaration — and that is a
product decision, not a register tidy-up.

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
