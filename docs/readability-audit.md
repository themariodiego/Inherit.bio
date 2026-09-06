# Readability audit

## 2026-09-06 — accountless invitation refusal

The refusal UI uses ten newly registered ordinary words: `anything`,
`choice`, `decline`, `declined`, `else`, `need`, `part`, `recorded`,
`take` and `want`. These make the action and receipt readable without a
typed signature or legal terminology. The vocabulary additions do not change
the scorer, thresholds, sentence cap, jargon rules or fixture expectations.
The gate passes across 2,434 blocks after this registration.

Date: 2026-09-01

Baseline: `864736979c92a08ba77e8580d61946eba6864918`

Run:

```sh
pnpm gate:readability
```

The deterministic extraction currently covers 1,489 user-visible blocks:

- 942 long blocks from static TSX, the 151 report templates, rendered provider
  fields, and seeded consent artifacts;
- 397 short strings selected by rendered role;
- 252 onboarding, consent-summary, result-headline, status, and error blocks
  subject to the 25-word sentence cap.

The pinned ten-case scorer self-test passes. The short-role vocabulary and
sentence-length rules are clean. The command currently exits non-zero with
12 long-block grade findings, concentrated in long legal copy.
There is deliberately no baseline allowance and the command is not yet wired
into CI.

The first remediation pass removed 22 genuine findings from application UI and
reusable components without deleting caveats. It also corrected the extractor
so a parent status or list container no longer concatenates its nested heading
and paragraph into a synthetic copy block. Three regression tests prove that
nested blocks remain separate, inline markup remains part of its block, and
visible text attributes are still extracted. Two Copilot paragraphs remained
in the application-route set at this stage because an earlier brief section
required their wording verbatim. The final X7.2 contract resolves that conflict
by requiring long mandated strings to be split while preserving every clause.

The second remediation pass removed all 24 findings from non-legal marketing
and science pages. It also aligned the About and home pages with the provider
directory: marked affiliate links may earn a commission, but the buyer still
pays the lab directly. The open-source link now names the current
`themariodiego/Inherit.bio` repository. Legal, privacy, terms, provider-data,
and report-template wording were intentionally left for their own review
batches.

The third remediation pass removed all 27 findings from displayed provider
metadata: 16 privacy-practice notes, 10 shipping descriptions, and one
clinician-ordering description. The rewrites retain country exclusions,
consent and opt-out choices, policy dates, laboratory locations, ordering
rules, and shipping costs or delays. Prices, product compatibility, source
URLs, and verification summaries were not changed.

The fourth remediation pass removed all 32 findings from the lifestyle and
wellness report category: 10 summaries and 22 genotype interpretations. The
rewrites retain each allele direction, phenotype, effect size or population
frequency, evidence status, study limitation, and measurement caveat. A
category-level regression keeps this template file at zero findings while the
remaining report categories are remediated.

The fifth remediation pass removed all 28 findings from the brain-health report
category: 10 summaries and 18 genotype interpretations. The rewrites preserve
the tested allele direction, population or effect size, evidence label, study
design, replication status, and limits on individual prediction. A second
category-level regression keeps this template file at zero findings.

The sixth remediation pass removed all 27 findings from the gastrointestinal
report category: 9 summaries and 18 genotype interpretations. The rewrites
retain allele direction, population and effect-size qualifiers, clinical
penetrance, medication and test caveats, study limits, and the distinction
between inherited tendency and current health. A category-level regression
keeps the file at zero findings.

The seventh remediation pass removed all 27 findings from the longevity report
category: 8 summaries and 19 genotype interpretations. The rewrites retain
allele direction, odds and cohort sizes, population qualifiers, biological
trade-offs, replication status, and limits on individual prediction. A
category-level regression keeps the file at zero findings.

The eighth remediation pass removed all 25 findings from the mental-health
report category: 8 summaries and 17 genotype interpretations. The rewrites
retain allele direction, odds and population baselines, gene-environment
interactions, biological trade-offs, replication status, study limits, and
limits on individual prediction. A category-level regression keeps the file
at zero findings.

The ninth remediation pass removed all 24 findings from the basic-traits
report category: 8 summaries and 16 genotype interpretations. The rewrites
retain allele direction, trait direction, effect sizes, study and population
sizes, ancestry qualifiers, functional findings, replication limits, and the
distinction between group trends and individual outcomes. A category-level
regression keeps the file at zero findings.

The tenth remediation pass removed all 21 findings from the addiction report
category: 9 summaries and 12 genotype interpretations. The rewrites retain
allele and effect direction, effect sizes, ancestry and exposure qualifiers,
alcohol-related cancer warnings, medication non-dosing language, study-size
and replication limits, and the distinction between group trends and
individual outcomes. A category-level regression keeps the file at zero
findings.

The eleventh remediation pass removed all 20 findings from the aesthetic and
cosmetic report category: 9 summaries and 11 genotype interpretations. The
rewrites retain allele and trait direction, effect and population sizes,
ancestry and X-chromosome qualifiers, functional findings, sun-protection and
melanoma language, and the distinction between group trends and individual
outcomes. A category-level regression keeps the file at zero findings.

The twelfth remediation pass removed all 19 findings from the heart and
cardiovascular report category: 8 summaries and 11 genotype interpretations.
The rewrites retain allele and effect direction, absolute-versus-relative risk
language, exposure interactions, ancestry qualifiers, direct-test and clinical
follow-up guidance, and limits on individual prediction. The CETP B2B2 copy
also corrects the coronary odds comparison from about 20% lower to about 10%
lower versus B1B1, consistent with the cited review's per-allele estimate. A
category-level regression keeps the file at zero findings.

The thirteenth remediation pass removed all 22 findings from the privacy
policy. The rewrites retain the named infrastructure providers and processor
limits; bans on tracking, analytics, sale, and sharing; consent-gated AI chat;
law-enforcement limits; immediate deletion and free export; child-data rules;
change-of-control protections; legal separation from Plus Bio; and every
listed GDPR and CCPA/CPRA right. A page-level regression keeps the privacy
policy at zero findings.

The fourteenth remediation pass removed all 17 findings from the environmental
sensitivity report category. The rewrites retain allele and effect direction,
population and ancestry limits, exposure and non-genetic factors, effect sizes,
study design, replication status, and limits on individual prediction. The
photic-sneeze copy also corrects its cross-population comparison: both cited
studies associate the C allele with higher odds, rather than reporting opposite
directions. A category-level regression keeps the file at zero findings.

The fifteenth remediation pass removed all 16 findings from the reproductive
and family report category. The rewrites retain carrier-screening and clinical
confirmation limits, inheritance probabilities, allele and effect direction,
effect sizes, ancestry and population qualifiers, study design and replication
status, clinical follow-up, and limits on individual prediction. The FSHR copy
now attributes the higher average stimulation requirement specifically to early
IVF studies rather than presenting it as a universal result. A category-level
regression keeps the file at zero findings.

The sixteenth remediation pass removed all 15 findings from the metabolic and
obesity report category. The rewrites retain allele and effect direction,
effect sizes, ancestry and lifestyle qualifiers, hormone and metabolic
measures, study design, and limits on individual prediction. The APOA2
gene-diet result remains labeled preliminary, and the GIPR diet-response copy
still identifies its single-trial basis and lack of a high-fat genotype effect.
A category-level regression keeps the file at zero findings.

The seventeenth remediation pass removed all 14 findings from the
neurodegenerative report category. The rewrites retain allele and effect
direction, effect sizes, ancestry qualifiers, absolute-risk limits, clinical
confirmation guidance, disease distinctions, and limits on individual
prediction. The LRRK2 copy now cites later family cohorts for its age-80
penetrance range instead of relying on the older study's higher estimate. The
GBA1 copy now attributes the five-fold estimate to the cited study's combined
variant group rather than to N370S alone. Later primary studies were also added
for the UNC13A frontotemporal findings and the TMEM106B C9orf72 modifier. A
category-level regression keeps the file at zero findings.

The eighteenth remediation pass removed all 12 findings from the autoimmune
report category. The rewrites retain allele and effect direction, effect
sizes, ancestry limits, HLA-tag uncertainty, direct-typing guidance,
population frequencies, absolute-risk limits, disease distinctions, and
limits on individual prediction. The HLA-B27 copy no longer presents a fixed
carrier penetrance across populations. It now adds a heterogeneous-population
study that measures the rs4349859 tag directly and keeps blood-based HLA typing
as the clearer result. A category-level regression keeps the file at zero
findings.

The nineteenth remediation pass removed all 10 findings from the GINA
explainer. The rewrites retain the federal health-insurance and employment
protections, the 15-worker threshold, the life, disability, and long-term-care
gaps, the role of state law, and the need for professional advice. The state
example now matches Florida's current statute: it names health, life, and
long-term-care insurance rather than claiming a broad stand-alone disability
rule. The practical guidance no longer implies that an ungenerated report can
never be requested or that every clinician-ordered test includes counseling.
A page-level regression keeps the explainer at zero findings.

The twentieth remediation pass removed all 9 findings from the cancer-risk
report category. The rewrites retain allele and effect direction, effect
sizes, ancestry limits, relative-versus-absolute risk language, hereditary-
cancer and screening caveats, environmental factors, and limits on individual
prediction. The MC1R copy now matches its cited meta-analysis by retaining the
red-hair association without claiming that R151C itself predicts fair skin.
The APC homozygote copy now states that too few cases exist to estimate risk,
instead of assuming more risk than one-copy carriers. A current position
statement supports that limit. The TERT report now cites the glioma study that
supports its glioma estimate, and CHRNA3 adds direct nicotine-intake evidence.
A category-level regression keeps the file at zero findings.

The twenty-first remediation pass removed all 9 findings from the deceased-
account policy. It also brings the page into the v2 contract: the policy now
covers account holders, other adult subjects, embryo records after a genetic
parent dies, and future-person records. It states that Inherit accepts no new
upload for a deceased person. The default remains non-disclosure, documents
receive human review, and any disclosure waits through a 30-day notice period.
Recorded wishes override an estate request, and living relatives' genotypes
remain protected without their consent. Account-deletion wording now points to
the fixed seven-day notice and purge lifecycle instead of promising an
immediate account purge. A page-level regression keeps this policy at zero
findings.

The twenty-second remediation pass removed all 6 findings from the law-
enforcement policy. It also replaces a subpoena-as-sufficient rule with the v2
contract: stored content requires a warrant or equal judicial order, and
Inherit first resists demands and subpoenas for genetic data. The policy now
applies to other adult subjects and future-person records, preserves notice and
narrow-response duties, and bans voluntary forensic-genealogy upload or
matching. Its annual report now gives explicit received, resisted, complied,
and affected-account zeros by requesting jurisdiction. Future-person claim
volume is also published there, and the twice-yearly update cadence remains.
The page no longer promises an immediate purge or a voluntary emergency
exception that conflicts with its one compelled-process position. A page-level
regression keeps the policy at zero findings.

The twenty-third remediation pass removed all 4 findings from the research-
consent policy. The page still states that Inherit conducts no research with
customer or subject data, while distinguishing the public-source Research
library from a user-data research program. Any future proposal now requires a
separate opt-in for each purpose and recipient class, names every recipient and
data class, and publishes approval from an institutional review board or equal
independent body. Embryo data and data about another adult are excluded in all
cases. Withdrawal is stated as prospective, with each study required to name
and publish what cannot be recalled. Research consent cannot authorize
internal model development or model training. The page also corrects its
former claim that AI chat and legal process were the only ways data could
leave by recognizing a person's own export. A page-level regression keeps the
policy at zero findings.

The twenty-fourth remediation pass removed both remaining application-route
findings from the Copilot setup state. The API-key explanation still says what
the key permits, that consent is explicit for each use, that a question
typically costs pennies, that the dialog names the provider and exact data
classes, and that the grant is revocable. The local option still names Ollama,
LM Studio, the OpenAI-compatible setting, example base URL and model, the
same-network requirement, and the hosted-demo localhost limit. The mandated
privacy-preference and no-leaving-infrastructure statements remain. Focused
unit and browser assertions keep those clauses present and readable.

The twenty-fifth remediation pass removed the one finding from the appeals
policy and replaced its two-paragraph outline with the required public policy.
The page now covers an adult who says an uploaded genome is theirs, a genetic
relative who objects to relative-visible processing, the 60-second cross-
account restriction, and written confirmation of what was switched off. It
also retains other decision appeals, named-human review, no automated approval
or rejection, five-business-day acknowledgement, a fixed 30-day decision
deadline, and response privacy. Focused unit and browser assertions keep those
rules present. This copy remediation does not claim that the full account-free
intake, evidence-session, or review runtime required by the brief is complete.

The twenty-sixth remediation pass removed both findings from the Future Person
Charter. The six rights remain in their required order and retain every clause,
while the longer mandated rights are split under the brief's final X7.2 rule.
Right five now also carries the missing local-model-only promise for any genome
but the user's own. The page adds the intended-beneficiary enforcement rule,
names the official UK statute, and states that England-and-Wales terms do not
exclude it. It also expands the availability notice to cover Family features,
embryo storage, embryo analysis, each operating jurisdiction, and review of the
Charter's enforcement route. The release boundary still excludes every other
subject's variants and a parent's own DNA results without separate agreement.
Focused unit and browser assertions keep these terms present and readable.
This copy remediation does not claim that artifact versioning, acknowledgement,
claim review, notice, retention, or deletion workers are complete.

The twenty-seventh remediation pass removed all three findings from the GDPR
status page. It also replaces a broad legal-basis sentence with a table keyed
by all ten registered purposes. Each row names consent under Article 6(1)(a)
and explicit consent under Article 9(2)(a). The page now states the one-month
rights deadline and possible two-month extension. It keeps EU and UK service
unavailable because the controller's full contact, named DPO, two named
representatives, impact-assessment summaries, and verified transfer map do not
exist. Focused unit and browser assertions keep those facts present and
readable. This copy remediation does not mark L-27 complete or invent a person,
address, assessment, destination, or transfer method.

The twenty-eighth remediation pass removed both findings from the incident-
response page. The page now publishes the four-hour assessment start, response
stages, Article 33 authority notice, Article 34 affected-person notice, US
state-attorney-general timing, and direct notice to non-account-holder subjects
and a future-person claimant. Its dated history includes incidents with no
confirmed data loss and retains the current zero report. The first-contact
instructions disclose that no encryption key is published and prohibit private
data in the first message. Focused unit and browser assertions keep those terms
present and readable. This copy remediation does not claim that the missing
public encryption key or written operator runbook exists.

Before G1.10 can become YES, the extractor must also prove coverage for strings
assembled entirely from runtime data and for chart-axis labels registered by a
chart component. Those surfaces are not claimed by the current static corpus.

Remediation must keep every uncertainty, applicability, and provenance clause.
Punctuation-only splits are acceptable only when both resulting sentences are
grammatical. Any wording change to a scientific template must retain the same
direction, magnitude, population, evidence status, and limitation before the
gate can be promoted to required CI.

## 2026-09-03 — twenty-ninth pass: terms and remaining legal policies

The twenty-ninth remediation pass removed the final 12 long-block findings,
all on legal routes: 8 in the terms of service, 2 in the self-hosting policy,
and 2 in the state genetic privacy policy. Every rewrite splits a long sentence
or replaces one long word with a plain one. No caveat, right, obligation,
limitation, warranty exclusion, survival clause, governing-law statement,
notice period, statutory reference, or defined term was deleted; each clause of
the original survives, sometimes in a new sentence. Quoted terms of art such as
"as is", "as available", "consequential", and "State of Delaware, United
States of America" are unchanged, and no heading, section id, anchor, or link
target was touched.

Terms of service (`src/app/(marketing)/terms/page.tsx`):

- Section 3: the limited, revocable processing license is now defined in its
  own sentence. The bar on selling, licensing, sharing, or using data for
  research, advertising, or model training and the end-on-deletion clause are
  separate sentences.
- Section 4: real deletion keeps immediate row and storage-object deletion,
  no grace-period recovery, no restoration from backups, and the privacy-policy
  cross-reference. The change-of-control survival and successor clause is now
  two sentences.
- Section 7: "as is", "as available", the express-and-implied disclaimer, the
  four named implied warranties, the probabilistic and evolving-research
  caveats, the no-warranty-of-completeness statement, the partial-coverage
  caveat, and the jurisdiction carve-out all remain.
- Section 8: the damages exclusion, the "arising from your use of the service"
  scope (now stated in both sentences it governs), the US$100-or-twelve-months
  cap, and the non-limitable-liability and willful-misconduct clauses remain.
- Section 9: termination equals deletion keeps the same immediate,
  unrecoverable process and the no-residual-copies statement.
- Section 10: Delaware governing law, the conflict-of-laws exclusion, the
  Delaware state and federal forum, both parties' consent to that
  jurisdiction, and the consumer-protection carve-out remain.
- Section 11: the material-change email, the 30-day notice period, the
  never-weakened-without-affirmative-consent protection for sections 3 and 4,
  and continued-use acceptance remain.

Self-hosting policy (`src/app/(marketing)/legal/self-hosting/page.tsx`): the
operator remains responsible for security, backups, retention, legal basis,
notices, provider contracts, and incident response in that deployment. Source
availability still enables no restricted Family or Embryo capabilities and is
still no legal or medical endorsement.

State genetic privacy (`src/app/(marketing)/legal/state-genetic-privacy/page.tsx`):
the versioned jurisdiction registry, the current-source-citation and
human-review requirements, jurisdiction correction in Settings, renewed policy
acknowledgement, and the cooling-off period remain.

Clean state: `pnpm gate:readability` now exits 0 and reports 1489 blocks, 942
long, 397 short-role, 252 sentence-capped, with zero findings. The scorer
self-test, short-role vocabulary, and sentence-cap rules are also clean.
`pnpm gate:legal`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` (168 tests)
pass; `pnpm gate:names` reports only that `NAME_DENYLIST_FILE` is unset, which
is expected outside CI. This pass changed no script, test, or data file, so no
page-level regression was added for these three pages.

With the corpus clean, the gate is now a required pull-request CI step
(`Readability and vocabulary gate` in `.github/workflows/ci.yml`), as ADR 0008
provides. G1.10 remains NO in the acceptance matrix only because the extractor
does not yet cover runtime-generated copy; that extension is the next
readability task.

## 2026-09-03 — thirtieth pass: copy-registry and runtime extraction

This pass changed the extractor, not the copy. `scripts/readability-gate.ts`
now covers the two surfaces the previous section named as the reason G1.10
stayed NO. No scorer, fixture, threshold, vocabulary, or jargon entry changed.

Copy registry (`extractCopyRegistryBlocks`): every `src/copy/**/*.ts` module
(and any `.ts` module under `src/emails/`, of which there are none yet) is
parsed and each top-level constant, object, array, `as const` tuple, and
function body is walked for string literals, no-substitution template
literals, and template expressions; each `${…}` slot becomes the placeholder
word `fact`. Object keys, comparison operands, element-access keys, and type
positions are never copy. The role comes from the nearest key or export name:
`heading`, `title`, `h1` → heading; `label`, `chip` → label; `button`,
`action`, `cta` → button; `status`, `note`, `error`, `alert` → status;
anything else → block. Legal detection stays path-based, so nothing in
`src/copy` is legal. Headings in `src/copy/reports/**` carry the 25-word
sentence cap, mirroring `reports/[slug]`. Opaque tokens are dropped: URLs,
paths and anchors, identifiers and kebab or dotted keys, class lists, rsIDs,
hashes, lone ALL-CAPS symbols, strings made only of placeholders, and strings
under two words unless they play a short role. Every block points at the
literal's own line.

Runtime copy in JSX (`extractTsxBlocksFromSource`): template literals with
slots are scored with the placeholder inside copy containers, inside the four
scanned attributes, and as standalone children of elements that have no role
(for example `<span>{`${count} files ready`}</span>`); string, template, and
placeholder-filled values of the `heading`, `label`, `description`,
`summary`, `note`, `text`, `children`, `axisLabel`, `xLabel`, `yLabel`,
`xAxisLabel`, and `yAxisLabel` props are scored under the prop's role, and
object or array props are walked for values under those keys. The
`@react-email/components` `Text` paragraph is a block, so mail bodies and the
`heading` prop of the shared mail layout are now scored. `role="img"`
alternatives were already covered through `aria-label`.

Regression coverage: eight new tests in `scripts/readability-gate.test.ts`
build a throwaway repository under the system temp directory with the real
scorer pins, vocabulary, and jargon register and prove that a `heading` key
with an unregistered word fails as a short heading, that a dense block in a
`.ts` copy file fails above grade 9 at the literal's line, that template
literals in the registry, in JSX children, and in scanned attributes are
scored with the placeholder, that a URL-only string is ignored, that a
`description` prop is scored as a block, that `as const` tuples and key-based
roles resolve as documented, and that the ten-case scorer self-test is
untouched. The existing tests are unchanged and green: `pnpm test` (288
tests), `pnpm typecheck`, and `pnpm lint` pass.

Corpus: the extended extractor reports 1,621 blocks on the same tree where the
previous rules reported 1,450: 956 long, 434 short-role, 266 sentence-capped,
152 from the copy registry. The 171 additional blocks are the 152 registry
blocks (`src/copy/overview.ts` 66, `src/copy/reports/strings.ts` 59,
`src/copy/figures/reference-groups.ts` 8, `src/copy/navigation.ts` 7,
`src/copy/reports/headings.ts` 7, `src/copy/reports/evidence.ts` 5; by role
9 headings, 27 labels, 10 statuses, 106 blocks, no buttons), 16 mail blocks
that were previously invisible, and 3 runtime template blocks in pages and
components.

Findings: the extended extractor first surfaced 32 findings, none in files
this pass may edit: 20 in `src/copy/overview.ts` (five `*Note` statuses and
two Start-here labels using words missing from the register), 8 in
`src/copy/reports/strings.ts` (the `Technical note` status, the `Uploaded
with their permission` chip, the `Your two letters at this spot` label, and
the `variant_call` layer definition at grade 9.1), 2 in
`src/emails/account-deletion.tsx` (the `cancelled` heading and a body at
grade 10.5), and one heading each in `src/emails/adult-subject-invitation.tsx`
(`invited`) and `src/emails/report-ready.tsx` (`ready`). Two more on
`src/app/(marketing)/science/page.tsx:38` appeared under the previous rules
as well and came from concurrent page work.

The copy owners then remediated them in the same day without rewording any
brief-mandated string: 30 plain words (`like`, `places`, `yours`,
`laboratory`, `sent`, `enough`, `read`, `reliably`, `kept`, `reason`, `shown`,
`effects`, `many`, `small`, `directly`, `looks`, `me`, `note`, `technical`,
`permission`, `uploaded`, `letters`, `spot`, `two`, `cancelled`, `invited`,
`ready`, `may`, `number`, `will`) were registered in
`data/plain-vocabulary.json`; `classification` (aliases `classifications`,
`clinical classification`) was registered in `data/jargon.json`, which grades
the exact brief string `A result about one or a few exact spots in your DNA,
read against an outside clinical classification.` at 6.3; and the
account-deletion cancellation sentence was rewritten to grade 5.7.

One gate-side rule changed with them: the short-string vocabulary check now
reads contractions as their full words (`don’t` → `do not`, `can’t` →
`cannot`, `won’t` → `will not`, `you’re` → `you are`, `I’m`, `let’s`, `’ll`,
`’ve`, `’d`) and drops only possessive apostrophes (`adult’s` → `adults`), so
the mandated label `I don’t have one yet` passes as `i do not have one yet`
and the register never needs a non-word such as `dont`. The stripped tokens
`wont` and `doesnt` were removed from the vocabulary for the same reason. A
unit test pins the expansions and a fixture-repository test proves the label
passes.

Clean state: `pnpm gate:readability` exits 0 and reports 1621 blocks, 956
long, 434 short-role, 266 sentence-capped, 152 copy-registry, with zero
findings on the whole tree, including the copy registry, mail templates,
template literals, copy props, and axis-label props. `pnpm test` (290 tests),
`pnpm typecheck`, and `pnpm lint` pass. Two consequences of the naming rule
are worth knowing for future copy: a key ending in `Note` is a status and is
vocabulary-checked and sentence-capped, and the `PRIMARY` button labels and
`COVERAGE_PILLS` fall to the unchecked block role because neither key nor
export name says `button`, `label`, or `chip`; renaming opts them in. G1.10
is YES in the acceptance matrix as of this pass.

## 2026-09-03 — thirty-first pass: everyday words leave the jargon register; template prose checks

ADR 0012 shortens `data/jargon.json`: `cancer` (`tumor`, `tumour`), `immune`,
`embryo` (`embryos`), `celiac`, `metabolism` (`metabolic`), `trait` (`traits`),
`vitamin` (`vitamins`), `hormone` (`hormones`), the aliases `disease` and
`diseases` of `condition`, and the aliases `genome` and `genomes` of `gene`
leave the register; thirteen genuine terms join it (`prevalence`, `incidence`,
`pathogenic`, `hazard ratio`, `odds ratio`, `genome-wide association study`,
`linkage disequilibrium`, `reference panel`, `z-score`, `missense`,
`frameshift`, `heritability`, `autosomal`). The register holds 203 terms and
aliases. The reason is X7.3 and G3.5: a registered term may never appear in a
heading, and the specification mandates `Cancer`, `Immune system and
allergies`, `Embryos`, `Food, drink and metabolism`, `Everyday traits` and
`My Genome` as headings, while report titles name the conditions they report.

Because the scorer no longer replaces those words with a one-syllable
placeholder, fourteen blocks rose above the grade-9 ceiling: one legal
sentence on `/legal/self-hosting` (rewritten in place) and thirteen template
sentences, eight of them in templates already being rewritten for a naked
relative figure and five rewritten on their own. All were rewritten under the
W5 rulebook (direction kept, ratio replaced by one bounded magnitude phrase,
no new fact) and re-scored at or under 9.

`pnpm gate:templates` now applies two prose rules from
`src/lib/genome/template-prose.ts`: the first-glance title (G3.5: at most
twelve words, no registered jargon term, no bare numeric figure) and the
naked relative figure (§4 §2.4: no `%`, `x`, `×` or `-fold` token within 40
characters of a comparison word, and no numeric multiplier at all). On the
seed as it stood, 89 templates failed (37 jargon titles, 36 naked tokens,
129 worded ratios); after the register change and the rewrites, 92
templates changed (33 titles, the rest prose) and the gate exits 0.

Clean state: `pnpm gate:readability` exits 0 over 1,613 blocks (956 long,
434 short-role, 266 sentence-capped, 144 copy-registry) on the tree with the
template rewrites applied.
