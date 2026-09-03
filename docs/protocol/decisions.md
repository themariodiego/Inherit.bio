# Protocol decision ledger

This ledger is append-only. It records decisions that affect how acceptance
evidence is interpreted.

## 2026-09-01 — Naming-gate history boundary

- Decision: the no-comparator name gate scans the whole current working tree
  and every reachable commit message whose committer timestamp is later than
  baseline commit `864736979c92a08ba77e8580d61946eba6864918`.
- Reason: history published before that baseline remains part of the public
  AGPL provenance and the density evidence. Rewriting it would invalidate
  existing commit and tree identities without improving the shipped tree.
- Consequence: pre-baseline history is explicitly out of scope; current files
  are never grandfathered, regardless of when their text first appeared.

## 2026-09-03 — Consolidation onto `main` and the lost readability batch

- Decision: pull requests 11–40 were merged into each other's feature
  branches, not into `main`. The tip of that chain
  (`codex/readability-incident-response-remediation`, 32 commits) is merged
  onto `claude/inherit-service-redesign-3r43mb` and proposed to `main` as one
  pull request (#41). Further v2 work continues on that branch.
- Reason: `main` stopped at pull request 10; every later "merged" pull request
  was invisible to production and to CI on `main`.
- Consequence: the previous session's final readability batch (self-hosting,
  terms, state-privacy rewrites and runtime-copy extraction) was never pushed
  and could not be recovered from the remote. Its copy scope was redone here;
  the runtime-copy extraction remains open and keeps G1.10 at NO.

## 2026-09-03 — Modelled-figure marker string

- Decision: the once-per-claim-block marker for modelled figures is the gate
  string in G4.2, `This is a model, not an observed outcome.` The §4 §3.5
  sentence `This is a modelled estimate, not a measurement.` is not rendered
  in addition, because two sentences saying the same thing on every card is
  the caveat-stacking X0.1 forbids.
- Reason: §8 defines complete resolution and its detector asserts the G4.2
  string once per block; §4 governs what a surface may say but the two strings
  carry the same claim, so choosing the gate-checked one loses no accuracy.
- Consequence: `src/lib/figures/contract.ts` exports the single marker;
  `e2e` and unit tests assert it once per `[data-claim-block]`.

## 2026-09-03 — Natural-frequency denominator rule

- Decision: X4.1 governs. Denominators are 100, 1,000, 10,000, 100,000 and
  1,000,000; one denominator per claim block, the smallest that renders every
  figure in the block as an integer of at least 1 and keeps figures that
  differ by more than display precision distinct; otherwise the block renders
  `Fewer than 1 in a million, both for you and for the comparison group.`
- Reason: G4.1's two-rung rule (100, then 1,000) and §4 §2.3's four-rung
  ladder conflict with each other; X4.1 is the cross-cutting rule and says the
  matching regex must admit 100.
- Consequence: `src/lib/figures/natural-frequency.ts` implements the rule;
  tests pin the worked vectors.

## 2026-09-03 — Presentation decisions taken from the reconciled spec

Each item names the competing texts and the rule that decided it. The full
reconciliation is in the session's spec derivation; these are the defaults
the shipped code follows.

- Percentile withheld. Today's percentile is computed against one
  cohort-wide reference distribution with no named panel, no size and no
  interval, and no absolute risk exists beside it. X4.2 and §4 §2.5 forbid
  rendering a percentile in that state, so no surface renders one; coverage
  facts move to the expert data page.
- One not-diagnostic line everywhere: the §5 §6.1 sentence ("This is not a
  diagnosis. Inherit is not a doctor and no clinician has reviewed this.
  Talk to a qualified professional before acting on anything here."). G4.8's
  alternative sentence is not added as a second line; legality precedence.
- "What you can do" empty state uses §3 §2.2's sentence ("There is nothing
  you need to do about this result. It does not change what any doctor
  would advise for you today.") because X13.1 adopted that heading and §3
  defines the heading and its empty string as one unit.
- Layer group labels are "Specific variants" and "Statistical estimates"
  with §4 §1.3's definition sentences (X5.1); §2's "Single-gene findings"
  and "Whole-genome estimates" are not used.
- Starter list selects `layer = 'variant_call'` or
  `estimate_kind = 'single_locus'`, evidence in (clinical, established,
  emerging), categories outside Brain, memory and mood and Cancer, covered
  by the subject's files; the same reasoning X5.3 applied to the evidence
  clause applies to the layer clause (a day-one empty state would be false).
- Overview `h1` is "Overview" (nav-label identity, route register); §2's
  "Welcome to Inherit." sub-line survives as the State A lede. Section
  headings are "My Genome", "Family", "Embryos" (X9, nav labels).
- Copilot is a route, not a dock (X1.2); report-scoped chats use
  `/copilot/{subject}?report={slug}`.
- Legacy redirects are all 308 (route register is canonical, X1); the two
  temporary `redirect()` stubs are to be changed to `permanentRedirect()`.
- The State A "Show me what this looks like first" item renders only once
  `/example/report` exists; a dead link is never shipped.
- The eight subject colour tokens are added to `src/app/globals.css` as an
  extension (X2.4); a unit test pins the frozen identity tokens (G2.7) and
  the 3:1 contrast on both grounds in both themes.

## 2026-09-03 — Example surfaces and response headers

- Decision: no `/example/*` or `/demo` route is built. The route register's
  `supersededProposals` and `docs/canonical-artifacts.md` already reject
  every production, user-reachable example or fixture-derived result surface
  under G8.2, anti-pattern 2 and C6; the brief's X1.3 permission is the
  earlier draft. The Overview "Start here" strip therefore renders two items
  until an example surface exists, never a dead link.
- Decision: the register's `authenticatedUserData` header profile is applied
  in `src/proxy.ts` to every protected page, every `/api/` response and the
  proxy's own redirects. No such headers were set before; this is a
  privacy defect fixed under legality/security precedence.

## 2026-09-03 — Report skeleton, Overview and readability extension

- ADR numbering: the specification's A.12 names `0006`–`0015` for decisions
  the tree had already numbered differently (`0006` secret fixtures, `0007`
  name denylist, `0008` readability, `0016` transport). Accepted ADRs keep
  their numbers (the repository is ground truth, C1); new gating ADRs
  continue from `0009` and take the next free number, so the A.12 names are
  retitled, never renumbered over an accepted record. `0009` statistical
  presentation, `0010` Overview information architecture and `0011` report
  taxonomy are written from decisions this branch implemented; the
  jurisdiction, third-party consent, embryo-comparison, future-child and
  density ADRs wait for their workstreams so nothing in them is invented.
- The coverage sentence (`Your file covered {x} of the {y} positions this
  estimate uses.`) renders on the estimate layer only: it names "this
  estimate", so on a variant-call report it would be a false description.
- Copilot boxes for Family and Embryos link to `/family` and `/embryos`
  while `src/app/(app)/copilot/[scope]` serves only `me` and `s-{uuid}`; a
  dead link is never shipped (same rule as the example item).
- One home per mandated sentence: the not-diagnostic line and the estimate
  definition live in `src/copy/reports/strings.ts` and Overview re-exports
  them; the nav labels live in `src/copy/navigation.ts` and every breadcrumb
  and domain heading reads them from there.
- The plain-vocabulary check reads contractions as their full words
  (`don’t` is `do not`), because the mandated label `I don’t have one yet`
  must be checked on real words and registering `dont` as a word would make
  the register lie about what is plain.
- `classification` (alias `clinical classification`) joins the jargon
  register so the mandated layer definition (brief line 1178) grades at 6.3
  under the registered-term rule instead of failing at 9.1; the sentence is
  not reworded because it ships character-for-character.
- E2E specs read the seeded template count from `data/templates` through
  `seededTemplateCount()`; no spec hard-codes the library size.
- The subject chip and the subject bar carry `data-subject-id` as §2 §4.3
  and §2 §2.3 require; neither is an ancestor of a figure, so the X4
  single-attributed-ancestor rule is unaffected.
- The printable export shows the public evidence label; the machine-readable
  JSON export keeps the enum value so its schema does not change.

## 2026-09-03 — Review round on the report and Overview surfaces

Two of the four adversarial reviewers completed before the session's usage
limit stopped the refuters; their 22 findings were triaged by hand against
the specification digest and the code. Nineteen were confirmed and fixed,
three are recorded as follow-ups. Decisions taken while fixing:

- The report `h1`, the last breadcrumb crumb and the document title are the
  template title up to the first ` · ` (§4.3 item 3); the gene symbol is
  provenance, listed under "Where this comes from" with a dbSNP link and
  `chr:pos ref→alt`. A per-variant label stays in "Your result" only when a
  template has more than one variant, so a reader can tell the blocks apart.
- The coverage sentence and the study count are counts of positions and
  citations, not result figures: they render as text with the
  `inherit-figure-exempt` marker rather than as a second attributed claim
  block (`e2e/report-skeleton.spec.ts` pins exactly one block per
  single-variant report).
- "What this doesn’t mean" ships one generic bullet, `It does not say what
  will happen to you.`, true for traits and conditions, plus `A missing
  result is not a negative result.` when a position is not covered (D16);
  the former second bullet restated the not-diagnostic line.
- The reports list keeps the search input (`#report-search`, §4.4 item 7)
  but the category strip stays inside a `Filter reports` disclosure at every
  width: subject bar (2) + Why? (1) + search (1) + eight chips + three cards
  exceeds the twelve-interactive first-viewport budget at 1280×800.
- The kind chip is derived relative to the viewer: an adult record whose
  subject account is the viewer (an accepted invitation) is the viewer's own
  genome and reads "You"; a `minor` record renders no chip (D11); "Add a
  file" renders only on the `self` record because the upload path binds every
  file to the caller's own record.
- The subject-bar file count is the count of every file in the record,
  whatever its status, because the link lands on `/files`, which lists them all.
- Overview resolves State B (any file in flight) before C/D; a record bound
  to the viewer is never listed as another adult; the ancestry line renders
  only when the too-few-markers statement is true and never a "regions
  found" count (D26); the sidebar's second disclaimer is removed.
- Follow-ups, not fixed here: runtime links still use literal paths (task:
  `src/lib/primary-routes.ts`); the report h1 identity is re-checked by
  `gate:templates` once the prose checks land; the upload path honouring a
  subject segment belongs to the Family workstream (G2.6).
- The Overview's variant-call count carries a twelve-word-cap note shortened
  from the mandated definition (`Results read from one spot in your DNA.`)
  with the full definition rendered adjacent, mirroring the estimate half;
  the definition itself is eighteen words and X9.1 caps every metric note at
  twelve. Dormant until a `variant_call` template is published.

## 2026-09-03 — Template prose: titles without jargon, no naked relative figures (W5)

- `pnpm gate:templates` applies §4 §2.4 to `report_templates.summary` and
  `variants[].interpretations` exactly as the brief's binding check defines
  adjacency (a `%`, `x`, `×` or `-fold` token within 40 characters of
  "lower", "higher", "reduction", "increase", "less likely", "more likely" or
  "times"), and additionally treats any numeric multiplier ("1.4x the odds",
  "about 5 to 7 times", "1.7-fold") as a relative figure wherever it stands,
  because §2.4 bans the odds ratio itself, not only its symbols beside a
  comparison word. An `x` counts only when a digit precedes it, so
  "X chromosome" and "x-linked" are never findings.
- Inherit holds no absolute baseline to pair a ratio with, so a rewritten
  sentence keeps the direction and replaces the number with one phrase from a
  bounded set chosen from the ratio removed: below 1.15 "a very small
  shift", 1.15–1.5 "a small shift", 1.5–2.5 "a moderate shift", above 2.5
  "a large shift" (inverses for protective results; a range spanning two
  bands reads "a small to moderate shift"). Percentages that state how common
  a result is, and absolute differences with a unit, are not relative
  figures and stay. Nothing is added: no number, study, population,
  mechanism, caveat or advice the original lacked.
- The first-glance title (G3.5) is checked on the stored title: at most
  twelve words, no term or alias from `data/jargon.json`, no bare figure
  (a decimal, a percentage, a multiplier, or an integer followed by a
  quantity word; an integer inside a name such as "Type 1 diabetes" or
  "codon 72" is not a figure). Titles keep the existing `Topic · GENE` shape
  and change only the words that fail; the report page's h1 already drops
  the gene suffix.
- ADR 0012 widened from cancer/immune/embryo to every everyday word the
  specification itself mandates in a heading or a report needs for its
  condition's name (disease, vitamin, hormone, celiac, metabolism, trait,
  genome), because a register that forbids a mandated heading is a
  contradiction, not a rule; thirteen genuine terms keep it above 200.
- Each rewrite was produced against a written rulebook and a checker, then
  reviewed sentence by sentence by a second agent for preserved meaning; the
  five sentences that rose above grade 9 only because of the register change
  were rewritten by hand with the same rules.
