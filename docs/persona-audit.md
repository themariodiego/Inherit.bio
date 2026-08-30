# Adversarial persona audit (20 simulated lay users)

An adversarial UX audit of the deployed product, run as three multi-agent
waves against the local production build (real browsers, real Supabase
stack, real email capture — the same harness the E2E suite uses). The
premise: Inherit must work for people who are *not* in the industry.

## Method

**Wave 1 — 20 personas.** Twenty distinct lay-user personas — a
computer-averse retiree, a truck driver on a phone, a non-native English
speaker, a nurse, an insurance-anxious bank employee, a privacy
maximalist, a colorblind retiree, a parent wanting to test her kids, a
tinkerer, a breast-cancer survivor, a keyboard-only user with RSI, a
low-vision user at 200% zoom, an impatient student, a Spanish speaker
with basic English, a consumer-rights journalist, a pregnant first-time
mother, a beginner with no file, a clinical-VCF holder, a man for whom
ancestry is identity-sensitive, and a blind screen-reader user — each
drove the complete flow in a real browser: landing → provider directory →
sign-up → email confirmation → upload → processing → reports → ancestry →
genome browser → copilot → settings → export → legal pages. Each returned
structured findings (step, severity, detail, a verbatim "what I'd say out
loud" quote, suggestion).

**Result: 169 findings → 85 deduplicated issues (0 blockers, 47 major).**
Every major and high-frequency issue was fixed in one coordinated round
(the fix commit lists them all).

**Wave 2 — adversarial verification.** Thirteen verifier agents were each
given one fix and instructed to *refute* it — searching the DOM for
supposedly-hidden genotypes, capturing full network traffic to catch the
genome browser phoning home, counting export CSV rows against the stored
variant count, measuring scroll overflow at three viewports, tabbing
through every page. In parallel, the eight most-affected personas re-ran
their flows on the fixed build.

**Verdicts: 11 of 13 fixes held under attack, 2 partial, 0 refuted.
Persona re-runs: 29 of 30 round-1 complaints rated fixed or improved.**
The verification round also surfaced 30 new (smaller) findings and two
significant catches of its own:

- **RSC payload leak.** The sensitive-report gate hid results visually,
  but the genotype was still serialized into the page's React flight
  payload (readable via view-source, delivered even on "Not now"). Fixed
  in round 3: reveal became a server-side decision — a gated page's
  response now contains no genotype at all.
- **`.env.production` build hazard.** A committed env file meant any
  `pnpm build` without explicit env silently baked the demo production
  Supabase URL into the bundles. A verifier caught it, and a check of the
  production database confirmed no test data ever landed there (the
  sandbox egress also blocked the misdirected calls). Fixed in round 3:
  the file is gone from the repo and the docs now state that production
  env belongs only in the hosting platform.

**Wave 3 — round-2 fixes.** The verification round's partials and the
strongest new findings were fixed: server-side reveal for gated reports
with per-account (not device-global) memory, the polygenic-score section
no longer opens the library with failure cards when nothing is
computable, provider Buy links steer to neutral product pages (one
provider's link had led to a $399 single-purpose test, another's to a
pre-filled checkout), the "Works with Inherit" column moved beside the
product name for phones, the skip link no longer pollutes history,
igv's embedded controls received accessible names, `/copilot` redirects,
the example-question chips no longer masquerade as buttons, and the
export gained a human-readable `reports.txt` a user can print for a
doctor's visit.

## What the audit says about the product

The personas' aggregate judgment was notably consistent: the honesty
infrastructure (evidence grades, citations, coverage candor, readable
legal pages, no trackers, working export and deletion) earned trust from
even the hostile personas — several called it the most trustworthy
consumer-genomics product they had seen. The failures were almost all
*translation* failures: the product knew the truth but said it in the
wrong order (confident ancestry bars above an "unreliable" footnote),
in the wrong language (Ollama base URLs for a retiree), or not at the
right moment (the own-DNA-only rule living solely in the Terms).

## Known deferred items

- **Internationalization** (Rosa): the product, including all
  consent-relevant documents, is English-only. A Spanish translation of
  the privacy policy, terms, and the "short version" summaries is the
  single highest-value i18n step.
- **Browse-page genotypes are not gated** (Grace): searching an exact
  rsID in the genome browser shows the genotype without a "Before you
  look" step. Accepted deliberately: typing a specific variant into a
  search box is an explicit, informed act — the gate protects against
  *stumbling into* results, not against looking them up.
- **Report-library gating vs. copilot**: the copilot's grounding tools
  return genotypes on request; the same explicit-act rationale applies.
- Assorted papercuts logged in the audit transcripts (processing-time
  stat phrasing, three-row mobile nav chrome, "/" search shortcut).

## Where the raw material lives

The full persona transcripts, screenshots, verifier scripts, and
structured findings are session artifacts (not committed — they contain
nothing sensitive, but they are bulky and ephemeral). The deduplicated
issue list and the fix mapping are reflected in the three audit commits
on the PR.
