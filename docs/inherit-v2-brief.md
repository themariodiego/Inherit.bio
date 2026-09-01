# Inherit v2 — Autonomous Resolution Brief

**A long-horizon, multi-agent engineering directive.**
Repository: `themariodiego/sequence` · Product: Inherit (inherit.bio) · Branch: `claude/inherit-service-redesign-nxcobe`

---

## 0. Operating contract

You are an autonomous multi-agent engineering system operating under a long-horizon protocol. Your sole mission is to
completely resolve the Goal in §1. You run a continual loop:

> **attempt → failure → diagnosis → new approach → candidate build → adversarial audit → repair**

Persist through this cycle. Abandon broken ideas. Attack your own work. Strengthen candidates until a complete
resolution exists that survives rigorous adversarial scrutiny and contains no substantive gap. Be prepared for
extended autonomous operation across many hours and many rounds; retain full context throughout. Patience and
thoroughness are mandatory. Do not stop, return, or declare partial success because an approach failed, because an
agent reports a hard gap, or because the work appears large.

Three things are true at once and none of them may be traded away:

1. **The average person must be able to use inherit.bio.** Minimalism and simplicity for the user is the highest
   product constraint. A correct feature nobody can operate is a failed feature.
2. **Every number, sentence and chart must be true and traceable.** A simplification that misleads is worse than the
   complexity it replaced.
3. **The framework must be lawful, and it must protect the operator.** A feature that cannot ship lawfully in a given
   jurisdiction does not ship there — and says so, before the user invests effort.

Where these three collide, the resolution is never to pick one and drop another. It is to redesign until all three
hold. §7 (Cross-cutting constraints) governs every collision explicitly.

---

## 1. The stated goal

Inherit is an existing, working, open-source consumer-genomics platform in this repository. It is honest,
privacy-engineered, and technically sound — and it is built for someone who already knows what a VCF is. This work
turns it into a service the general public can use, and widens it from one product (interpret my own raw file) to the
three that this category actually consists of:

- **My Genome** — what your own genome says about you.
- **Family** — what two people's genomes together say about the children they might have.
- **Embryo Analysis** — what the genetic files an IVF clinic returns say about a specific set of embryos.

Each of the three carries a Copilot scoped to exactly that subject. Nothing is added that a lay person cannot
operate, and nothing is claimed that the evidence does not support.

The work is complete when a person with no scientific training can land on inherit.bio, understand in ninety seconds
what it does and whether it is for them, get a genome (their own, or another consenting adult's, or an embryo cohort's)
into the system, and read a result they correctly understand — including correctly understanding what it does *not*
tell them. And when every claim on every surface is sourced, every consent is versioned and revocable, every
restricted feature is jurisdiction-gated before it is offered, and the whole thing is proven by tests that run in CI.

### 1.1 What already exists (ground truth — read the repository before writing any code)

Read these before writing anything. Where this brief and the repository disagree, the repository is the fact and the
brief is the intent — reconcile explicitly rather than silently.

**Stack.** Next.js 16.3.3 (App Router), React 19.2.8, TypeScript 5, Tailwind CSS v4, shadcn-style primitives under
`src/components/ui`, Supabase (Postgres + Auth + Storage, `@supabase/ssr`), Vercel AI SDK v7 for the copilot,
Vitest for unit tests, Playwright (+ `@axe-core/playwright`) for E2E, Lighthouse in `scripts/lighthouse-check.ts`,
`tus-js-client` for resumable direct-to-storage uploads, `igv` for the embedded browser, `zod` v4, `resend` +
`@react-email/components` for mail. Licensed AGPL-3.0. Package manager: pnpm, with a workspace.

**`AGENTS.md` carries a standing warning that must be obeyed:** this Next.js version has breaking changes against
model training data, and the authoritative guides live in `node_modules/next/dist/docs/` resolved from the file's own
directory. Read the relevant guide there before writing framework code. The block is rewritten by `next dev`; commit
it with your work rather than fighting it.

**Routes today.**
`(marketing)`: `/` `/about` `/providers` `/changelog` `/privacy` `/terms` `/legal/gina` `/legal/deceased`
`/legal/law-enforcement` `/legal/research-consent`.
`(app)`: `/dashboard` `/reports` `/reports/[slug]` `/ancestry` `/browse` `/chat` `/uploads` `/settings`.
`auth`: `/auth/sign-in` `/auth/sign-up` `/auth/forgot-password` `/auth/reset-password` `/auth/callback` `/auth/sign-out`.
`api`: `/api/chat` `/api/export` `/api/account/delete` `/api/browse/region` `/api/files/[id]/download`
`/api/files/[id]/process` `/api/llm/settings` `/api/jobs/{annotation-refresh,research-publish,research-refresh}`.

**Database (`supabase/migrations/`, five migrations, RLS on every user table).** `profiles`, `genome_files`,
`user_variants`, `ref_variants`, `ref_genes`, `report_templates`, `changelog_entries`, `research_releases`,
`prs_scores`, `prs_weights`, `user_prs`, `ancestry_results`, `ref_aims`, `ref_haplogroup_markers`, `providers`,
`llm_settings`, `llm_keys`, `consent_grants`, `chats`, `chat_messages`, `worker_jobs`.

**Genome library (`src/lib/genome/`).** `parsers/{sniff,array,vcf,lines}.ts` with unit tests and fixtures;
`liftover.ts` (GRCh37→GRCh38), `admixture.ts`, `haplogroups.ts`, `prs.ts`, `prs-data.ts`, `reports.ts`,
`categories.ts`, `load.ts`, `types.ts`, plus `pipeline-integration.test.ts`. Heavy compute runs on a self-hosted
worker (`worker/`, Docker) over the `worker_jobs` table — never claimed as serverless (see
`docs/adr/0001-gating-decision-large-files-and-compute.md`).

**Design tokens (`src/app/globals.css`).** `--paper #f7f8f1`, `--ink #14201b`, `--ink-muted #4c5a52`,
`--forest #2e5c45`, `--forest-deep #234837`, `--tint #e9efc4`, `--card #fdfdf9`, `--line #dde2d3`, `--danger #a03d2e`;
a complete `.dark` override; Tailwind v4 `@theme inline` mapping onto shadcn semantic names; Fraunces display serif +
Inter sans; utility classes `.display` (Fraunces, weight 400, letter-spacing −0.02em, line-height 1.05),
`.display .accent` (forest), `.eyebrow` (0.72rem, weight 600, letter-spacing 0.16em, uppercase, muted).
**This palette and this type pairing are Inherit's identity and are kept.** Everything in this brief extends them.

**Proof-not-promise machinery already in place — extend it, never weaken it.**
`e2e/rls.spec.ts` attacks the real PostgREST and Storage APIs. `e2e/network-audit.spec.ts` fails CI on any
third-party network request from a rendered page. `e2e/a11y.spec.ts` runs axe. `e2e/deletion-export.spec.ts` proves
deletion deletes and export is complete. `e2e/legal.spec.ts`, `e2e/report-gate.spec.ts`, `e2e/copilot.spec.ts`,
`e2e/upload-vcf.spec.ts`, `e2e/tier2-upload.spec.ts`, `e2e/providers.spec.ts`, `e2e/research.spec.ts`,
`e2e/auth.spec.ts`. `scripts/legal-placeholder-gate.ts` (`pnpm gate:legal`) fails the build on placeholder text in
legal pages. `scripts/validate-templates.ts`, `scripts/check-provider-links.ts`, `scripts/seed.ts`.
CI (`.github/workflows/ci.yml`) runs typecheck, lint, unit tests and the legal gate.

**Decisions on record (`docs/adr/`).** 0001 large files and compute gating · 0002 stack and boring defaults ·
0003 no imputation · 0004 LLM copilot privacy model · 0005 annotation reference store. Also `docs/architecture.md`,
`docs/self-hosting.md`, `docs/deployment.md`, `docs/acceptance-matrix.md`, `docs/dataset-licenses.md`,
`docs/persona-audit.md`, `docs/audit-report.md`, `docs/karpathy-guidelines.md`.

**Commercial and structural facts that constrain the design.** Inherit sells nothing and never takes payment for
sequencing; it is created and funded by Plus Bio as a public-good project but is a legally separate entity — separate
accounts, no SSO, and no personal, health or genetic data flowing between Inherit and any Plus Bio service in either
direction. There is no revenue model, so no surface may be designed as a funnel, an upsell, or a paywall, and no
result may be gated behind a subscription. Non-goals on record: no sequencing sales, no imputation, no microbiome
claims, no diagnosis.

### 1.2 What the user asked for, in their own terms

The Overview page carries three domains. The user sketched them as follows and explicitly delegated judgement on the
details to you — the sketch is the intent, not a wireframe to transcribe literally:

- **My Genome** — Reports · Ancestry (an interactive map with specific sub-continental regions, plus Neanderthal DNA)
  · Copilot
- **Family** — Individual heritability risks · Portrait ("preview your future child before pregnancy") · Copilot
- **Embryo Analysis** — Upload · Compare your embryos · Copilot

Inherit must accept, lawfully:

1. your own genome;
2. the genome of another adult (18+) whose permission you hold;
3. your own embryos' genetic data;
4. embryo genetic data uploaded with the consent of the genetic parents.

The service must be simpler, quieter and more spacious than it is today; the language must be plain; the information
must be accurate; the interface must feel finished; and the legal framework must be updated so that all of it is
lawful and the operator is protected.

### 0.1 Operator directives (these override any inference you draw elsewhere)

1. **No comparator is named in Inherit's own voice.** No external company, product, founder, domain or model may be
   named, quoted, identifiably paraphrased or quantified anywhere Inherit speaks for itself — UI copy, marketing
   pages, docs, ADRs, design rationale, anti-pattern registers, test names, `data-testid` values, code comments,
   commit messages or alt text. Inherit's case is made on what Inherit does, never against a named rival.
2. **One carve-out, confirmed by the operator: the provider directory.** `data/providers/providers.json`, the
   `/providers` route and its components, `e2e/providers.spec.ts` and `scripts/check-provider-links.ts` may name real
   sequencing and genotyping companies, and every existing entry stays. That directory exists to tell a person
   truthfully where they can buy sequencing; dropping a verified, purchasable provider for a non-factual reason
   would corrupt the one thing it is for. See §7 X8 and §8 G6.
3. **Inherit's visual identity is kept and extended, never replaced.** The paper ground, forest accent, tint,
   Fraunces + Inter pairing and the `.display` / `.eyebrow` / `.accent` utilities in `src/app/globals.css` are the
   brand. "Simpler" means fewer elements, more air and plainer words inside that identity — not a restyle.
4. **Nothing that already works is rewritten.** The parsers, liftover, admixture, PRS engine, report resolver,
   worker, RLS policies and the existing proof-tests are extended, not replaced. Any deletion is justified in an ADR.
5. **Inherit charges nobody, for anything, ever.** There is no payment path, no tier, no credit, no subscription and
   no result behind a paywall. No surface may be designed as a funnel or an upsell.
6. **Where a capability cannot ship lawfully and honestly, it does not ship — and Inherit says so plainly, before the
   user invests effort.** Silence is not a permitted answer, and neither is shipping it anyway with a disclaimer.


---

## 2. Product surface and information architecture

#### 0. The one structural idea: subjects

Every piece of data in Inherit v2 belongs to exactly one **subject**. Create `public.subjects` with: `id uuid`, `user_id uuid not null` (the owning account), `kind` ∈ `{'self','adult','embryo'}`, `display_name text not null`, `subject_colour smallint not null check (subject_colour between 0 and 7)`, `slug text not null` (unique per `user_id`), `adult_attested_at timestamptz`, `age_attestation_source` ∈ `{'self','counterparty_signature','uploader_attestation'}`, `portrait_acknowledged_at timestamptz`, `created_at`. RLS: owner-only, matching the existing `genome_files` policies.

**Migration and backfill, in this order.** (1) Create `subjects`. (2) For every `auth.users` row, insert one subject with `kind='self'`, `display_name = coalesce(profiles.display_name, 'You')`, `subject_colour = 0`, `slug='me'`, `adult_attested_at = now()`, `age_attestation_source='self'`. (3) Add `genome_files.subject_id uuid references public.subjects(id)`, set it to that self subject for every existing row. (4) Only then declare `genome_files.subject_id NOT NULL`. A self subject is also created by the `handle_new_user()` trigger at signup, so `/genome/me` always resolves for every account, including one with no files. There is therefore no "subject absent" fallback anywhere in v2; the draft's `if absent, redirect to /files` branch is deleted as dead code.

Every derived row (`user_variants`, `user_prs`, `ancestry_results`, resolved reports) is reachable from a subject through `genome_files.subject_id`. Every retrieval function takes `subject_id` as a **mandatory parameter**, never as a post-hoc filter.

**The three domain boxes are lenses over subjects, not silos.** My Genome is the lens on your `self` subject; Family is the lens on `self` + `adult` subjects; Embryos is the lens on `embryo` subjects. One report renderer, one ancestry renderer, one Copilot, three framings. Copilot is not three products and not a nav destination: it is one dock, always scoped, present in all three domains.

**No implicit active file.** `src/lib/genome/load.ts:19` `getActiveFile()` falls back to `files[0]`, and `/reports`, `/reports/[slug]` and `/ancestry` all consume that fallback today. v2 deletes the function. A request that does not name a subject redirects to a subject-named URL; it never guesses.

**Multi-file subjects.** A subject may hold several processed files (an array export plus a later VCF is the common upgrade path). Reports resolve against the **union of positions across that subject's processed Tier 1 files**, most-recently-processed file winning where a position is present in more than one and the genotypes agree. Where two files disagree at a position, the report renders the exact string `"Your two files disagree about this position, so Inherit shows no result here."` and no genotype. The subject bar names the file count, not a file name (§2.3).

**Deceased subjects are out of scope for v2.** `kind` has no `'deceased'` value and Inherit accepts no upload on behalf of a dead person. `/legal/deceased` must be updated in the same release to state this in one sentence, so the published policy and the product agree.

#### 1. Global structure

**1.1 Nav — exactly five items, in this order.** `Overview` (`/overview`), `My Genome` (`/genome/me`), `Family` (`/family`), `Embryos` (`/embryos`), `Settings` (`/settings`). Labels are exactly these strings. The current nav (`src/components/site/app-nav.tsx`) has **seven** items — Overview, My files, Reports, Browse genome, Ancestry, Copilot, Settings — so the reduction is seven to five and is checkable against that baseline. No sixth item may be added without removing one. Sidebar items render at `font-size ≥ 16px` with `≥ 12px` vertical gap; at viewport widths below 768px they render as a wrapping row, preserving today's `AppNav` mobile behaviour.

**1.2 Copilot dock.** One 56px-square button labelled `"Ask Copilot"`, fixed bottom-right on every `(app)` route, rendered in the Button component's `outline` variant. It opens a right-hand panel 420px wide (full-width below 768px). **The dock button is explicitly excluded from every primary-button count in this section**; "primary button" means the Button component's `default` variant (`src/components/ui/button.tsx`), so the count is mechanically checkable via `[data-variant="default"]`.

Panel header template: `Asking about: {scope}`. One worked example per scope, and these are the only four shapes: `Asking about: Maya` (subject), `Asking about: Maya — Heart and circulation` (report), `Asking about: your family view`, `Asking about: your 4 embryos` (`your 1 embryo` at n=1). Scope derives from the route and is not editable inside the panel; to change scope you navigate.

**Unconfigured state.** An account with no `llm_settings` row opens the dock to a single panel, no text input, headed `"Copilot needs a model to talk to"`, with two options, each one click to `/settings/copilot`: `"Use a model running on your own computer"` — `"Nothing leaves your machine. Inherit talks to software you run yourself."`; `"Use a cloud model — Inherit will name it and ask you first"`. The panel preserves verbatim today's plain-language key explanation and local-endpoint instructions from `src/app/(app)/chat/page.tsx` (the "An API key is like a password…" paragraph and the local-endpoint paragraph naming LM Studio). `/chat` ceases to exist as a page, but **no `chats` or `chat_messages` row is deleted or orphaned by the migration**: prior conversations render as a per-subject history list inside the dock, reached from a `"Past conversations"` link in the panel header, and remain in `/api/export`.

**Retrieval provenance.** `chat_messages` gains `retrieved_subject_ids uuid[] not null default '{}'`, written on every assistant turn with exactly the subjects whose rows the retrieval touched. Deletion of a subject's derived data (§5.4) deletes messages by that key. Text matching is never used to decide what a message contains.

**1.3 Search.** One global search, opened by the header field or `⌘K`/`Ctrl+K`. Groups, in order: `People and embryos`, `Reports`, `Ancestry regions`, `Settings`. Maximum 8 results per group, maximum 4 groups. There is no `Help` group, because v2 specifies no `/help` route. Every result row referring to subject-derived data carries that subject's chip (§2.3). Search returns destinations only — never a genotype, percentile, risk value or ancestry share.

**1.4 Breadcrumbs.** Rendered on **every subject-derived route**, not by segment count. Forms: `{Domain} / {Subject}` (two levels), `{Domain} / {Subject} / {Section}` (three), `{Domain} / {Subject} / {Section} / {Item}` (four, e.g. `My Genome / Maya / Data / Genome browser`). The subject segment is never omitted and never abbreviated to an initial.

**1.5 Density and rhythm — measurable rules, all gated by tests, not by review.** Per screen: at most **one** primary (`default`-variant) button, excluding the dock; at most **three** cards in any top-level grid row at ≥1024px; prose `<p>` at most **68ch** at 1280px; **≥96px** vertical gap between adjacent top-level `<section>` elements at ≥1024px and **≥48px** at viewport widths below 1024px; at most **12** interactive elements in the first 800px of a 1280×800 viewport, excluding nav and the dock. Two surfaces carry a raised interactive-element cap because a table legitimately requires it: `/family/health-picture` and `/embryos/compare` are capped at **24**. Every one of these is an acceptance test (§10), not a design-review note.

**1.6 Accessibility is a hard requirement, not a decoration.** The eight subject colours are tokens `--subject-0` … `--subject-7` defined in `src/app/globals.css` for both themes, each meeting **≥3:1 contrast against `--paper` and against `--card` in light and dark**. Colour is never the sole carrier of subject identity: the disc always contains the subject's initial as text and the display name is always adjacent. `title` attributes are never used to carry information; long names truncate visibly and expose the full string through an accessible mechanism reachable by keyboard. `axe-core` reports zero serious or critical violations on the five named routes in §10.

#### 2. Making subject-confusion impossible

**2.1 URL.** `/genome/[subject]/…`, `/family/[person]/…`, `/embryos/[embryoId]`. `[subject]` is `me` for the self subject and `subjects.slug` otherwise.

**2.2 Title and heading.** The `<title>` and `<h1>` of every subject-derived page begin with the display name — e.g. `Maya · Heart and circulation — Inherit`. Never `"Your reports"` on a page showing someone else's data.

**2.3 Subject bar.** Directly beneath the app header on every route rendering subject-derived data, a 44px bar renders: (a) a 24px disc in the subject's colour containing the subject's initial as text; (b) the display name; (c) a kind chip, one of exactly these five strings, each bound to a state — `"You"` (`kind='self'`), `"Shared with you"` (`kind='adult'`, files owned by that person's own account), `"Uploaded with their permission"` (`kind='adult'`, uploaded by this account under §5.2 Path B), `"Embryo"`, `"Example"` (fixture subjects on `/example/*`); (d) the file count as text — `"1 file"` / `"3 files"` — linking to `/files`; (e) for a Path B subject only, the permission date and a link to the stored evidence. Every card rendering that subject's values carries a 4px left border in the subject colour **and** the subject's name or initial as text.

Each `self` and `adult` subject bar carries a persistent secondary action `"Add a file"` → `/files/upload?subject={slug}`.

**2.4 The enforceable invariant.** Every node rendering a genetic value must carry `data-genetic-value` with one of exactly `genotype|risk|percentile|ancestry-share|carrier-status`. Emitting such a value from a component that does not set the attribute is a build failure enforced by a lint rule over `src/`. Every `[data-genetic-value]` node must have exactly one ancestor carrying either `data-subject-id` (single-subject output) or `data-subject-pair="{subjectA}:{subjectB}"` (joint output computed from two subjects, whose value must match the subjects the computation used). Within any element carrying `data-card`, all descendant `data-subject-id` values are identical **unless** that element also carries `data-compare-surface`. Joint-output cards carry exactly one `data-subject-pair` and render both subject chips in the card header.

Multi-subject rendering is legal on exactly five surfaces and nowhere else: `/family/health-picture` (§5.5), `/embryos/compare` (§6.2), `/family/portrait/[pairId]` (§5.6, pair attribution), `/example/embryos` (§7.1), and the Overview carrier-match line (§3.5, pair attribution, no value rendered).

#### 3. The Overview page (`/overview`)

Three domain cards in the sketched order, plus one action strip above them. **The page body renders no genetic values, no charts and no percentiles. The Copilot dock is exempt and carries its own subject attribution.** Overview's job is to route, not to inform.

**3.1 Number rule.** An Overview tile may show only a count of objects the reader can point at, a date, or a plain-language state word — never a percentile, z-score, haplogroup, coverage fraction, R², risk percentage, or a dash placeholder. Every number carries a unit noun and **one sentence of at most 12 words saying what the number is**. (The draft required a "comparator sentence"; that word is dropped, because the copy this section actually specifies gives definitions, and a definition is what an average reader needs here.) Mechanically: every `[data-metric-value]` on `/overview` has a sibling `[data-metric-note]` of 1–12 words. Pluralisation follows one rule, applied to every templated count string in this section: `Intl.PluralRules('en')` with an explicit singular form given per string, so `"1 single-gene finding ready"`, `"1 embryo file added"`, `"your 1 embryo"`.

**3.2 State A — nothing uploaded. This is the default and the state to design first.**

1. `<h1>`: `"Welcome to Inherit."` Sub-line: `"Inherit is free to use and sells nothing. Sequencing, if you need it, is bought from a provider directly."`
2. One panel, `"Start here"`, with exactly three linked options:
   - `"I have a DNA file"` — `"A 23andMe, AncestryDNA, MyHeritage or FamilyTreeDNA download, or a VCF from a lab."` → `/files/upload`
   - `"I don't have one yet"` — `"Find a sequencing provider. You buy from them directly; Inherit takes no cut."` → `/providers`
   - `"Show me what this looks like first"` — `"Read a complete example report. No account data needed."` → `/example/report`
3. The three domain cards in **preview state**: title, one sentence, and a link reading `"Available once a file is added"` that navigates to `/files/upload`, rendered with `aria-disabled="true"` removed (the link is real and works), text in the `--ink-muted` token at ≥4.5:1 against `--card`, and accessible name `"Add a file to unlock My Genome"` (and the Family / Embryos equivalents). Card sentences: My Genome — `"Reports about you, where your ancestors came from, and a Copilot that answers from your own data."`; Family — `"Add another adult with their permission, compare risks side by side, and see what two genomes mean for a future child."`; Embryos — `"Upload the genetic files an IVF laboratory returned to you and compare embryos honestly."`

**3.3 State B — one genome, processing.** The Start-here panel is replaced by `"Processing {file name}"` with a determinate step list (`Uploaded → Checked → Positions read → Reports prepared`) and the measured p50/p95 from `public.processing_time_stats()`, reading **the row whose `file_tier` matches the uploading file's tier**. If that row is absent or its `n < 20`, the panel renders `"This deployment has not processed enough files to estimate a time yet."` and no number. No marketing estimate is permitted.

**3.4 State C — one genome, ready.**
- **My Genome** — two count lines, never merged: `"{n} single-gene findings ready"` / `"Things a specific gene change either is or isn't."`; `"{m} whole-genome estimates ready"` / `"Statistical estimates from many small effects."` Plus `"Ancestry: {k} regions found"` / `"Places where DNA like yours is common."` or `"Ancestry: your file covers too few markers to estimate regions."` Single next action: **`"Open my reports"` → `/genome/me/reports`** (not the domain landing — see §4).
- **Family** — `"Just you so far."` Next action: `"Add another adult"`.
- **Embryos** — `"No embryo files added."` Next action: `"How to get your embryo files"` → `/embryos/request-data`.
- Below the cards, the starter reading list (§7.2).

**3.5 State D — several people.** The Family card lists up to 4 people as disc + name + kind chip, then `"+{n} more"` / `"People in your family view."` It shows exactly one derived line, only when true: `"{n} carrier matches to look at"` / `"Two people carry a change in the same gene."` The line renders **no value**, carries `data-subject-pair`, and links to `/family/health-picture#carrier-matches`. No other family-level number appears. **No person is ever ranked, scored, or ordered by risk here or anywhere in Inherit.**

**3.6 State E — embryos present.** Exactly three counts, each with its note: `"{n} embryo files added"` / `"Files an IVF laboratory sent you."`; `"{p} passed the quality check"` / `"Enough data to read reliably."`; `"{q} could not be measured"` / `"Kept and shown, with the reason."` Next action: `"Compare your embryos"`.

**3.7 Global rule.** Every state of `/overview` offers **exactly one** primary button; every card offers exactly one next action; no state offers zero actions.

#### 4. My Genome (`/genome/[subject]`)

**4.0 Depth is capped, and the account holder never has the worse journey.** `/genome/[subject]` is the three-tile router the brief sketches — `Reports`, `Ancestry`, `Ask Copilot` — reached from nav. But Overview's My Genome card links **straight to the reports list**, and the draft's intermediate `/genome/[subject]/reports` router page is deleted: the findings/estimates split is two tabs on the reports route itself, and every category is a section on that one page. From `/overview`, a signed-in account with one processed file reaches a rendered report in **2 clicks** (Overview → reports list → report is 2 activations), and no leaf surface in the route table exceeds **3 clicks from `/overview`**.

**4.1 The two-layer split.** `/genome/[subject]/reports` renders two tabs that never mix:
- **`Single-gene findings`** (default tab, `?layer=findings`). Definition sentence at the top of the list and of every card: `"A specific change in one gene. Your file either shows the change or it doesn't — and what it means depends on how many copies you have and how often it leads to the condition."` (The draft's `"You either carry it or you don't"` is deleted: it is false for zygosity, for incompletely penetrant variants the seed library already ships, and for carrier-versus-affected status.)
- **`Whole-genome estimates`** (`?layer=estimates`). Definition sentence: `"A statistical estimate built from many small effects across your whole genome. It is a chance, not a finding."`

The layers use different card shapes (findings: single-column rows with a status pill; estimates: two-column cards with a mandatory baseline strip). **No list, grid, table, search result, export or Copilot answer may present a finding and an estimate as items of one kind**, and no shared list container may hold both. Layer derives from `report_templates.pgs_id IS NULL`. A template carrying both variant logic and a `pgs_id` splits into two reports: slug `{slug}` keeps the findings layer, slug `{slug}-estimate` is the estimates layer; each renders a visible link to its sibling; the pre-migration slug 307s to `{slug}`.

**4.2 Categories.** The taxonomy names **nine** categories; **eight render today**, because `Medicines` has no published template in the repository and a category with zero published templates for that subject and layer is absent, not empty. Order, exactly: `Everyday traits`; `Food, drink and metabolism`; `Heart and circulation`; `Immune system and allergies`; `Medicines`; `Brain, memory and mood`; `Cancer`; `Having children`; `Ageing and longevity`.

The mapping is a **total function over template slugs**, committed as one file, with a per-`report_templates.category` default and a named exception list — no "parts of" language anywhere:

| Existing category slug | Default new category |
|---|---|
| `basic-traits` | Everyday traits |
| `aesthetic-cosmetic` | Everyday traits |
| `environmental-sensitivity` | Everyday traits |
| `lifestyle-wellness` | Food, drink and metabolism |
| `metabolic-obesity` | Food, drink and metabolism |
| `gastrointestinal` | Food, drink and metabolism |
| `heart-cardiovascular` | Heart and circulation |
| `autoimmune` | Immune system and allergies |
| `brain-health` | Brain, memory and mood |
| `mental-health` | Brain, memory and mood |
| `neurodegenerative` | Brain, memory and mood |
| `addiction` | Brain, memory and mood |
| `cancer-risk` | Cancer |
| `reproductive-family` | Having children |
| `longevity` | Ageing and longevity |

Exceptions, by template slug: `muscle-composition-actn3-rs1815739`, `endurance-trainability-ppargc1a-rs8192678`, `sleep-duration-abcc9-rs11046205`, `morning-chronotype-rgs16-rs516134` → Everyday traits; `allergic-sensitization-il13` → Immune system and allergies; `vitamin-d-sunlight-gc` → Food, drink and metabolism. All 151 seed templates resolve; the categorised count equals the published count.

**Gating is per template, not per merged category.** The current gated set (`SENSITIVE_CATEGORIES = {cancer-risk, neurodegenerative, mental-health}` plus the `CLINICAL_CONFIRMATION_RE` content rule in `src/app/(app)/reports/[slug]/page.tsx:20`) is preserved template-for-template across the migration. Templates from `brain-health` and `addiction` are **not** newly gated by joining `Brain, memory and mood`. Any deliberate addition must be named in the migration and asserted by test.

Category descriptions are one sentence of at most 15 words. A category section shows at most 12 cards before `"Show all {n}"`.

**4.3 How one report reads. Fixed order, fixed headings, no exceptions.**
1. **Title**, subject bar, one-sentence summary of at most 25 words.
2. **Chip row**: layer chip, evidence chip (`Established` / `Moderate evidence` / `Preliminary`), subject chip.
3. **"Your result"** — the only place a value appears. Carries `data-result-block`.
4. **"What this means"** — at most three bullets.
5. **"What this doesn't mean"** — mandatory, at least one bullet, present even when the result is null.
6. **"What you might do"** — concrete steps, or the exact string `"Nothing to do. This result does not call for any action."`
7. **Confirmation block — mandatory and non-collapsible on every report whose evidence chip is `Established`**: `"This is a reading of a file you uploaded, not a clinical test. Before acting on it, ask a doctor or genetic counsellor to confirm it in an accredited laboratory."` followed by the genetic-counsellor directory link, free and low-cost routes listed first.
8. **"How sure we are"** — mandatory, inline, never a footnote, never collapsed. Findings: evidence level, number of supporting studies, populations studied. Estimates: the range, the coverage sentence, and the ancestry-portability note.
9. **"Where this comes from"** — citations with PMID/DOI links.
10. **"Ask about this report"** — opens the dock scoped to this report.

**4.4 Estimate presentation (hard rules).** Inside `[data-result-block]`, in this order:
(a) absolute lifetime risk as a percentage **and** as a natural frequency — `"about {n} in 100 people with a result like yours"`;
(b) immediately adjacent, at equal type size and weight, the matched baseline in plain words — `"About {b} in 100 women aged 35 to 44."`;
(c) the range — `"Between {lo} and {hi} in 100. Ranges this wide are normal for estimates like this."`;
(d) the percentile, **fourth in the block**, rendered at a computed font size no greater than **0.75×** the largest absolute-risk figure on the page, and never the largest numeral on the page;
(e) coverage in plain words — `"Your file covered {x} of the {y} positions this estimate uses."`;
(f) the ancestry-portability note, **always rendered expanded** inside "How sure we are". Coverage below 80%, or a subject whose inferred reference group differs from the score's development population, adds a warning chip — it never changes disclosure state.

**Baseline requires two optional facts, and says so when it lacks them.** Add `profiles.sex_at_birth` (`'female'|'male'|null`) and `profiles.birth_year smallint null`, both optional, collected only in Settings under the heading `"Two facts that make risk numbers meaningful"` with the body `"Risk of most conditions differs by sex and age. Without these, Inherit shows the range but not a comparison. You can leave them blank or remove them at any time."` Each score's population baseline and its range come from the score's own record in `prs_scores` (extended with `baseline_source text`, `baseline_by_stratum jsonb`, `interval_low real`, `interval_high real`); a score with no baseline data renders no baseline. Where sex or birth year is unknown, (b) renders exactly: `"Baseline not shown: Inherit does not know your sex and age band. Add them in Settings, or read the range on its own."` **A relative figure may never appear without its absolute counterpart in the same block.**

**4.5 "Your file does not cover this."** Array files: `"Your file does not cover this position. Array files test a fixed set of positions, and this one isn't on it. Inherit never guesses a genotype it hasn't seen."` VCF/gVCF: the exact string shipped today at `src/app/(app)/reports/[slug]/page.tsx:180-189` — `"Your file does not cover this variant. VCF files from clinical or targeted tests usually list only the positions where you differ from the reference (or only one region), so Inherit cannot tell 'tested and normal' apart from 'not tested' here — and it never guesses genotypes it hasn't observed. If your lab can provide a gVCF or whole-genome file, more reports will resolve."` No-call: `"Your file includes this position but the test could not read it confidently."` In every case the section renders at full visual weight — not greyed, not collapsed — followed by `"This is a limit of your file, not a result about you."` A not-covered report is never hidden; its card shows the status pill `Not covered by your file`.

**4.6 Ancestry (`/genome/[subject]/ancestry`).** Four surfaces on one page.

*The map.* One vector world map, 16:9, with a segmented control: `Regions` · `Mother's line` · `Father's line`. Region fills are feathered with a blur radius of at least 24px at default zoom. Region geometry is **never sourced from an administrative-boundary dataset**; the permitted source is a generalised natural-feature basemap named in the science dimension's region set, and the test is the geometry source plus the measured blur, not a judgement about borders. **The number of regions in each tier is set by the science dimension's region set, not by this section.** A tier's control renders only when at least one region in it qualifies, and a region qualifies only when the subject's file supplies at least the minimum informative-marker count the region set specifies for it — regions failing it are absent, not greyed. With the shipped 168-marker, five-superpopulation panel (`data/ref/aims.json`, `src/lib/genome/admixture.ts`), the sub-continental tier control is absent and the page states why in one sentence. The existing `RELIABLE_FRACTION = 0.25` threshold applies to the shipped panel only and must be re-derived by the science dimension for any new region set; it is not inherited.

*Region naming.* Regions are named for places, never peoples or nations: a direction or feature plus a landmass — `"Northwest Europe"`, `"Iberian Peninsula and southwest France"`, `"Sahel and West Africa"`. Ethnonyms, nationalities and demonyms are prohibited in region labels, tooltips and exports, enforced against a committed denylist fixture.

*Click behaviour.* Clicking a region opens a right-hand panel (never a modal, never a navigation) containing: region name; your share as a percentage **and** a plain-language band; the range; the number of usable markers your file supplied; the reference populations and their sample sizes; and `"An estimate of where DNA like yours is common today. It is not a statement about your identity, nationality, or family history."` Escape or a background click closes it and returns focus to the region.

*Bands are half-open intervals on the continuous share, computed before display rounding:* `"a large part"` ≥30.0%; `"a noticeable part"` ≥10.0% and <30.0%; `"a small part"` ≥2.0% and <10.0%; `"possible but not established"` <2.0%. Display rounding is to one decimal place and never changes which band applies.

*Honest uncertainty.* Fill opacity is proportional to the **lower bound** of the range, with a **minimum opacity floor of 0.15** so any counted region is visible. A region whose range includes zero is drawn with a dashed hairline and no fill. A toggle, **on by default**, reads `"Show only what's well supported"` and hides regions whose lower bound is below 2.0%. Because hiding must never break the arithmetic, **two chips always render below the map in both toggle states**: `"Not assignable to any region: {u}%"` and `"Hidden as not well supported: {h}%"`. Shown shares + `u` + `h` = 100.0% ± 0.1 in both states, and both chips render even at 0%. (This resolves the conflict between a default-on filter and a sum-to-100 rule in favour of keeping the filter on: the average reader is better served by a quiet map plus one honest chip than by a map full of noise.) Below the reliability threshold the map renders grey with no percentages and the copy `"Your file covers only {k} of {N} ancestry markers — too few to draw a map. This is a limit of the file, not a result about you."`, raw numbers one activation away.

*Non-visual equivalent.* The same route carries an equivalent data table, reachable in one activation, listing every region's name, share, range and marker count. Every region is reachable by Tab in label order and activatable by Enter.

*Deep ancestry.* Mother's line (mtDNA) and father's line (Y) each render one migration path with dated nodes over the same map, plus the haplogroup label and marker-support count. Mandatory: `"This is one thread of your ancestry, not a summary of it. It follows only your mother's mother's mother's line."` and the paternal equivalent. With no Y data: `"Your file has no Y-chromosome data, so no father's line can be read from it. This says nothing about who your father was."`

*Neanderthal ancestry.* A separate card, never on the map, titled `"Neanderthal ancestry"` with `<h2>` `"How much of your DNA came from Neanderthals"`. The word `"archaic-hominin"` appears on no user-visible surface. It shows the Neanderthal-derived share as a percentage with its range and the number of matching positions, plus this comparator, whose source must appear in "Where this comes from" with a named review date: `"In people with ancestry outside Africa this is usually a little under 2%. People with only sub-Saharan African ancestry usually show a smaller share, but not zero."` Mandatory: `"A 0% result from an array file usually means your file cannot measure this, not that you have none."` **Denisovan ancestry is out of scope for v2**, stated once as `"Inherit does not estimate Denisovan ancestry yet, so this number is about Neanderthals only."` **Prohibited:** presenting the share as a personality, ability, appearance or ranking trait, or as a percentile against other users.

**4.7 Copilot scoped to this person.** Header `Asking about: {display name}`. Retrieval scope is exactly that subject's resolved reports, variants and ancestry results. Isolation is asserted at two levels, because they are different mechanisms: **cross-account** isolation by the existing RLS suite (`e2e/rls.spec.ts`) — every user-data policy keys on `auth.uid() = user_id`; **cross-subject within one account** by an application-level test that calls each retrieval function with subject A and asserts no row belonging to subject B is returned. RLS cannot make the second distinction and must not be claimed to.

#### 5. Family (`/family`)

**5.1 The list.** People as cards: disc, name, kind chip, one state line — `"Reports ready"`, `"No file yet"`, or `"Sharing paused"`. One primary action: `"Add another adult"`. The paused state is real and reversible (§5.4).

**5.2 Adding an adult (`/family/invite`).** Two paths, never at equal prominence.
- **Path A (default, primary): "Invite them."** You enter an email and an optional note. They receive an invitation, create their **own** account, upload their **own** file, and grant permission from their side. You never touch their file. This is the only path shown on first load.
- **Path B (secondary, behind a link reading `"They can't use Inherit themselves"`): "Upload with their written permission."** Requires, on one screen: their full name; **a contact email address, mandatory on both evidence branches**; a date of birth confirming 18 or over; four checkboxes (they know, they agreed, you will show them what you see, they may withdraw at any time); and **either** an e-signature captured through a link emailed to that address **or** an uploaded signed permission document. The upload control does not enable until all are complete.

**Both paths render this pre-consent statement above the form, non-collapsible:** `"Comparing two people's DNA can show that they are related, or not related, in ways neither expected. Inherit cannot un-see this."`

**Consent storage.** `public.consent_grants` is the **LLM-provider** consent table — `(id, user_id, provider_key, data_classes[], granted_at, revoked_at)` with a unique index on `(user_id, provider_key) where revoked_at is null` (`supabase/migrations/20260828000001_core.sql:360`). It has no subject, counterparty, signature or document reference, and permits one active row per provider per user. **It must not be reused for human consent.** Create `public.subject_consents`: `subject_id`, `granting_person_name`, `granting_person_email`, `date_of_birth_confirmed_18 boolean`, `checkbox_flags jsonb`, `evidence_kind` ∈ `{'esignature','uploaded_document'}`, `evidence_storage_path`, `withdrawal_token`, `granted_at`, `revoked_at`, with owner-only RLS. The exact column shape is owned by the data-model dimension; these fields are required.

**Notification and a withdrawal right that actually works.** At upload time Inherit emails the named person: a plain-language notice that their genome was uploaded and by whom; a read-only view of exactly what the uploader can see; and a signed, no-account-required withdrawal link at `/withdraw/[token]`. Following that link performs the **full §5.4 deletion with no involvement from the uploader**.

**5.3 What you see about them vs what they see about you.** The grant screen renders two independent columns, `"What you will see about {name}"` and `"What {name} will see about you"`, each with the same five toggles, each defaulting to **off**: `Single-gene findings`, `Whole-genome estimates`, `Ancestry`, `Raw genetic data`, `Portrait`. No reciprocal auto-grant, no master switch. **The `"What you will see about {name}"` column may only be set from `{name}`'s own authenticated session.** A grant recorded from any other session is invalid; in the uploader's session those toggles render disabled with `"Only {name} can turn this on."` Every toggle carries a one-sentence consequence. An asymmetric grant renders an explicit line: `"{name} can see your findings. You cannot see theirs."`

**5.4 Pausing and stopping.** `/family/[person]/permissions` carries two actions. `"Pause sharing"` sets every grant inactive, hides all derived surfaces, deletes nothing, is reversible from either side, and produces the `"Sharing paused"` state line — no tombstone. `"Stop sharing"` is the single destructive action, behind one confirmation dialog listing by name what will be deleted. On confirm, within 60 seconds: every permission is revoked; **every derived result is deleted, not hidden** — Portrait outputs, side-by-side rows, cached comparisons, and every `chat_messages` row whose `retrieved_subject_ids` contains that subject. Where a counterparty account exists, both sides are emailed and both see the tombstone: `"Sharing ended on {date}. {n} results built from this pairing were deleted."` with an itemised list. **Where the person has no account (Path B), the tombstone renders only in the uploading account**, and the notification goes to `subject_consents.granting_person_email`. Nothing derived survives on either branch.

**5.5 Family health picture (`/family/health-picture`).** Rows are conditions; columns are people. Every cell carries its layer chip; every column header carries the full subject chip; **every column footer names that person's baseline in words** — `"Compared against: women, 35 to 44"` — or, where sex or birth year is unknown, `"No baseline: Inherit does not know this person's sex and age band."` Cells show absolute risk plus natural frequency. **The difference between two people's cells is never computed or displayed.** No family score, no ranking, no "highest risk" badge, no sort-by-person control. Banner above the table: `"These are different people compared against different baselines. A bigger number in one column does not mean that person is worse off."`

**Carrier matches** get their own panel above the table, at `#carrier-matches`. The panel triggers **only** when all of these hold: both subjects are **heterozygous** for a variant classified **pathogenic or likely pathogenic** in the same gene, and that gene's recorded inheritance mode is **autosomal recessive**. It then names both variants and both classifications, not just the gene, and states: `"For each pregnancy, about 25 in 100 — a 1 in 4 chance — that a child inherits both copies. Each pregnancy is independent; this is not 1 in 4 of your children."` Where the gene's inheritance mode is **X-linked**, the panel renders the X-linked arithmetic across 100 pregnancies instead, and never a 1-in-4 figure. Where any trigger condition fails — dominant inheritance, a benign variant or a variant of uncertain significance, unknown zygosity, or an unrecorded inheritance mode — **no probability is shown** and the panel renders `"Both of you have a change in {gene}, but Inherit cannot turn that into a chance for a pregnancy. Reason: {reason}."` followed by the counsellor directory link, free and low-cost routes first.

**No relationship inference, anywhere.** Inherit computes and displays no relatedness coefficient, no shared-DNA quantity and no relationship label derived from comparing two subjects, and no surface names or implies a biological relationship other than the one the user declared.

**5.6 Portrait (`/family/portrait/[pairId]`).** The highest-risk surface in the product.

*Preconditions, all required:* two `adult`-or-`self` subjects, **each with their own Inherit account**; both with `adults_attested_at` set; `portrait` granted in both columns, each set from its own owner's session; and `portrait_acknowledged_at` set independently on each subject. **Portrait is unavailable for any pair in which either subject has no account** — the uploader's two ticks can never satisfy "both directions". Any unmet precondition renders a blocking screen naming which person has not completed which step; never a partial render.

*Exhaustive allowlist of what Portrait may show.* (1) Recessive carrier overlap and the exact per-pregnancy probability, under the same trigger conditions as §5.5. (2) X-linked arithmetic, expressed as a distribution across 100 pregnancies that includes both sexes — `"Out of 100 possible pregnancies, about {a} would be boys with the condition and about {b} girls who carry it."` — which states no prediction about any child's sex. (3) ABO and Rh compatibility, with the clinical relevance stated verbatim: `"If the pregnant parent is RhD negative and the other is RhD positive, a pregnancy may need an injection called anti-D. This is routine care, not a risk to the pregnancy."` RhD depends largely on a deletion of the *RHD* gene that array files and SNV-only VCFs do not reliably capture, so the card must state the method and coverage, and where the file cannot determine it must render `"Your file cannot tell whether you are RhD positive or negative. A blood test at any clinic can."` (4) Exactly three low-stakes traits as category probabilities: **eye colour, ability to taste bitter compounds, earwax type**. Hair colour is **excluded** — offspring prediction for it is materially weaker than for eye colour and would need a caveat the reader cannot check. Each trait card renders a stated accuracy figure with its source. Nothing may be added to this list without changing this specification.

*Exhaustive prohibition list.* Predicted intelligence, IQ, cognitive ability, educational attainment or any proxy; predicted adult height, weight or BMI, as a value or a "gain"; predicted personality, temperament, talent, athleticism, attractiveness or skin tone; predicted sex; polygenic disease risk for a hypothetical child (as distinct from carrier arithmetic); any ranking, score or "best combination"; any image, avatar or illustration of a hypothetical child's face; any singular statement about a child.

*The refusals are a designed screen.* `/family/portrait/[pairId]#not-shown` renders every prohibited item as a card in the same visual language as the shown items, under `"What Portrait will not tell you, and why"`, each with a one-sentence reason. Example: for height — `"A height estimate for a child who doesn't exist carries the parents' population differences with no way to check them, so the number would look precise and mean little."`; for intelligence — `"No model can estimate a future child's cognitive ability in a way that holds up between brothers and sisters. Inherit will not print a number that cannot be checked."`

*Rendering a distribution.* The unit is **100 outcome dots representing 100 possible pregnancies**, with a stacked bar beneath and a percentage per category. Mandatory sentence pattern: `"Out of 100 possible children, about {n} would {outcome}."` **Below 1 in 100** the grid renders one outlined dot, not zero, and the sentence becomes `"Fewer than 1 in 100 — but not zero. Inherit's estimate is about {exact} in 1,000."` Every Portrait output card carries a mandatory, non-collapsible **"How sure we are"** block naming: the inheritance model used, the assumption it rests on, whether both files covered the positions involved, and what would change the answer.

*Prohibited phrasing, repository-wide:* `"your child will"`, `"your baby will"`, `"your future child is"`, and any singular-child predictive phrasing, enforced by a grep-based CI check over `src/` and all seeded copy.

*Mandatory persistent banner on every Portrait screen:* `"Portrait describes chances across many possible children. It cannot tell you anything about any actual child. It is not a pregnancy test and not a medical assessment."` Beneath it: `"Both of you can see this page, and either of you can delete it."`

**5.7 Copilot scoped to the family view.** Header `Asking about: your family view`. Scope covers only surfaces both parties have granted. Refusals are enforced by a **server-side intent gate in the chat route that short-circuits before any model call** (§6.4), because Copilot runs on a bring-your-own-key, operator-uncontrolled model and no prompt can guarantee an exact output string.

**5.8 `/family/[person]`** — the per-person view the brief's "individual heritability risks" asks for. Fixed order: subject bar; two report-layer entry tabs using the §4.3 renderer scoped to that subject; the §5.5 baseline sentence rendered once per page rather than per column; ancestry, only if granted; a link to `/family/[person]/permissions`. Empty state: `"{name} hasn't added a file yet. There is nothing to show."`

#### 6. Embryos (`/embryos`)

**6.0 `/embryos`** is a three-tile router mirroring §4: `Upload`, `Compare your embryos`, `Ask Copilot`, with the standing statement (§6.2) below. Empty state, one primary action: `"No embryo files added yet."` / `"How to get your embryo files"` → `/embryos/request-data`.

**6.1 Upload (`/embryos/upload`).** Three questions precede the file picker.
1. `"Did your clinic do genetic testing on your embryos?"` — Yes / No / I'm not sure. `No` ends the flow: `"Inherit needs data from a genetic test the laboratory already ran. Without it there is nothing to read."`
2. `"Who did the testing?"` — free text, stored only as a label.
3. `"What did they send you?"` — **four illustrated options**, plus a fifth rendered as a secondary text link beneath them: `"A spreadsheet or text file per embryo"` → per-embryo genotype call file; `"One file with a column per embryo"` → multi-sample VCF; `"A PDF report only"` → stored, not analysable; `"A zip folder"` → archive, unpacked and each member classified. Secondary link: `"I don't know — let me upload it and you tell me"` → runs the existing sniffer and reports what it found in plain words.

Accepted and analysable: `.vcf`, `.vcf.gz`, multi-sample VCF with one sample column per embryo, genotype call files (`.txt`/`.csv` with an identifier column and a call column), and zip archives of any of these. Accepted but not analysable: a PDF laboratory report — stored, hashed, listed, and labelled `"Stored for your records. Inherit cannot analyse a PDF report."` This requires a new value `'pdf_report'` on `public.genome_file_type`, and the record takes `status = 'stored'` (an existing `genome_file_status` value) with `tier = 2`.

`/embryos/request-data` provides a copy-to-clipboard email, verbatim: `"Please could you send me the genetic data files from the preimplantation genetic testing (PGT) on my embryos — the genotype or sequence files behind the report, not the report itself. Labs usually call these VCF files, genotype call files, or 'the raw data'. I would like one file per embryo, or one file with a column per embryo."`

**Consent to upload — the same evidentiary standard as §5.2 Path B, not a self-declaration.** Before the upload control enables, Inherit requires: both genetic parents named; a contact email for the second genetic parent; the uploader's attestation of their own right to the files; and **either** the second parent's e-signature captured through an emailed link **or** an uploaded signed permission document. Stored in `subject_consents`. At upload, the second parent is emailed a notice, a read-only view of what the uploader can see, and a `/withdraw/[token]` link whose use deletes every embryo-derived row for that cohort within 60 seconds. An upload attempted with only one parent's attestation is rejected and the control never enables.

**6.2 Compare (`/embryos/compare`). A column is one embryo. A row is one measured thing.**

- Default order is by embryo identifier, ascending. **No overall rank, no composite score, no "best" badge, no default sort by a result row, and no integer anywhere that counts rows an embryo leads on.**
- Sorting by a row is permitted. While a sort is active, a persistent banner reads `"Sorted by {row}. Sorting changes which embryo appears first. It does not make that embryo better."` "Rank" exists only as a per-row ordinal while that sort is active, and is never rendered in the default view.
- **Every cell renders four things:** the layer chip; the value with its range; a comparison line naming its denominator in the cell — `"{d} percentage points {above/below} the average of the embryos you uploaded"`; and **the score's within-family (brother-and-sister) accuracy as a plain sentence with its range**, or, where none is published, exactly `"No one has measured whether this estimate holds up between brothers and sisters. It is a population estimate used where it has not been tested."` A row whose score has no published within-family estimate is **not enabled by default**. This is the single most load-bearing rule on this surface: embryos in one cohort are siblings, and a population-derived estimate applied between siblings is the category's central failure.
- **Ties are defined on the difference, not on overlapping ranges.** Two values are tied when the range of their *difference* includes zero, computed from the score's published within-family standard error; tied cells render the `≈` glyph and `"Too close to tell apart"`, and **no ordinal is displayed**.
- **Trade-offs panel**, above the table, non-dismissible, a pure existence claim: it renders `"No embryo is first on every row."` when true, plus an explicit pairwise conflict list (`"Embryo B has the lowest estimate for {X} and the highest for {Y}."`). It displays no per-embryo count.
- **Quality-control failures keep their full column.** Every result cell reads `"Not measurable"`, the header carries the chip `"Quality check not passed"`, and the column footer states the reason with measured numbers (positions read, call rate, markers matched against the parents). Silently dropping a failed embryo is prohibited.
- **Context strip**, three counts only: embryos analysed, embryos that passed the quality check, embryos not measurable.
- **Standing statement**, above the table on every load, non-collapsible: `"No published study has followed children born after embryos were compared this way. Every estimate here is a model's output, not an observed outcome."` A dated source and a named review date appear in "Where this comes from".
- **Prohibited rows:** intelligence, cognitive ability, educational attainment, height, weight, BMI, personality, appearance, athleticism, and any composite.
- **Sex is not shown by default.** Disclosure sits behind a separate, explicitly-consented toggle, gated on `profiles.jurisdiction`, a self-declared field set at the point of the toggle with the copy `"Where are you? Some places make non-medical sex disclosure unlawful, and Inherit follows local rules."` The permitted-jurisdiction list lives in one versioned file owned by the legal dimension. **The gate fails closed:** where jurisdiction is unknown, unset, or on the prohibited list, the toggle is unavailable and renders `"Inherit only shows this where local rules allow it. Tell us where you are in Settings."` Unavailability is always explained, never hidden.

**6.3 Per-embryo page (`/embryos/[embryoId]`).** The §4.3 renderer, subject-scoped to that embryo, with the standing statement pinned — **governed by the same allowlist as §6.2**, so nothing is barred in the table and shown one click away. Permitted embryo categories are exactly: `Heart and circulation`, `Food, drink and metabolism`, `Immune system and allergies`, `Cancer`, and `Having children` (carrier status only). `Everyday traits`, `Brain, memory and mood`, `Ageing and longevity` and `Medicines` do not render for embryo subjects, and §6.2's prohibited-row list applies to every embryo surface.

**Embryo copy variant.** The renderer's fixed strings are written for a living adult and must be replaced under `/embryos`: heading `"What you might do"` becomes `"What this does and does not tell you"`; the no-action string becomes `"There is nothing here that sets this embryo apart from the others."`; `"This is a limit of your file, not a result about you."` becomes `"This is a limit of the file the laboratory sent, not a result about this embryo."`; second-person references to "you" and "your file" become references to the embryo's file. **§4.4's sex-and-age-band baseline is not rendered for an embryo** — it is meaningless for one. In its place, (b) renders the population lifetime risk with its source named — `"About {b} in 100 people in the general population. Source: {source}."` — and, where no such figure exists, `"Inherit has no population figure to compare this against."`

**6.4 Copilot scoped to the cohort, and the deterministic guard.** Header `Asking about: your {n} embryos`. A server-side intent gate in the chat route classifies the request **before any model call**. Gated intents: (i) which embryo to transfer, select, keep or discard; (ii) any ranking or ordering of embryos; (iii) any prohibited Portrait output (§5.6). For a gated request the model is **never invoked** and the route returns the fixed string verbatim: `"Inherit does not recommend which embryo to choose. That decision belongs to you and your clinical team. I can explain what any number on this page means."` The acceptance test asserts the guard — the fixed string and a zero model-call count — not a model's behaviour.

#### 7. Progressive disclosure, and the two rights that must stay one click deep

**7.1 The first 90 seconds.** From `/`, an unauthenticated visitor reaches a rendered, complete example report in **at most 2 clicks** via `/example/report` — no sign-up, no file. `/example` is an index page listing the three example surfaces with one sentence each. `/example/report`, `/example/ancestry` and `/example/embryos` each render from a committed fixture in `e2e/fixtures`, carry a persistent `"Example data"` ribbon and a subject chip reading `"Example"`, and query no user data. On an empty signed-in account, `/overview` renders **at most 7 interactive elements in the first 800px of a 1280×800 viewport, excluding nav and the Copilot dock** — the same measurement basis and the same exclusions as §1.5. (State A renders six links plus the search field; the cap is set so the specified copy can satisfy it.)

**7.2 The first session.** Overview renders a starter list of **up to 5** reports, chosen deterministically: layer = single-gene finding, evidence = `established`, category ∉ {`Brain, memory and mood`, `Cancer`} (labels character-for-character as in §4.2), covered by the subject's files, ordered by category rank then slug. At 5: `"Five reports to read first. They're the clearest ones your file supports."` At 1–4: `"{n} reports to read first. They're the clearest ones your file supports."` At 0: `"Your file doesn't cover any of the starter reports. Browse the full library."` After all are opened: `"You've read the starter set. Browse the full library."` The count is never padded with uncovered or non-established reports.

**7.3 The expert path.** `/genome/[subject]/data` holds the genome browser (today's `/browse`, at `/genome/[subject]/data/browser`), per-variant tables, per-score panel coverage, raw ancestry marker counts and method notes. It is never in the top nav, and is reached from exactly three places: a `"Data and methods"` link in every report footer, a link on the ancestry page, and Settings. `expert_mode` (Settings → `"Show methods and raw numbers by default"`) expands every collapsed methods block application-wide.

**7.4 Export and deletion stay shallow.** `/settings/data` renders, at the top and non-collapsed, `"Download everything"` (`/api/export`) and `"Delete my account and all data"`, reachable in **one click** from the Settings nav item and at most **2 clicks from any `(app)` route**. This preserves the current one-click position of export at `src/app/(app)/settings/page.tsx:81` rather than burying it in the expert path. Export files are **subject-partitioned and labelled by subject**, include every subject the account owns, and a Path B subject can obtain their own partition through their `/withdraw/[token]` link.

**7.5 Collapsed by default, everywhere.** Exactly these, each reachable in one activation: per-score panel coverage lists; raw ancestry marker counts below the reliability threshold; citation lists beyond the first three; strand-flip and no-call technical notes; region reference-population tables; embryo QC metric detail. **Never collapsible:** "How sure we are", the matched baseline, the not-covered explanation, the `Established` confirmation block, the Portrait banner and its "How sure we are" blocks, the embryo standing statement, the trade-offs panel, and the §5.2 pre-consent statement.

**7.6 Plain language, and how the caveats are kept from swallowing the page.** Reading grade ≤ 9 applies to **every user-visible string on `(app)` routes**, measured by Flesch–Kincaid grade level via the `text-readability` package, run by `pnpm gate:reading` over a committed copy manifest, alongside the existing `pnpm gate:legal`. The draft's proposal of glossing nine terms of art, expanded by default on every page, would make the average reader's page worse, not better — so the simpler option is taken: **the terms are removed from user copy instead of glossed.** `"uncertainty interval"` → `"range"`; `"coverage fraction"` → the plain coverage sentence in §4.4(e); `"stratum"` → the baseline named in words; `"informative marker"` → `"usable markers"`; `"archaic-hominin"` → `"Neanderthal"`; `"ancestry portability"` → the portability note written as a sentence. Exactly **three** terms survive because no plain substitute exists, and each renders a one-sentence definition of ≤20 words, expanded, on its first occurrence per page: `baseline`, `percentile`, `haplogroup`.

#### 8. Route map, redirects and click depth

Current nav items removed as destinations: `My files` (into `/files`, reached from Settings, the subject bar and each subject), `Reports` and `Ancestry` (into `/genome/[subject]`), `Browse genome` (into the expert path), `Copilot` (into the dock). The `/dashboard` **route** is renamed to `/overview`; **the nav label is unchanged** — it already reads "Overview" today.

| Old route | New route | Status |
|---|---|---|
| `/dashboard` | `/overview` | 308 |
| `/reports` | `/genome/me/reports` | 307 |
| `/reports?file={id}` | `/genome/{slug of that file's subject}/reports` | 307 |
| `/reports/[slug]` | `/genome/me/reports/[slug]` | 307 |
| `/ancestry` | `/genome/me/ancestry` | 307 |
| `/browse` | `/genome/me/data/browser` | 308 |
| `/chat` | `/overview?copilot=open&scope=me` | 307 |
| `/uploads` | `/files` | 308 |
| `/settings` | `/settings` | — |
| all `(marketing)` routes | unchanged | — |

New routes, with maximum click depth from `/overview` in brackets: `/overview` [0]; `/genome/[subject]` [1], `/genome/[subject]/reports` [1], `/genome/[subject]/reports/[slug]` [2], `/genome/[subject]/ancestry` [2], `/genome/[subject]/data` [3], `/genome/[subject]/data/browser` [3]; `/family` [1], `/family/invite` [2], `/family/[person]` [2], `/family/[person]/permissions` [3], `/family/health-picture` [2], `/family/portrait/[pairId]` [3]; `/embryos` [1], `/embryos/upload` [2], `/embryos/request-data` [2], `/embryos/compare` [2], `/embryos/[embryoId]` [3]; `/files` [2], `/files/upload` [2]; `/settings/data` [2], `/settings/copilot` [2]; `/withdraw/[token]` (unauthenticated, emailed); `/example`, `/example/report`, `/example/ancestry`, `/example/embryos` (unauthenticated).

`/files` renders the migrated uploads surface: a list of every file with original name, subject chip, tier, status, SHA-256 (truncated, full value copyable), created date, a delete action, and a link to `/settings/data`. Empty state: `"No files yet."` with one primary action `"Add a file"`. `/files/upload` is today's upload flow with a mandatory subject selector defaulting to the self subject.

Every old route returns a redirect, never a 404 and never a 200.

#### 9. Anti-pattern register (numbered locally to this section)

These describe failure modes of products in this category generically. No external product, company, person, domain or model is named, quoted, paraphrased identifiably, or quantified anywhere in the Inherit repository, UI, docs, code comments, commit messages, tests or fixtures.

- **AP-1 — orphan dash.** A result surface showing a placeholder dash where it has nothing to count. *Repository fact:* three of today's four `/dashboard` tiles fall back to `—` on an empty account ("Reports covered", "Polygenic scores", "mtDNA haplogroup"); the fourth renders `String(files.length)`, i.e. `0`. `mtDNA haplogroup` is also used as a headline metric. Both are removed. A tile with nothing to count renders its empty copy.
- **AP-2 — a number with no range.** Products in this category ship risk figures with no stated uncertainty. Inherit fails its build if a rendered estimate carries no range.
- **AP-3 — the merged count.** Products in this category advertise one headline count spanning a single-gene panel and a much smaller set of statistical estimates. Inherit never renders one count spanning both layers; counts are always layer-labelled on two separate lines.
- **AP-4 — the unlabelled contrast.** A displayed difference whose denominator is not named where the number appears. Every contrast in Inherit names its denominator in the cell that shows it.
- **AP-5 — the silent transform.** A displayed figure that is not the figure the model produced. Inherit displays the model's own value; any transform is labelled in words in the same block as the number.
- **AP-6 — the unresolved token.** Placeholder tokens shipped in production copy. Inherit's check runs against the raw server response, not a hydrated DOM.
- **AP-7 — the singular child.** Presenting a hypothetical child as an individual with predicted traits. Inherit renders a hypothetical child only as a distribution across 100 possible pregnancies.
- **AP-8 — the population score used between siblings.** Applying a population-derived estimate to compare siblings without stating whether it has been validated between them. Every embryo cell states its within-family accuracy or the untested string.
- **AP-9 — the hidden subject.** *Repository fact, not an external one:* Inherit today resolves an implicit active file via `getActiveFile()` (`src/lib/genome/load.ts:19`) and `/reports`, `/reports/[slug]` and `/ancestry` all consume it. v2 removes it. No result may render without per-element subject attribution.

**Editorial rule on naming.** No brand-like proper noun may appear in user-facing copy outside a single committed allowlist file of permitted third parties: 23andMe, AncestryDNA, MyHeritage, FamilyTreeDNA, PGS Catalog, ClinVar, gnomAD, Supabase, Vercel, Next.js. CI fails on any capitalised proper noun in the copy manifest that is not on that list and not a place, gene, condition or cited author name. **No denylist of forbidden company names is ever committed to the repository** — that would place the very strings in the tree that the rule exists to keep out. Enforcement of the naming prohibition beyond the allowlist check is an editorial rule applied in human review.

#### 10. Acceptance tests

1. An unauthenticated visitor reaches a fully rendered example report in ≤2 clicks from `/`, with no sign-up and no file.
2. From `/overview`, a signed-in account with one processed file reaches a rendered report page in ≤3 clicks; a Playwright test asserts the shortest path for both `findings` and `estimates`. No leaf route in §8 exceeds its stated depth.
3. On `/overview` with zero files, no element carrying `data-metric-value` has text content equal to `—`, `–`, `-`, `N/A` or the empty string; the page renders exactly one `[data-variant="default"]` button, excluding the dock.
4. Every `[data-genetic-value]` node has exactly one ancestor carrying `data-subject-id` or `data-subject-pair`. Within any `[data-card]`, all descendant `data-subject-id` values are identical unless that element also carries `data-compare-surface`. A lint rule fails the build if a component renders a genetic value without emitting `data-genetic-value`.
5. Multi-subject rendering occurs only on `/family/health-picture`, `/embryos/compare`, `/family/portrait/[pairId]`, `/example/embryos` and the `/overview` carrier-match line; every joint output carries exactly one `data-subject-pair` and both subject chips.
6. Nav contains exactly 5 links with exactly the labels `Overview`, `My Genome`, `Family`, `Embryos`, `Settings`.
7. No list, grid, table or export presents a finding and an estimate as items of one kind; no shared list container holds both.
8. At 1280×800 with the page scrolled to the top of `[data-result-block]`, the absolute risk, the natural frequency, the range, and either the named baseline or the exact baseline-absence string are all within the first 600px of that block.
9. The computed font size of any `[data-percentile]` node is ≤0.75× that of the largest `[data-absolute-risk]` node on the page, and no `[data-percentile]` node is the largest-rendered numeral on the page.
10. Every report page with evidence `established` renders the confirmation block, non-collapsed.
11. Every report page renders a non-collapsed "How sure we are" and "What this doesn't mean", including when the result is not covered.
12. Every published template resolves to exactly one of the nine categories; a unit test fails on any unmapped slug, and the categorised count equals the published count (151 on the seed data). `Medicines` is absent while it has zero published templates.
13. The gated template set is byte-identical before and after the taxonomy migration, except for additions named in the migration.
14. A grep over `src/` and all seeded copy finds zero occurrences of `"your child will"`, `"your baby will"` or `"your future child is"`.
15. `/family/portrait/[pairId]` renders no value for intelligence, height, BMI, personality, appearance or sex; `#not-shown` renders a card with a non-empty reason for each prohibited item; every Portrait output card renders a non-collapsed "How sure we are".
16. Portrait is unreachable unless both subjects have their own account and both have `portrait_acknowledged_at` set; an E2E test with one completion, and one with a Path B pair, each receive a blocking screen naming the unmet precondition — never a partial render.
17. A carrier-match probability renders only when both subjects are heterozygous for a pathogenic or likely-pathogenic variant in the same autosomal-recessive gene; a fixture with a dominant gene, a VUS, or unknown zygosity renders the no-probability string with a named reason and no 25% figure.
18. An E2E test follows the emailed `/withdraw/[token]` link with no session and asserts full deletion within 60 seconds and a tombstone in the uploading account.
19. After revocation, `GET` on `/family/[person]`, `/family/health-picture`, `/family/portrait/[pairId]`, `/api/export` and the Copilot history endpoint, from every account with prior access, returns 404 or an empty result set, and a direct SQL count of derived rows for that pair — including `chat_messages` matched on `retrieved_subject_ids` — is 0.
20. No page renders a relatedness coefficient, shared-DNA quantity, or relationship label derived from comparing two subjects.
21. An embryo upload with only one parent's attestation is rejected and the upload control never enables; the second parent's withdrawal link deletes every embryo-derived row.
22. Every cell on `/embryos/compare` renders a within-family accuracy sentence or the exact untested string; a fixture score lacking within-family data renders the untested string and its row is disabled by default.
23. `/embryos/compare` renders no composite score, no "best" badge, no default sort by a result row, and no integer counting rows an embryo leads on; the trade-offs panel is present and cannot be dismissed.
24. A QC-failed embryo renders as a full column with the chip `Quality check not passed` and a stated reason; the context strip counts it.
25. With no recorded jurisdiction, `/embryos/compare` renders no sex row and renders the exact unavailability string.
26. No page under `/embryos` renders the strings `"a result about you"` or `"What you might do"`, and no embryo surface renders a category outside the §6.3 allowlist.
27. Uploading a PDF-only laboratory report succeeds, is listed, and renders `"Stored for your records. Inherit cannot analyse a PDF report."`
28. Every old route in §8 returns 307 or 308 to its mapped target; every pre-migration template slug resolves; none returns 404 or 200.
29. On a file below the panel's reliability threshold, the ancestry map renders grey with zero percentages and the raw numbers are reachable in one activation.
30. Shown region shares + `"Not assignable to any region"` + `"Hidden as not well supported"` = 100.0% ± 0.1, asserted separately in the default (toggle on) and toggled-off views; both chips render at 0%. No region label matches the committed nationality/ethnonym denylist.
31. With the shipped 168-marker panel fixture, the sub-continental tier control is absent and the page states why in one sentence.
32. `/genome/[subject]/ancestry` contains the string `Neanderthal`; the string `archaic-hominin` appears on no user-visible surface.
33. At 1280×800, `/overview` (empty and populated), `/genome/me/reports`, `/family`, `/genome/me/reports/[slug]` and `/genome/me/ancestry` each render ≤12 interactive elements in the first 800px excluding nav and dock; `/family/health-picture` and `/embryos/compare` each render ≤24. No prose `<p>` in `(app)` exceeds 68ch at 1280px. Adjacent top-level `<section>` gaps are ≥96px at ≥1024px and ≥48px below. No top-level grid row renders more than 3 cards at ≥1024px.
34. `axe-core` reports zero serious or critical violations on `/overview`, a report page, `/genome/me/ancestry`, `/family/health-picture` and `/embryos/compare`. Every `--subject-*` token meets ≥3:1 against `--paper` and `--card` in both themes. No subject-coloured card lacks the subject's name or initial as text.
35. The dock header on every `(app)` route states a scope naming the current subject, report, family view or cohort. An account with no `llm_settings` row opens the dock to the unconfigured panel and never a text input.
36. A cohort-scoped Copilot request to rank or choose an embryo returns the fixed refusal string with zero model calls recorded; the same holds for a family-scoped request for a prohibited Portrait output.
37. For every route in the sitemap, the raw HTTP response body — fetched with `curl`, not read from a hydrated DOM — contains zero matches of `\[[A-Z_.]+\]`.
38. `pnpm gate:reading` reports Flesch–Kincaid grade ≤9 for every string in the `(app)` copy manifest. Each of `baseline`, `percentile`, `haplogroup` renders a ≤20-word definition, expanded, on first occurrence per page.
39. `pnpm gate:copy-names` fails on any capitalised proper noun in the copy manifest that is not on the committed third-party allowlist, is not a place, gene, condition, or cited author name.
40. Export and account deletion are each reachable in ≤2 clicks from any `(app)` route; the export archive is subject-partitioned, labelled by subject, and includes every subject the account owns.


---

## 3. UX craft, the visual system, and the language guide

### 0. Scope, precedence, enforcement

This section governs every pixel and every word Inherit renders.

**Relationship to the existing tokens.** It *extends* `src/app/globals.css` with new named tokens and changes the numeric size of the `.eyebrow` utility. It does *not* change the existing hues (`--paper`, `--ink`, `--ink-muted`, `--forest`, `--forest-deep`, `--tint`, `--card`, `--line`, `--danger`, `--ok`), the two font families, or the meaning of `.display` and `.accent`. Where this section conflicts with an existing component, this section wins and the component is rewritten.

**Quoted strings are normative including punctuation.** Every string in double quotes here ships character-for-character, including the typographic apostrophe U+2019 (’) and em dash U+2014 (—). A string differing by punctuation is a defect.

**Gates.** Four scripts join the existing `pnpm gate:legal` in `package.json` and CI. Each exits non-zero with a `file:line` list; a build failing any of them does not ship.

- `pnpm gate:language` — reading level, mechanical banned-phrase blocklist, copy-location rule, lexicon coverage.
- `pnpm gate:tokens` — contrast matrix for both themes, the `data-meaning` redundancy rule, colour-literal ban.
- `pnpm gate:design` — spacing and size scales, measure, page widths, heading rules, Fraunces allow-list, figure-slot completeness, one-primary-action rule, per-file line limit.
- `pnpm gate:density` — the white-space budgets of §1.5.

Judgements no script can make live in `docs/copy-review.md` and are signed off per release. Every rule sits in exactly one of those two places, never both.

#### 0.1 `PRIMARY_ROUTES` — the one normative route list

Every gate, density budget and crawl in this section takes its scope from this list and no other. It is exported once from `src/lib/primary-routes.ts` and imported by each gate; `gate:design` fails if any gate or spec file hard-codes a route path that is not in it.

| # | Route | Surface class | Max content width | h1 (exact) |
|---|---|---|---|---|
| 1 | `/overview` | hub | `72rem` | "Overview" |
| 2 | `/genome` | standard | `64rem` | "My genome" |
| 3 | `/reports` | standard | `64rem` | "Reports" |
| 4 | `/reports/[slug]` | reading | `44rem` | the report name |
| 5 | `/ancestry` | wide-data | `90rem` | "Ancestry" |
| 6 | `/family` | standard | `64rem` | "Family" |
| 7 | `/family/portrait` | standard | `64rem` | "Portrait" |
| 8 | `/embryos` | standard | `64rem` | "Embryos" |
| 9 | `/embryos/compare` | wide-data | `90rem` | "Compare embryos" |
| 10 | `/copilot` | standard | `64rem` | "Copilot" |

"Wide-data surfaces" means exactly routes 5 and 9. Secondary app routes (`/uploads`, `/settings`, `/browse`, `/dashboard`) and any route not named anywhere in this section default to **standard, `64rem`**. Reading routes are `/privacy`, `/terms`, `/legal/*`, `/about`, `/changelog` and route 4, at `44rem`. If the information-architecture section of this specification names a different path for one of these ten surfaces, that path wins and this table is edited to match; the list must always contain exactly these ten surfaces.

---

### 1. Space

#### 1.1 Two closed scales

**Layout spacing** (margin, padding, gap only). Base unit 4px, exposed via `@theme inline` as `--spacing-*`.

`--space-1` 4 · `--space-2` 8 · `--space-3` 12 · `--space-4` 16 · `--space-6` 24 · `--space-8` 32 · `--space-10` 40 · `--space-12` 48 · `--space-16` 64 · `--space-20` 80 · `--space-24` 96 · `--space-32` 128.

No margin, padding or gap outside this list may appear in the repository. `gate:design` fails on `p-5`, `p-7`, `gap-5`, `space-y-5`, arbitrary `[13px]` values, or any Tailwind spacing utility whose computed value is absent from the list.

**Control and stroke sizes** — a separate, equally closed scale, because 44px targets are not multiples of the layout unit and must not be forced into it:

`--size-control: 44px` (every button, input, switch, tap target) · `--size-row: 56px` (minimum grid/table row height) · `--size-navbar: 64px` (mobile bottom bar) · border widths `1px` and `2px` · `--ring-width: 3px` with `--ring-offset: 2px` · radii per §1.4.

These are the only dimension values permitted outside the layout scale. Any other hard-coded px dimension fails `gate:design`.

#### 1.2 Vertical rhythm

Margins **between blocks in the vertical flow** use only `--space-4`, `--space-6`, `--space-8`, `--space-12`, `--space-16`, `--space-20`, `--space-24`, `--space-32`. Inside a labelled group (a `Field`, the slots of a `Figure`), `--space-1` through `--space-3` are permitted. No baseline grid is enforced and none should be claimed.

Section separators: `--space-16` (64px) below 768px; `--space-20` (80px) at 768–1023px; `--space-24` (96px) at 1024px and above. **This is the concrete change from today:** the app currently separates top-level blocks with `space-y-8` (32px) at every width. Every `space-y-8` on a page root is replaced by the responsive rhythm above. Blocks inside one section use `--space-12` (48px).

#### 1.3 Measure

Body measure is capped at **68ch** at every viewport. A lower bound is applied only where it is arithmetically reachable:

- Below 640px: **no minimum**. At 390px with the mandated 24px surface padding, 342px of content at 16px Inter is about 39ch (Inter's "0" advance is ≈0.55em ≈ 8.8px at 16px), so any minimum above ~38ch is wider than the phone. A gate demanding 45ch on a phone can never pass.
- 640px and above: minimum **45ch**.
- Inside the 1024px standard width, prose blocks are constrained to 68ch. A full-bleed 1024px paragraph fails the gate.

`gate:design` measures rendered `<p>` and `<li>` at 390 / 768 / 1280 across `PRIMARY_ROUTES`. It computes `ch` as the element's rendered width divided by the measured advance width of "0" in that element's own computed font, never from an assumed constant.

#### 1.4 Surfaces, radii, borders

- **Surface padding.** `pad="md"` (the default): `--space-6` below 768px, `--space-8` at 768–1023px, `--space-10` at 1024px+. This replaces today's `p-5`. `pad="sm"`: `--space-4` / `--space-6` / `--space-6`, permitted only on inset rows and chart grounds.
- **Radii — exactly three.** `--radius-sm: 10px` (inputs, pills, chart elements), `--radius-lg: 20px` (surfaces), `--radius-pill: 9999px` (buttons, badges).
- **Borders.** Two tokens. `--line` (existing, unchanged) is decorative only: separators between rows of the same kind, and surface edges where the `--card` ground already distinguishes the box. `--line-strong` is new and mandatory for form outlines, chart strokes, glyph outlines and any edge that carries information: light `#76857b` (3.63:1 on `--paper`, 3.81:1 on `--card`), dark `#6c7b73` (4.09:1 / 3.78:1). Every component states which of the two it uses.
- **Shadows are removed.** Delete `shadow-sm` / `shadow-xs` everywhere; elevation is the `--card` ground plus the border. One exception: overlays (dialog, popover, toast) use the single shared `--shadow-overlay: 0 8px 32px rgb(20 32 27 / 0.12)`.

#### 1.5 The density budget — "more white space", made measurable

`gate:density` runs against `PRIMARY_ROUTES` at 390×844 and 1280×800, **light theme only**, device pixel ratio 1, authenticated as the seeded fixture user with the seeded fixture genome.

1. **Ink coverage.** Screenshot the first viewport. Compute CIEDE2000 in Lab from sRGB, D65, against the light-theme `--paper`. The share of pixels with ΔE2000 ≥ **8** must be ≤ **38%** on hub and standard routes and ≤ **55%** on wide-data routes. The 8 threshold is above the card/paper separation, so surface grounds are never counted as ink. Map tiles and user-supplied images are excluded from both numerator and denominator. Dark theme is not measured: the metric is a light-ground metric and inverting it produces a different, incomparable number.
2. **Character budget.** Visible text characters in the first viewport: ≤ **480** on `/overview` and the three domain landings; ≤ **700** elsewhere.
3. **Focusable budget.** Focusable elements in the first viewport, counting the skip link and the bottom bar: ≤ **18** on `/overview` (skip link + 5 nav + 9 domain entries + up to 3 chrome), ≤ **14** on domain landings, ≤ **20** elsewhere.

On first measurement of each route, record the actual figure in `docs/density-baseline.md`. Thereafter a ceiling may be **lowered** but never raised.

---

### 2. Type

Two families only: Fraunces (`--font-display`), Inter (`--font-sans`). No third family, no icon font.

| Role | Family / weight | Size | Line-height | Tracking |
|---|---|---|---|---|
| `display-1` (page h1) | Fraunces 400 | `clamp(2rem, 1.2rem + 3.2vw, 3.25rem)` | 1.05 | −0.02em |
| `display-2` (h2, marketing/hub) | Fraunces 400 | `clamp(1.5rem, 1.2rem + 1.2vw, 2rem)` | 1.15 | −0.015em |
| `figure` (the number) | Fraunces 400, tabular | `clamp(2.25rem, 1.6rem + 2.4vw, 3rem)` | 1.0 | −0.02em |
| `title` (h3, surface heading) | Inter 600 | 18px | 1.4 | −0.005em |
| `body-lg` | Inter 400 | 17px | 1.65 | 0 |
| `body` | Inter 400 | 16px | 1.6 | 0 |
| `small` | Inter 400 | 14px | 1.55 | 0 |
| `caption` | Inter 400 | 13px | 1.5 | 0 |
| `eyebrow` | Inter 600 | **13px (0.8125rem)** | 1.0 | 0.14em, uppercase |
| `label` | Inter 500 | 14px | 1.4 | 0.01em |
| `mono` | `ui-monospace` stack | 14px | 1.5 | 0 |

**No text below 13px anywhere, no exceptions** — chart axis labels and legal fine print included. Today's `.eyebrow` (0.72rem, 11.5px) is raised to 13px and its tracking reduced to 0.14em so line length is unchanged. `gate:design` asserts the computed `font-size` floor from the rendered DOM, not from the token file.

#### 2.1 Where the display serif is allowed

Fraunces renders on exactly five selectors, and `gate:design` asserts computed `font-family` contains "fraunces" nowhere else:

`h1` · `[data-slot="figure-value"]` · `[data-slot="wordmark"]` · `[data-role="pull-quote"]` · `h2` inside `[data-surface="marketing"]` or `[data-surface="hub"]`.

Fraunces is forbidden in body copy, paragraphs, buttons, form labels, input values, table cells and headers, navigation, badges, tooltips, errors, empty states and chart labels; on any text under 18px; and on any run over 12 words — except `[data-role="pull-quote"]`, which is capped at 30 words.

#### 2.2 The anti-heading-soup rule

- Exactly one `h1` per page (axe `page-has-heading-one` plus a `gate:design` count).
- Three heading levels maximum on an app surface (h1, h2, h3). `h4`–`h6` are forbidden outside legal prose, where `h4` is permitted.
- Every `h2` is followed by ≥ 80 characters of non-heading content before the next heading.
- Maximum headings per surface: **4** on `/overview`, **6** on any other app surface, unlimited on report bodies and legal pages. On `/overview` this is 1 `h1` plus 3 domain `h2`s. **The nine domain-entry boxes are not headings**: each box's name is the accessible name of a link rendered in the `title` type role. This is stated so an implementer never has to choose between the user's sketched Overview and the heading cap.
- A `title`-role surface heading must not repeat its parent `h2`.
- Report detail pages have a fixed skeleton of exactly five `h2`s, in this order, never added to, renamed or reordered: "What this is", "Your result", "How sure we are", "What you can do", "Where this comes from". Slot 8 of §7.1 (Limits) lives inside "How sure we are". Sources live inside "Where this comes from" as a section, **not** behind a disclosure.
- Where a report has nothing actionable, "What you can do" renders exactly: "There is nothing you need to do about this result. It does not change what any doctor would advise for you today." This string exists so the mandatory heading can never be filled with treatment advice, which §6.4 forbids.

---

### 3. Colour

#### 3.1 New tokens

Added to `:root` and `.dark`, then to `@theme inline`. Every value below has been computed against the real grounds; `gate:tokens` recomputes them and fails on any regression. Light grounds: `--paper` `#f7f8f1`, `--card` `#fdfdf9`, `--surface-inset` `#eef1e4` (new). Dark grounds: `#101713`, `#171f1a`, `--surface-inset` `#1b241e` (new).

| Token | Light | ratio paper / card | Dark | ratio paper / card | Meaning |
|---|---|---|---|---|---|
| `--dir-higher` | `#8f3527` | 7.26 / 7.61 | `#e59586` | 7.78 / 7.20 | above the comparison group |
| `--dir-typical` | `#4c5a52` | 6.80 / 7.12 | `#a9b6ad` | 8.65 / 8.00 | within it |
| `--dir-lower` | `#26543e` | 8.12 / 8.51 | `#7fbf9c` | 8.52 / 7.88 | below it |
| `--evidence-strong` | `#26543e` | 8.12 / 8.51 | `#7fbf9c` | 8.52 / 7.88 | established |
| `--evidence-moderate` | `#4f5c3a` | 6.72 / 7.04 | `#b3c48d` | 9.70 / 8.98 | moderate |
| `--evidence-early` | `#5a6155` | 6.00 / 6.29 | `#9aa695` | 7.16 / 6.62 | preliminary |
| `--state-covered` | `#26543e` | 8.12 / 8.51 | `#7fbf9c` | 8.52 / 7.88 | file reads this marker |
| `--state-partial` | `#6b5a1f` | 6.32 / 6.63 | `#d8c273` | 10.30 / 9.53 | reads some |
| `--state-missing` | `#5a6155` | 6.00 / 6.29 | `#9aa695` | 7.16 / 6.62 | does not read it |

Several tokens share a hex. That is deliberate and harmless, because meaning is never carried by colour (§3.2). **Permission state carries no colour at all**: `PermissionGrantRow` renders in `--ink` with the key glyph and the word "On", "Off" or "Expired". This removes the red/green good-bad pair from a non-health context, which §3.5 bans.

`--tint` (`#e9efc4`) keeps its existing job — the one soft highlight ground for callouts and the active nav item. It carries no meaning and must never encode risk, evidence or state.

**Composition ramp.** Composition and identity (ancestry mix, coverage breakdown) use a six-step ordered neutral ramp carrying no meaning:
light `#181f19`, `#2a392d`, `#3c4f3f`, `#4d6651`, `#5e7d63`, `#709376`; dark `#e7ece8`, `#bfcec1`, `#9ab39e`, `#7a9b7f`, `#628368`, `#546f58`. Every step is ≥ 3:1 against `--card` and `--paper` in its theme; adjacent steps are ≈1.38:1 apart. **A 3:1 requirement between adjacent segments is rejected as arithmetically impossible** — eight steps each 3:1 apart need a 2,187:1 luminance range, which no ground admits. Legibility is therefore secured by the label, not the ramp: every segment carries a number and a leader line to its row in the adjacent ordered list, ramp order is fixed and matches list order, and a maximum of six segments render (a seventh and beyond are grouped as "Other"). Segments below 2% are also grouped into "Other".

#### 3.2 Redundancy — one mechanism, keyed on an attribute not on a colour

The only permitted way to apply a semantic token is an element carrying `data-meaning="<meaning>"`, where `<meaning>` is one of the nine names below. An ESLint rule bans the `--dir-*`, `--evidence-*` and `--state-*` tokens outside the components that set `data-meaning`. `gate:tokens` asserts that every `[data-meaning]` element has (a) a `[data-meaning-glyph]` descendant, inline SVG, `aria-hidden="true"`, and (b) accessible text exactly matching the word for that meaning. It never inspects computed colour — a colour-keyed gate is unimplementable here, because `--dir-lower` equals the existing `--forest` that paints every link and primary button.

| `data-meaning` | Glyph | Word (exact) |
|---|---|---|
| `higher` | filled upward triangle | "higher than people like you" |
| `typical` | filled circle | "about the same as people like you" |
| `lower` | filled downward triangle | "lower than people like you" |
| `evidence-strong` | three filled pips | "Established" |
| `evidence-moderate` | two filled, one hollow pip | "Moderate evidence" |
| `evidence-early` | one filled, two hollow pips | "Preliminary" |
| `covered` | filled square | "Read from your file" |
| `partial` | half-filled square | "Partly read" |
| `missing` | hollow square with a diagonal | "Not in your file" |

`e2e/colour-redundancy.spec.ts` re-renders each of `PRIMARY_ROUTES` under `filter: grayscale(1)` and asserts every result row still exposes its word via `getByText`; a second pass applies deuteranopia, protanopia and tritanopia matrices and asserts the same.

#### 3.3 Contrast

- **Body text** (`body`, `body-lg`, `title`, `display-*`, `figure`), in `--ink`: **≥ 7:1**. `--ink` on `--paper` is 15.69:1.
- **All other text**, `small` and `caption` included: **≥ 4.5:1**. `--ink-muted` on `--paper` is 6.80:1. It is deliberately *not* raised to 7:1: doing so would darken the brand's secondary ink, which §0 forbids, for no benefit an average reader notices. Inherit therefore claims 7:1 for its primary ink and 4.5:1 elsewhere, and makes no AAA 1.4.6 conformance claim (see §10).
- **Borders that carry information, form outlines, chart strokes, glyph outlines**: ≥ 3:1, satisfied by `--line-strong`.
- **Focus ring**: ≥ 3:1 against both the component and the page ground; `--ring-width: 3px`, offset 2px.
- **Semantic tokens on `--card` and `--paper`, both themes**: ≥ 4.5:1 (all nine exceed 6:1 above).

`gate:tokens` computes the full matrix from the parsed custom properties for `:root` and `.dark`, prints it, and fails below any minimum. `docs/contrast-matrix.md` holds the expected baseline so a regression is a diff, not a judgement. Zero hard-coded hex or `rgb()` literals may appear outside `globals.css`.

#### 3.4 Colour is suppressed entirely inside embryo comparison

On `/embryos` and `/embryos/compare`, and in any embryo row anywhere, **no semantic colour renders**. Coverage, direction and evidence are conveyed by glyph and word only, in `--ink` and `--ink-muted`. Embryo identity chips and columns are identical in colour, weight, size and order treatment at all times; no colour, weight, order, badge or ordinal may encode an embryo's rank. Named anti-pattern: **winner encoding**. `e2e/colour-redundancy.spec.ts` asserts that on those routes no element's computed colour matches any `--dir-*`, `--state-*` or `--evidence-*` value.

#### 3.5 Prohibitions

A red/green good-bad pair is permitted **only** for health-risk direction (`--dir-higher` / `--dir-lower`), and only alongside its glyph and word. It is banned for permission state, ancestry, traits, haplogroups, embryos, upload status and job status. Ancestry regions and haplogroups use the composition ramp of §3.1; trait results use `--ink` and `--ink-muted`.

---

### 4. Components

#### 4.1 Seven primitives

Nothing outside `src/components/ui/` may define its own padding, colour, radius or type size.

1. **`Surface`** — the one box. `tone` (`plain` | `inset` | `tint` | `dashed`), `pad` (`sm` | `md`, per §1.4), `as`. Replaces `Card` and its six sub-parts.
2. **`Stack`** — vertical/horizontal flow, `gap` restricted to §1.1. Replaces ad-hoc `space-y-*` on page roots.
3. **`Text`** — renders one of the eleven roles in §2. All copy passes through it.
4. **`Action`** — buttons and link-buttons. Variants `primary`, `secondary`, `quiet`, `destructive`. **One size: 44px.** The 36px size is deleted rather than carved out; a second size that violates the touch minimum is not worth its complexity.
5. **`Field`** — label + control + help + error as one unit, wrapping `Input`, `Textarea`, `Select`, `Switch`. A bare `<input>` fails the gate.
6. **`Disclosure`** — the single progressive-detail mechanism. Every "learn more", method note and glossary expansion uses it.
7. **`Figure`** — number, unit, comparison, caption (§5.1).

#### 4.2 Composed components and required states

A component shipped without a designed state for a case it can reach is a defect.

| Component | States |
|---|---|
| `RiskFigure` | default, partial, not-covered, error |
| `Metric` | default, empty, loading, not-covered |
| `EvidencePanel` (absorbs `reports/support-panel`) | default, empty |
| `CoverageBar` | default, partial, not-covered |
| `ResultGate` (generalises `reports/sensitive-gate`) | tier-1, tier-2, revealed, counsellor-available, counsellor-unavailable |
| `ConsentDialog` (generalises `chat/consent-dialog`) | request, granted, expired, revoked, denied |
| `UploadDropzone` | choose-subject, idle, validating, uploading, paused, error, done |
| `JobProgress` (absorbs `uploads/auto-refresh`) | queued, running, stalled, failed, done |
| `SubjectBadge` | self, other-adult, embryo, **subject-unverified** |
| `EmbryoCompare` | empty, loading, partial, error, no-clear-answer |
| `EmbryoCard` | default, partial-data, failed-qc |
| `AncestryMap` | loading, default, low-resolution, unsupported-region |
| `RegionList` | default, empty |
| `NeanderthalCard` | default, not-covered |
| `PortraitTrait` | default, not-covered, both-genomes-required |
| `TraitRow` | default, not-covered |
| `ChatThread` | empty, streaming, **refused**, error, no-key, consent-required |
| `SourceList`, `GlossaryTerm`, `SettingsRow` (absorbs `digest-toggle`), `DangerAction`, `PermissionGrantRow` (from `consent-list`), `EmptyState`, `ErrorState`, `DataGrid`, and the four charts of §5.4 | as declared in `e2e/states.spec.ts` |

**`SubjectBadge` has no `unknown` state.** A file with no recorded subject class renders `subject-unverified`, which blocks all analysis and offers exactly one `Action`: "Tell us whose file this is".

**Budget.** `src/components/ui/` holds at most **18** files, being exactly: `surface`, `stack`, `text`, `action`, `field`, `disclosure`, `figure`, `pill`, `input`, `textarea`, `select`, `switch`, `label`, `dialog`, `sonner`, `table`, `tabs`, `data-grid`. No total-file count is imposed on `src/components/` — the section mandates roughly thirty components and a file ceiling would only force unrelated things into one file. Complexity is controlled instead by: **no component file exceeds 220 lines**, and the primitive rule in §4.1. `gate:design` enforces both.

#### 4.3 Deletions and merges, corrected against the repository

Verified consumer counts as of this specification:

- **`ui/card.tsx`, `ui/dropdown-menu.tsx`, `ui/table.tsx`, `ui/tabs.tsx`, `ui/sonner.tsx` have zero consumers today.** Delete `card.tsx` and `dropdown-menu.tsx` outright. `table.tsx`, `tabs.tsx` and `sonner.tsx` are kept only because this section introduces their first consumers (`DataGrid`, the one tabbed surface, the Undo toast); `<Table>` may be used only inside `DataGrid`, and `tabs` ships exactly one visual variant.
- **`ui/badge.tsx` has four consumers**: `src/components/providers/directory.tsx`, `src/components/reports/report-library.tsx`, `src/app/(app)/uploads/page.tsx`, `src/app/(app)/reports/[slug]/page.tsx`. Migrate all four to `ui/pill.tsx`, which exposes only the nine meanings of §3.2 plus `neutral`, then delete `badge.tsx`.
- **`ui/button.tsx` has twenty consumers.** Replace with `Action`; migrate all twenty.
- **Delete** `uploads/auto-refresh.tsx` (polling moves into `JobProgress`) and `settings/digest-toggle.tsx` (becomes a `SettingsRow`).
- **Merge** `reports/support-panel.tsx` into `EvidencePanel`; `chat/consent-dialog.tsx` into the shared `ConsentDialog`, which serves five consent kinds (cloud model use, another adult's genome, your own embryos, embryos with both genetic parents' permission, research release).
- **Rename** `reports/sensitive-gate.tsx` → `components/results/result-gate.tsx`.

**Three existing files exceed the 220-line limit and must be decomposed:** `src/components/providers/directory.tsx` (453) splits into a filter panel, a provider row and a data hook; `src/components/uploads/uploader.tsx` (232) splits the TUS transport out of the UI; `src/components/browse/genome-browser.tsx` (320) splits presentation from configuration **but its XHR guard and remote-genome-fetch guard must remain together in a single module**, because they are the mechanism keeping the CI network audit green. `e2e/network-audit.spec.ts` must pass unchanged both before and after that split, and the split is reverted if it does not.

---

### 5. Numbers and charts

#### 5.1 Universal number rules

1. Every number at `figure` or `display` size sits inside a `Figure` and is accompanied, **within the same bordered surface**, by a labelled comparison value and an explicit denominator or unit. `gate:design` asserts every `[data-slot="figure-value"]` has sibling `[data-slot="figure-comparison"]` and `[data-slot="figure-unit"]`.
2. Three significant figures maximum. Never an unrounded float.
3. `font-variant-numeric: tabular-nums` wherever numbers are compared or stacked.
4. Locale thousands separators; default `en-GB`.
5. A percentage never appears without its reference group named in adjacent text.

**One vocabulary for the reference group.** The short form everywhere is **"people like you"**. On first use on a surface it is expanded once, in full: "people like you — women aged 40 to 50 with ancestry like yours". "Comparison group", "average", "baseline", "population risk" and "the typical chance" are banned from the UI and are entries in the §6.3 lexicon.

#### 5.2 Risk figures

Convert every risk to a natural frequency and lead with it.

| Absolute risk | Rendered as |
|---|---|
| ≥ 10% | "about N in 100" |
| 1% – < 10% | "about N in 1,000" |
| 0.1% – < 1% | "about N in 10,000" |
| < 0.1% | "fewer than 1 in 10,000" |

**Denominator precedence.** One denominator per page. It is selected from the *largest* figure appearing anywhere on that page using the table above, and every figure on the page — personal, comparison, difference and any relative measure — is rendered on it. The page lede states it once: "All the chances on this page are out of 1,000 people." Two reports about the same person may therefore use different denominators; within one page or one comparison they never do.

The percentage form may appear once, in `small` type, beneath the natural frequency.

Percentiles are integers clamped 1–99 and written as a sentence: "higher than about 80 of every 100 people like you". A bare "80th percentile" is banned.

**Relative measures — one policy, stated once.** Odds ratios never render in the UI, at any size, anywhere. Relative risk and relative reductions render only inside an `EvidencePanel`, never as a headline, never at `figure` size, and only alongside, in the same surface: both absolute figures on the page denominator, the difference in percentage points, and the per-N-people figure ("for every 1,000 people, about 12 fewer would be affected"). The phrase "up to" is banned everywhere with no exception. Named anti-patterns: **relative-only headline**, **spread-as-average** (a best-versus-worst spread presented as an average gain), **unlabelled comparator**. Mechanically, relative-measure strings may live only in `src/copy/evidence/**`; `gate:language` fails on them in any other path.

#### 5.3 Uncertainty is mandatory

Every modelled estimate renders an interval. If no interval can be computed, the point estimate does not render at `figure` size; `RiskFigure` renders `partial` with exactly: "We can’t put a range on this yet, so we don’t show a single number." Named anti-pattern: **point estimate without a range**. Intervals draw as a `RangeBar` and are written as "somewhere between A and B, most likely around C".

#### 5.4 Charts — four types, one job each

| Chart | Its only job | Rules |
|---|---|---|
| `DotArray` | show a natural frequency | permitted only for figures ≥ 1%; 100 or 1,000 dots, 10 per row; filled dots carry a `--line-strong` border so they read in greyscale; the count is stated in text above |
| `RangeBar` | one estimate with its interval against one baseline | horizontal; axis starts at 0; baseline is a labelled vertical rule; interval is the bar; point estimate is a notch; the drawn interval is never narrower than 4px, and where the true interval is narrower the bar renders at 4px with the caption "The range is too small to draw at this scale." |
| `DistributionCurve` | where the user sits | axis labelled in the figure's units; user's position a labelled pin; shaded region labelled with the percentile sentence |
| `Proportion` | composition | one horizontal bar, ≤ 6 labelled segments plus "Other"; composition ramp of §3.1; numbered leader lines to the adjacent ordered list |

Below 1% the natural frequency is stated in text with a `RangeBar` only; no dot array.

**Banned outright:** pie and donut charts, radar charts, gauges and speedometers, 3D effects, dual-axis charts, truncated magnitude axes, animated count-ups, sparklines without labelled endpoints, word clouds, and any chart encoding more than one variable per axis. Every chart carries a `<figcaption>` naming the quantity, the unit and "people like you", plus a `<table>` fallback behind a `Disclosure` labelled "See these numbers as a table".

---

### 6. Language

#### 6.1 Voice

Sentence case everywhere; Title Case and ALL CAPS only in the `eyebrow` role and the wordmark. Second person; first person plural only for Inherit's own actions and limits; never "I" outside Copilot's own refusal strings. Active voice. One idea per sentence: mean sentence length ≤ 17 words across the corpus, no UI sentence over 28 words, no legal sentence over 34. No exclamation marks, no emoji, no ellipses except in a truncating string. No superlatives, no novelty claims, no reassurance the data cannot support, no fear framing. Numbers 0–9 spelled out in prose; numerals always in data and results.

Passive voice is **not** a gate. No reproducible detector exists that two builds would agree on, so a numeric passive threshold is a restated intention wearing a number; it moves to the manual checklist in `docs/copy-review.md` instead.

#### 6.2 Where copy lives, and reading level

**Every user-visible string is exported from `src/copy/**/*.ts`,** regardless of length or punctuation. The length and punctuation carve-out is deleted: it exempted exactly the densest jargon sites in a genomics product — headings, buttons, table headers, chart axes, empty-state titles. `gate:language` fails on any user-visible string literal in a `.tsx` file, except an enumerated allow-list of opaque tokens: rsIDs matching `rs\d+`, chromosome labels matching `chr[0-9XYM]+`, file names, hashes, and single arithmetic operators.

Corpus paths and thresholds (Flesch–Kincaid grade, computed with the Carnegie-Mellon syllable dictionary plus a documented fallback heuristic; before scoring, each glossary term is replaced with a two-syllable placeholder):

- `src/copy/app/**` — FK ≤ **8.0**; no single string above 10.0.
- `src/copy/reports/**` and `src/copy/glossary/**` — FK ≤ **9.0**.
- `src/copy/consent/**` — FK ≤ **8.0**. Consent copy is separated from legal copy for exactly this reason: two different thresholds were previously asserted for one corpus.
- `src/copy/legal/**` — FK ≤ **11.0**, and each legal page carries a plain-language summary block at the top scoring ≤ 8.0 and running 60–120 words.
- `src/copy/evidence/**` — FK ≤ 9.0; the only path where relative measures may appear.

Also: four-or-more-syllable words ≤ 5% of the corpus after substitution; no double spaces; no straight apostrophes. The glossary substitution list is capped at 60 entries in one committed file, `src/copy/glossary/allow-list.ts`, with a named owner in `docs/copy-review.md`; every addition carries a one-line justification, and `gate:language` fails if the file changes without a corresponding `docs/` entry.

#### 6.3 The lexicon

Left: what Inherit does not put in front of a user. Middle: what it writes. Right: the gloss `GlossaryTerm` shows inline on first use where the technical term must survive (file formats, clinical labels, consent documents). **The check runs across all of `src/copy/**`, not just `src/copy/app/**`** — the ~120 report bodies are what an average person actually reads.

| Not this | Inherit writes | Gloss |
|---|---|---|
| genotype | your two letters at this spot | You inherit two letters at each spot, one from each parent. |
| variant | DNA spot | A place in your DNA where people commonly differ. |
| allele | one of your two letters | — |
| heterozygous / homozygous | one copy / two copies | — |
| reference allele | the more common letter | The letter most people carry there. |
| SNP | single-letter difference | — |
| rsID | marker ID | The public catalogue number for a DNA spot. |
| locus | spot | — |
| genotyping array | a chip test | A test that reads a fixed list of DNA spots, not the whole genome. |
| whole-genome sequencing | full sequencing | Reading essentially all of your DNA. |
| polygenic score / PRS / PGS | combined score | Many small DNA effects added together into one number. |
| percentile | higher than N of every 100 people like you | — |
| comparison group / baseline / population risk / average | people like you | The group we compared you with. |
| penetrance | how often people with this result are affected | — |
| carrier | you carry one copy | You have this change on one of your two copies. For most conditions that means you are unlikely to be affected yourself, but for some it does not, and you could pass it on. |
| monogenic / polygenic | single-gene / many-gene | — |
| odds ratio | *(never renders in the UI)* | — |
| relative risk | compared with people like you | — |
| absolute risk | your chance, out of the people on this page | — |
| number needed to treat | how many people this would change one outcome for | — |
| confidence interval | the range we’re reasonably sure about | Our best range, not a single exact number. |
| coverage | how much of this your file reads | — |
| no-call | your file didn’t read this spot | — |
| imputation | filled in by estimate | Estimated from nearby spots your file did read. |
| liftover / GRCh37 / GRCh38 | the older map / the current map | Older files use an older map of the genome; we convert them. |
| haplogroup | deep ancestry branch | A branch of the family tree of all humans, traced through one parent line. |
| mtDNA / Y-DNA | your mother’s-line DNA / your father’s-line DNA | — |
| admixture | ancestry mix | — |
| sub-continental region | region | A smaller area within a continent. |
| IBD segment | shared stretch | — |
| phasing | which letters travelled together | — |
| allelic dropout | a letter the test missed | — |
| euploid / aneuploidy | the usual number of chromosomes / an unusual number | — |
| blastocyst | a five- or six-day-old embryo | — |
| trophectoderm biopsy | a few cells from the embryo’s outer layer | If your clinic took a few cells from the embryo’s outer layer for testing, that is where this data comes from. |
| PGT-A | the chromosome-count test | A test some IVF clinics run to count an embryo’s chromosomes. Not every clinic runs it. |
| PGT-M | a test for one condition that runs in your family | — |
| PGT-P | ranking embryos on combined scores | — |
| VUS | a change we can’t interpret yet | We can see this change but nobody yet knows what it means. |
| pathogenic / likely pathogenic / benign | known to cause / very likely to cause / harmless | — |
| sensitivity / specificity | how often the test finds it / how often it correctly says no | — |
| heritability | how much of the difference between people DNA explains | This is about people in general, not about you. |
| within-family validation | tested between brothers and sisters | Checked by comparing siblings, a harder and fairer test. |
| ancestry portability | how well this works for your ancestry | Most of these models were built mostly in people of European ancestry. |
| FASTQ / BAM / CRAM | raw read files | — |
| VCF | variant file | A file listing the spots where your DNA differs from the map. |
| proband | the person this report is about | — |
| de novo variant | a change that appeared for the first time | — |
| consent grant / revoke | a permission you gave / turn off | — |
| RLS, row-level security | *(never appears in the UI)* | — |

Every glossed term renders as a `GlossaryTerm`: dotted underline, keyboard-focusable, expanding a `Disclosure` in place. Never a hover-only tooltip.

#### 6.4a Banned phrases — the mechanical blocklist

Held in `src/copy/banned.ts` as an array of `{ pattern: RegExp, id, message }`. Every pattern is anchored with `\b` word boundaries; `N` means `\d+(\.\d+)?`. `gate:language` runs it over the whole corpus and fails with `file:line`. A named owner in `docs/copy-review.md` maintains an explicit allow-list of reviewed false positives, each with a justification.

Banned, with the Inherit property each protects:

- `your future child`, `your baby`, `see your child` — Portrait estimates the range of what a child could inherit; it does not describe an individual.
- `designer bab(y|ies)`, `design your child`, `choose your child’s traits` — misstates what Inherit does.
- `the best embryo`, `top embryo`, `highest quality embryo`, `winner`, `ranked #?N` — no embryo has the lowest estimate on every condition Inherit displays, so no embryo can be described as best; a superlative asserts a comparison Inherit does not compute.
- `N% less likely`, `N% reduction`, `N% lower risk`, `up to` — outside `src/copy/evidence/**`, and `up to` everywhere.
- `average gain`, `N IQ points`, `IQ points` — Inherit renders no single-number cognitive prediction. Where a cognitive estimate exists at all it renders as a range, states that estimates measured within families are substantially smaller than estimates measured across a population, and is never labelled a gain or an average.
- `guaranteed`, `risk-free`, `peace of mind`, `worry-free` — false reassurance.
- `you are healthy`, `you’re in the clear`, `nothing to worry about`, `all clear` — Inherit cannot establish absence of risk.
- `your DNA says`, `written in your DNA`, `genetic destiny` — determinism.
- `unlock`, `reveal(s|ing)? the secrets?`, `hidden truth`, `the truth about your DNA` — mystery framing.
- `\bjust\b`, `\bsimply\b`, `\beasy\b`, `all you need to do` — minimises real effort. (`\b` prevents firing inside "adjust".)
- `cutting-edge`, `revolutionary`, `world-first`, `the only \w+ that`, `AI-powered`, `powered by AI` — unfalsifiable.
- `\binsights\b` — use "reports", "results", "estimates".
- `personalised for you` — filler.
- `N/A`, `TBD`, `Coming soon`, `\{\{`, `\[\[`, `\bLorem\b` — no string Inherit ships may contain an unresolved placeholder. `gate:legal` is extended from legal pages to every route in `PRIMARY_ROUTES` plus every legal and marketing route.
- `Something went wrong`, `An error occurred`, `Oops` — non-actionable.
- `Are you sure` — uninformative confirmation.
- `Please note`, `Kindly`, `sorry for any inconvenience` — filler.
- `\bnormal\b` applied to a person, result or genotype; `abnormal`, `\bdefect\b`, `mutation` (of a person's DNA) — use "typical", "more common", "difference", "change". The literal `\bnormal\b` is allow-listed only in the exact string "normal distribution".
- `elite`, `superior`, `optimal`, `enhanced` — ranks people.
- `cancel anytime`, `free forever`, `\bfree\b` as an availability promise — Inherit sells nothing and makes no availability promise.
- `physician-reviewed`, `reviewed by a doctor` — permitted only in a string that also names the licensed clinician who reviewed that specific report.
- `we recommend you take`, `\bdosage\b`, `\bsupplement\b` outside a refusal string — Inherit gives information, not treatment advice.
- `\bopen\b` applied to data, weights or models — permitted only in a string that also contains a working download URL.

#### 6.4b The review checklist (`docs/copy-review.md`)

These cannot be decided by a linter and are therefore not gates. Each is checked at code review and signed off per release:

- "accurate", "most accurate", "clinical-grade", "medical-grade" — permitted only where a named metric, a named comparator and a source appear on the same surface.
- "may" as the only modality in a limitation — every failure mode Inherit can reach must state what happens, what it costs the user, and what Inherit does next.
- "insights", "open", "free" allow-list entries — each reviewed individually.
- Passive-voice density and general tone.
- Whether each surface's reference group is named in full on first use.

#### 6.5 Microcopy

**Buttons.** Verb + object, sentence case, ≤ 3 words: "Upload a file", "Show my result", "Delete my genome". Banned standalone: "Submit", "OK", "Continue", "Next", "Confirm", "Yes", "Learn more". **Exactly one `primary` `Action` per viewport at every breakpoint**; any second high-emphasis action renders `secondary`. `gate:design` asserts at most one primary-variant element in the first viewport at 390 and 1280.

**Empty states.** `EmptyState` renders exactly four parts: heading ≤ 6 words; one sentence saying what would appear here; one sentence saying how to make it appear; one `Action`. No illustration. `/embryos` empty renders: "No embryo data yet." / "When you add an embryo variant file from your clinic, each embryo appears here." / "Not every clinic produces one — ask your clinic for the variant file from your embryo testing." / [Add embryo data].

**Errors.** `ErrorState` renders exactly: what happened, naming the object; why, in plain words; what to do next; one `Action` that does it. Never blame the user. Never expose an exception, stack trace, HTTP status or table name. A file that fails to parse says which line and what was expected.

**Confirmations and undo.** A confirmation dialog names the object and states the consequence in one sentence; its confirm button repeats the verb and the object. Reversible actions get a toast with "Undo" instead of a dialog. The toast **persists for 20 seconds, pauses on hover and on focus**, and every action it covers **remains undoable afterwards from the object's own surface** — the toast is a convenience, never the only route.

**Destructive wording, three tiers.** (1) Reversible — toast with Undo, no dialog. (2) Irreversible, scoped — dialog naming the object: "Delete the file mydata.txt? Your reports built from it disappear too. This can’t be undone." (3) Irreversible, account-wide — the user types the exact phrase shown (the file name, or "delete my account") before the destructive `Action` enables. The dialog states in full what survives deletion and what does not. Any data retained for a legal reason is stated **before** the button, and also on `/settings` and in `/privacy`. Named anti-pattern: **retention disclosed only at the exit** — a retention fact that appears only inside a deactivation dialog is a defect.

---

### 7. The result surface

#### 7.1 One canonical anatomy

There is exactly one result anatomy in Inherit. Three competing orderings were previously specified for this surface; this is the only one, and no other section states an independent ordering.

A single `Surface`, `pad="md"`, containing these slots in this order:

1. **Eyebrow** — the condition or trait name.
2. **Plain summary** — ≤ 40 words, `body-lg`, stating both what the result is and the single most important thing it cannot tell you. Example: "This estimates your chance of developing this condition by age 80. It cannot tell you whether you will develop it, and it is not a diagnosis." This slot is the "plain-language summary before any number" required of every report.
3. **Direction** — glyph + word per §3.2.
4. **Your figure** — `figure` role, natural frequency on the page denominator, with `figure-unit` beneath.
5. **Comparison figure** — same denominator, `body`, labelled "people like you" with the cohort named in full on first use.
6. **Range** — `RangeBar` plus the sentence form.
7. **Coverage** — "Read from your file: N of M markers" plus `CoverageBar`, or the not-covered state.
8. **Limits** — ≤ 40 words, `small`, always visible, never behind a disclosure. In order: that this is an estimate about groups and not a diagnosis; the ancestry groups the model was tested in; one named thing the estimate does not account for.
9. **Sources** — a link to the report's "Where this comes from" section, listing citations and the model version.

Reassurance may not appear before slot 2's limitation clause. Alarm language may not appear anywhere.

**Not-covered state.** `RiskFigure` renders nothing at `figure` size. It shows the eyebrow, the glyph and word "Not in your file", the sentence "Your file doesn’t read the DNA spots this report needs, so we have no result for you.", and one `Action`: "See which files cover this".

#### 7.2 `ResultGate` — three tiers

Today's gate withholds content server-side and remembers the choice in **device storage keyed by user id and category**; the choice does not follow the account to another device, and the surface says so. Both properties are kept.

- **Tier 0 — no gate.** Traits, ancestry, Neanderthal DNA, coverage.
- **Tier 1 — one click.** Common-disease combined scores and moderate-evidence reports. Current behaviour.
- **Tier 2 — explicit, session-scoped.** Single-gene results for serious conditions, any result about another adult, and any embryo comparison. The gate requires a checkbox labelled exactly: "I understand this can tell me something I can’t un-know." The choice is **never written to device storage**. It is suppressed for the remainder of the signed-in session only, stated on screen as "You won’t be asked again until you sign out."

The gate sits at the **domain boundary**, never on an individual condition row: a user comparing embryos passes exactly one Tier-2 gate per session, and `e2e/embryo-compare.spec.ts` asserts that count is exactly 1. An unbounded re-consent wall in front of the whole Embryo domain would defeat the product's purpose for the average user; the session scope is the resolution, and it is deliberate rather than a compromise.

**Counsellor routing.** `ResultGate` has two states. Where a route exists: "We can point you to a genetic counsellor. Inherit does not employ them and does not pay them. What they charge is between you and them." Where none exists for the user's region: "We don’t have a counsellor to point you to where you are. Your doctor can refer you." No pricing or availability promise is made. `e2e/result-gate.spec.ts` asserts the offered route resolves to a working destination.

---

### 8. The three domains

#### 8.1 Upload — declaring whose genome this is

`UploadDropzone` begins in the mandatory `choose-subject` state with exactly four options:

1. "My own DNA"
2. "Another adult’s DNA, with their permission"
3. "My embryos"
4. "Embryos, with both genetic parents’ permission"

Options 2–4 each require a checkbox attestation before the file input enables:

- (2) "This person is 18 or older and has given me permission to upload their DNA to Inherit. I can show that permission if asked."
- (3) "These are my own embryos and I am a genetic parent."
- (4) "Both genetic parents have given me permission to upload these embryos to Inherit. I can show that permission if asked."

The chosen class binds to `SubjectBadge` and to the Tier-2 gate. No analysis renders for a file without a recorded class. `e2e/upload-classes.spec.ts` asserts all four paths and asserts that a file with no class renders `subject-unverified` and no results.

#### 8.2 The other adult's own surface

A right that exists only as a badge on someone else's screen is not operable. When a file is uploaded under class 2, Inherit sends the named subject a notice containing a link to a **subject surface reachable without an Inherit account**. It shows, in plain words: which account holds a file about them, what has been derived from it, and one `Action` labelled exactly "Withdraw my permission", with the consequence stated above the button: "Your file and every report built from it are deleted within 7 days, and we email you when that is done." `e2e/subject-withdrawal.spec.ts` completes a withdrawal end to end with no involvement from the account holder. (The legal section of this specification owns the lawful basis; this section owns the surface, the copy and the test.)

#### 8.3 My genome — Ancestry and Neanderthal DNA

`AncestryMap` and `RegionList` are two views of one dataset, and the list is authoritative. Selecting a region on the map selects the corresponding `RegionList` row and vice versa, with `aria-selected` on the selected row. **No information exists on the map that is not in the list.** `RegionList` names, for every region the map shades: the region name, its percentage to one decimal place, its range, and its parent continent, in descending order of percentage; and it states the same conclusion sentence the map's `<figcaption>` states. That is the cash value of "the list carries everything" — a bare list does not satisfy it.

Two region levels. Where sub-continental resolution is unavailable, `low-resolution` renders exactly: "Your file points to <continent>, but not to a smaller area within it. That usually means we don’t have enough reference data for your ancestry yet." `unsupported-region` renders: "We don’t have reference data for this part of the world yet, so we can’t place your ancestry more precisely."

`NeanderthalCard` follows §7.1: eyebrow "Neanderthal DNA"; figure as a percentage with unit "of your DNA"; mandatory comparison "Most people with ancestry outside Africa carry between 1 and 4 in 100"; and the limit line "This number does not affect your health and no trait has been reliably linked to it."

#### 8.4 Family — heritability and Portrait

**Inherit renders no personal heritability number.** Heritability is a population variance statistic; rendering it through `RiskFigure` manufactures a personal number where none exists. The Family domain's first box shows, per condition, the user's own absolute-risk figure through the §7.1 anatomy, plus a separate `small` line, clearly detached from the figure: "About N in 100 of the differences between people in this trait are explained by DNA. That is about people in general, not about you."

**Portrait** is the highest-risk surface in the product and is bounded by an allow-list, not by wording rules.

- **Permitted characteristic classes, and no others:** recessive carrier overlap for named single-gene conditions, and simple well-characterised physical traits (eye colour, hair colour, ear-wax type, lactase persistence, bitter-taste perception).
- **Denied, enforced by a fixture test that fails the build if any denied trait key appears in the Portrait config:** cognitive ability, educational attainment, height, BMI, personality, any mental-health condition, appearance ranking, sex, longevity, athletic ability.
- **Output form, per trait, exactly:** "Out of 100 children with your two files, about N would have X." Every trait expands to the **range** of outcomes with the likelihood of each. Never a single predicted value. **Never an image of a face.**
- **Header sentence, exact:** "This shows what a child could inherit from the two files you have added. It is not a picture of any particular child." Where only one genome is present, `PortraitTrait` renders `both-genomes-required` with: "Add a second genome to see what a child could inherit from these two files." The phrasing never says "the two of you" — Inherit has not established a relationship between the two files, and donor and single-parent cases are lawful uploads.
- **Layout.** Phone: a vertical list of traits, one per row, each expanding in place. Desktop (≥1024px): two columns of the same rows, same expansion behaviour, no other difference. `PortraitTrait` states: default, not-covered, both-genomes-required.

#### 8.5 Embryos — comparison without ranking

The comparison table is **not** a horizontal table below 1024px. Below 1024px, and at any width when the "One condition at a time" toggle is on (state persisted per user), the condition-first pattern renders:

1. A fixed header strip of embryo identifiers as neutral chips, horizontally scrollable, with a "Pin two to compare" control. Pinning exactly two switches to A/B mode.
2. A vertical list of conditions, one `Surface` each, sorted by the spread between the highest and lowest embryo, largest first, **with the sort criterion named on screen and each condition's spread stated in the page denominator in its header**: "Biggest difference between your embryos: about 3 in 1,000". Sorting by spread without stating magnitude manufactures the impression of a consequential difference through layout; the stated magnitude is what prevents it.
3. Conditions whose spread is below **1 in 1,000** collapse under a single `Disclosure` labelled exactly "Conditions where your embryos are about the same", closed by default. `gate:design` asserts this grouping exists whenever any displayed condition falls below the threshold.
4. Tapping a condition expands a per-embryo list: identifier, natural-frequency estimate, `RangeBar`, coverage glyph and word. Rows are ordered by estimate; **no rank numbers, no rank colour, no badges** (§3.4).
5. **A permanent banner on every embryo comparison surface at every width**, never dismissible, never conditional on how many conditions one embryo leads: line one, "The embryo with the lowest estimate for one condition often does not have the lowest estimate for another."; line two, the actual counts in words, computed **always over the full condition set and never over a filtered subset**: "Embryo B has the lowest estimate on 7 of 12 conditions and the highest on 3." A banner that disappears when one embryo leads on most conditions withdraws the counter-message exactly when it is most needed; this one does not.
6. A permanent footer line: "These are estimates about groups of people. No child has ever been followed from this kind of comparison to a health outcome."

At **1024px and above** the grid form is permitted: `role="grid"`, sticky first column, at most 8 embryo columns visible with horizontal scroll and a scroll-shadow affordance, row heights ≥ `--size-row` (56px). The 768–1023px band uses the condition-first pattern.

#### 8.6 Copilot

Copilot appears as the third entry in each of the three domains, and at `/copilot`. On a phone it is reached from within each domain surface, not from the global bar.

- **`refused` state**, exact copy: "I can’t tell you what to take or what to do about this. I can explain what your file says and what it doesn’t. For advice about your health, speak to a doctor or a genetic counsellor."
- **Subject scope.** Copilot answers only about the subject named in the thread header. A cross-subject question is refused with: "This thread is about <subject>. Start a new thread to ask about a different file."
- **Numbers.** Any number Copilot emits renders through `Figure` with its comparison and unit, or is written as a natural frequency in prose on the thread's denominator. A bare percentage in generated text is a defect.
- **Composer** pinned above the nav bar, ≥ 44px input, 44×44 send target. Streaming must not shift scroll position when the user has scrolled up. Cloud-model consent state appears as a persistent chip in the thread header, not only in settings.
- `e2e/copilot-refusal.spec.ts` covers supplement, dosage, diet, "which embryo should we pick" and cross-subject prompts.

---

### 9. Interaction and motion

- **Durations.** Micro-feedback 120ms; element enter/exit 200ms; overlays 260ms. Easing `cubic-bezier(0.2, 0, 0, 1)`. **No transition or entrance animation exceeds 400ms.** Looping progress indicators are exempt from that limit, but no indeterminate indicator may remain on screen for more than 2 seconds before being replaced by a determinate or step-based state. Exactly one indeterminate spinner exists in the codebase.
- **Skeletons.** Permitted only where the final layout is known, matching its box dimensions within 4px. Otherwise `JobProgress`.
- **`JobProgress`** takes a named step list per job kind, between three and five steps: genome ingest — "Checking the file", "Reading your DNA spots", "Matching to the current map", "Building your reports", "Done"; embryo ingest — "Checking the file", "Reading the embryo’s DNA spots", "Matching to the current map", "Comparing your embryos", "Done"; export — "Gathering your files", "Packing them up", "Ready to download"; deletion — "Removing your files", "Removing your reports", "Checking nothing is left", "Done". Each shows the current step, per-step elapsed time, and a stated range for the whole job ("usually 2 to 10 minutes"). **Progress bars reflect measured work only; a bar advancing on a timer is banned** (named anti-pattern: **fake progress**). The panel states "You can close this page — we’ll keep working" and offers an email notification defaulting to off. After 90 seconds with no state change it switches to `stalled` and names what is waiting.
- **Optimistic updates** are permitted only for reversible, local, inconsequential toggles (theme, a collapsed section, a filter). Forbidden for consent, deletion, upload, sharing and result reveal.
- **Reduced motion.** Under `prefers-reduced-motion: reduce`: no transform or layout transitions; opacity transitions capped at 100ms; the ancestry map does not pan or zoom automatically; no autoplay; no count-up in either mode.
- **Focus.** On client-side route change focus moves to the page `h1` (`tabIndex={-1}`) and the route name is announced in a polite live region. Dialogs trap focus and restore it to the trigger. The existing skip-link contract (first tabbable, moves focus to `main#main`, no hash, no history entry) is preserved and tested.
- **Keyboard.** Every action reachable without a pointer; `Escape` closes any overlay. **Grid form (≥1024px only):** `role="grid"`, arrow keys, `Home`/`End` for row ends, `PageUp`/`PageDown` by ten rows. **Condition-first pattern (all widths):** a roving tab stop across the pinned embryo chips; `Enter` or `Space` expands a condition; arrow keys move within an expanded list; `Escape` collapses. The genome browser exposes a keyboard-operable alternative to every drag interaction.
- **Touch.** Minimum target 44×44 CSS px with ≥ 8px separation. No hover-only affordance anywhere; every tooltip has a tap and focus equivalent.

---

### 10. Accessibility

**Level: WCAG 2.2 AA in full**, plus one AAA item Inherit genuinely meets: **2.4.9, link purpose from link text alone**. Two claims previously made are dropped as untrue rather than defended: 1.4.6 (secondary ink is 6.80:1, not 7:1, and §3.3 explains why it is not darkened) and 2.2.6 (the Undo toast is a timed element). What Inherit states instead: "Inherit imposes no time limit on completing any task. The only timed element is the Undo toast; it persists for 20 seconds, pauses on hover and on focus, and every action it covers stays undoable from the object’s own surface afterwards."

**Automated gate.** `e2e/a11y.spec.ts` runs axe with tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, `best-practice` across the ten `PRIMARY_ROUTES` plus `/`, `/about`, `/providers`, `/privacy`, `/terms`, `/legal/gina`, `/auth/sign-in`, `/uploads`, `/settings`, `/reports/[a not-covered slug]` — each in light and dark at **320×568, 390×844 and 1280×800**. Zero violations. Additionally: every route under reduced-motion emulation, and every gated result in both gated and revealed states.

**Support floor is 320px**, added to the breakpoint list (320, 360, 390, 768, 1024, 1280, 1536) so 400% zoom at 1280px is an exercised width rather than an untested one. At 320px, exactly one element may scroll horizontally: the embryo chip strip. Everything else reflows.

**Manual checklist** (`docs/a11y-manual.md`, signed off per release):

1. Screen-reader pass (NVDA + Firefox, VoiceOver + Safari) of the three domain journeys end to end.
2. Every chart's `<table>` fallback conveys the same conclusion as the chart.
3. Every meaning survives greyscale reading.
4. 400% browser zoom at 1280px width: no horizontal scrolling of the page body except the named element above.
5. Forced-colors mode: borders and focus rings remain visible.
6. Text-spacing override (line-height 1.5, letter-spacing 0.12em, word-spacing 0.16em, paragraph 2em): no loss of content.
7. Keyboard-only completion of: upload, reveal a Tier-2 result, grant and revoke a consent, compare embryos, delete a file, withdraw permission as a subject.
8. Form errors are announced, associated with their field, and stated in words not colour.

**Cognitive accessibility** — the checklist that decides whether an average person can use Inherit:

9. Every screen has exactly one primary action (§6.5), and a tester can name it in five seconds.
10. Every report opens with slot 2 of §7.1 before any number.
11. No step requires remembering information from a previous step.
12. Every jargon term is reachable in one interaction from where it appears.
13. No irreversible action without a specific confirmation; everything else undoable for ≥ 20 seconds and from the object's own surface thereafter.
14. No flow exceeds 5 steps; each step states "Step N of M" and what is still to come.
15. Consent copy (`src/copy/consent/**`) meets FK ≤ 8.0, and every consent dialog states in one sentence what happens if the user says no.

---

### 11. Mobile

Supported from **320px**. Primary phone target 390×844.

**Navigation.** Below 768px, a bottom bar of exactly five items, icon plus always-visible label, `--size-navbar` (64px) tall, 44px targets: "Overview", "My genome", "Family", "Embryos", "Account". No hamburger, no icon-only navigation. Current route indicated by `--tint` ground **and** label weight, and carries `aria-current="page"`. **Each bar label is character-identical to the destination page's `h1`** (§0.1), asserted by `gate:design`; a nav word that does not match its destination heading is the commonest wayfinding failure for low-confidence readers. The domain's fuller name ("Embryo analysis") appears as the one-line description inside the Overview box, not in the bar.

`/reports`, `/ancestry` and `/copilot` are reached from the three entry boxes inside `/genome`; `/uploads` from the "Add a file" `Action` on `/genome` and `/embryos`; `/family/portrait` and `/embryos/compare` from their domain surfaces; `/settings` from "Account". Every route in the axe matrix has a stated phone path.

**`/overview` (phone).** One column: h1, then three domain sections, each an `h2` and three `Surface` entry boxes carrying a name and a one-line description. Nine boxes total. Nothing else above the fold.

**`/genome` (phone).** Single column: a plain-language state line, at most four `Metric` tiles in a 2×2 grid, then three `Surface` entries (Reports, Ancestry, Copilot). The reports list is single-column with the coverage glyph and word on each row; filters behind one `Disclosure` labelled "Filter reports". The ancestry map fills the viewport width at a 4:5 ratio and is pinch-zoomable; `RegionList` sits below it and is the primary representation on phones — the map may be collapsed, the list may not.

**`/family` (phone).** Three entries: heritability results, Portrait, Copilot. Results reuse the §7.1 anatomy at full width, one per screenful, with the figure no larger than 44px so figure and comparison sit above the fold at 390×844.

**`/embryos` (phone).** The condition-first pattern of §8.5, always.

---

### 12. Acceptance

#### 12A. Automated gates that block the build

All run in CI with no human. All must pass.

1. `gate:design` — spacing and size scales, radii, shadows, measure (68ch cap everywhere; 45ch floor at ≥640px only), page widths from `PRIMARY_ROUTES`, heading rules, Fraunces allow-list, figure-slot completeness, nav-label/h1 identity, one-primary-action rule, ≤ 220 lines per component file, ≤ 18 files in `src/components/ui/`. Zero violations.
2. `gate:density` — ink coverage ≤ 38% / ≤ 55%, characters ≤ 480 / ≤ 700, focusables ≤ 18 / ≤ 14 / ≤ 20, on `PRIMARY_ROUTES` at 390 and 1280, light theme, DPR 1, seeded fixture, authenticated. Zero violations.
3. `gate:tokens` — the full contrast matrix for both themes against `docs/contrast-matrix.md`; zero hard-coded hex or `rgb()` outside `globals.css`; every `[data-meaning]` element carries a glyph and the exact word.
4. `e2e/colour-redundancy.spec.ts` — greyscale plus three colour-vision simulations across `PRIMARY_ROUTES`; plus the embryo-route assertion of §3.4.
5. `gate:language` — FK thresholds per corpus path (app 8.0, reports/glossary 9.0, consent 8.0, legal 11.0, evidence 9.0); ≤ 5% four-syllable words; mean sentence ≤ 17 words; no sentence over 28 (34 legal); zero blocklist hits; zero user-visible literals in `.tsx` outside the token allow-list; every lexicon term either absent or inside a `GlossaryTerm`.
6. `gate:legal` — extended from legal pages to every route in `PRIMARY_ROUTES` and every legal and marketing route, for placeholder tokens, "TBD", "N/A", "Coming soon" and empty brackets.
7. `e2e/a11y.spec.ts` — axe zero violations across the route matrix of §10 × 2 themes × 3 viewports, plus reduced-motion and gated/revealed states.
8. **Lighthouse** (`scripts/lighthouse-check.ts`) — add `"best-practices"` to `onlyCategories` (it is not measured today; there is no existing threshold to raise). Set accessibility and best-practices thresholds to **95** and hold performance at **90**. Add `/overview`, `/reports` and `/embryos/compare`, run with a seeded session cookie via the existing `SEQ_LH_COOKIE` env var. Three runs per route, median reported. **CLS ≤ 0.02 and LCP ≤ 2.0s on simulated Slow 4G**, with a stated budget that makes it reachable: ≤ 180KB of JavaScript and ≤ 250KB of images above the fold on every route in `PRIMARY_ROUTES`; the ancestry map's initial paint is a static outline under 40KB and tiles load after LCP. `/browse` is exempt from LCP and JavaScript budgets by name, because it mounts the genome browser; it keeps the CLS budget.
9. `e2e/states.spec.ts` — for each component in §4.2, render every declared state and assert non-empty, non-placeholder accessible text.
10. `e2e/no-lone-number.spec.ts` — crawl `PRIMARY_ROUTES` with the seeded fixture genome; assert every element with computed `font-size` ≥ 32px whose text matches `/\d/` sits inside `[data-slot="figure"]` with both a comparison and a unit sibling.
11. `e2e/uncertainty.spec.ts` — every `RiskFigure` in `default` contains a `RangeBar` or the exact no-range string.
12. `e2e/upload-classes.spec.ts`, `e2e/subject-withdrawal.spec.ts`, `e2e/copilot-refusal.spec.ts`, `e2e/embryo-compare.spec.ts` (banner always present; no rank ordinal anywhere in the DOM; exactly one Tier-2 gate per session) — as specified in §8.
13. **Comprehension proxies** standing in for the human studies below: assert that every result surface contains the slot-2 sentence before any `figure`-size element; that no embryo surface exposes a rank ordinal; that every `figure` on a page shares one denominator; and that every chart has a `<figcaption>` naming the quantity, unit and "people like you".
14. Existing gates unchanged and still passing: the RLS attack test, the CI network audit (zero third-party requests), one-click export, verified deletion.

#### 12B. Human validation — before public launch, not before a build

These require recruiting participants and cannot be executed by an engineering system. **They do not block CI.** They are run by whoever owns the public launch, recorded in `docs/ux-research/`, and a surface they cover ships behind a feature flag until its study is recorded. Where a study cannot be run, the automated proxies in 12A.13 and the density budgets of §1.5 stand in, and `docs/ux-research/` records that substitution explicitly.

15. **Five-second test.** For `/overview`, `/genome`, `/family`, `/embryos`, `/reports/[slug]`: show a screenshot for 5 seconds to ≥ 12 participants with no genomics background. ≥ 75% correctly state the page's purpose; ≥ 75% correctly name its primary action.
16. **Unmoderated task success**, n ≥ 12 per task, no genomics background, on a phone: upload a raw data file (≥ 90%, median ≤ 120s); find one named report and say whether their file covers it (≥ 85%, ≤ 90s); from one risk figure, say whether the result means they will get the condition (correct answer "no" ≥ 90%); read one risk figure aloud and name the group they are compared with (≥ 80%); grant and then revoke permission for a cloud model (≥ 90%); say which of four embryos is lowest risk for one named condition, then whether one embryo is best overall (≥ 85%; correct answer "no" ≥ 80%); delete one uploaded file and state what was deleted with it (≥ 90%).
17. **Comprehension of relative framing.** Shown a report containing a relative figure, ≥ 80% correctly identify the absolute difference **on the denominator that surface uses**.

---

### 13. Naming discipline

No competitor's company name, founder name, product name, domain or model-family name appears anywhere in the Inherit repository — UI, docs, code comments, commit messages, tests or fixtures included. Every rule in this section is written as a first-order property of Inherit; where a failure mode is named, it is named generically as an anti-pattern (**winner encoding**, **relative-only headline**, **spread-as-average**, **unlabelled comparator**, **point estimate without a range**, **fake progress**, **retention disclosed only at the exit**). `gate:language` carries a blocklist of those names in `src/copy/banned.ts` and fails the build on any occurrence.

---

## 4. Scientific accuracy and claims discipline

This section is the standard every number, chart, sentence, label and report in Inherit must meet. It binds all three product domains (My Genome, Family, Embryo Analysis), all Copilot output, all marketing pages, all export artefacts, all emails, and every person whose genome contributes to a result — not only the account holder. Where this section conflicts with another section on **what a surface may say**, this section wins. Where it conflicts on **how a surface looks**, redesign the surface so both hold.

Where a caveat and simplicity genuinely cannot both fit, **remove the feature, not the caveat**. A page that cannot be made honest and simple at once is not shipped. That rule is applied twice below, explicitly: Portrait's appearance list is cut to five Mendelian traits, and the embryo comparator table is collapsed to one headline comparator with three behind a disclosure.

**Rule 0 (traceability).** Every number Inherit displays resolves to exactly one of four recorded sources: **(a)** a named computation over a subject's own file; **(b)** a registered claim resolving to a citation with an identifier type, an identifier and an access date; **(c)** a value reported by a named source laboratory, rendered with that laboratory named, never used inside a computed risk figure without its provenance shown in the same container; **(d)** a computation Inherit publishes itself, with inputs, method and code, labelled on the surface **"Inherit's own modelling"** and citing sources for its inputs only. There is no fifth source.

**Rule 1 (worse to mislead than to complicate).** If a simplification would change what a reasonable lay reader believes about direction, magnitude, certainty or applicability, it is rejected. Simplify by removing content, never by removing qualification from retained content.

**Anti-patterns** below are real behaviours of widely-sold competing products, restated as things Inherit must not do. Their names are normative: used verbatim in code comments, test names and review checklists. No competitor, product, person or domain is ever named anywhere in this repository, its UI, docs, comments, commit messages, tests or fixtures, and no competitor string is ever quoted.

**Readability gate (applies to every string in this section).** Every default-visible string in `src/`, `data/templates/`, `data/claims/` and every `report_templates` text column must score at or below US grade 9 on Flesch–Kincaid, contain no sentence over 25 words, and use no term outside `data/science/plain-vocabulary.json` without an inline definition on first use in that view. Enforced by `pnpm gate:science` over extracted strings.

---

#### 1. The two layers

**1.1 Definition.** Every phenotype-bearing artefact belongs to exactly one layer, recorded as data, never as a rendering choice.

- **`variant_call`** — a call on specific variants classified against an external professional framework (ACMG/AMP interpretation; ClinVar assertions with review status). Carrier status, high-penetrance P/LP findings, pharmacogenomic star alleles, Mendelian traits.
- **`estimate`** — any modelled statistical association. Two kinds, recorded in `estimate_kind`: `single_locus` (one variant, an association effect size, no clinical classification) and `polygenic_score` (weighted alleles summed across many loci).

The draft this replaces had a `monogenic`/`polygenic` binary. That binary is wrong against this repository: all 151 seeded templates in `data/templates/` are single-variant GWAS association reports with `pgs_id` null and populated `variants` — neither clinically classified nor polygenic scores. They are `estimate` / `single_locus`. Naming the layer "monogenic" would have mislabelled every shipped report.

**1.2 Data model and migration.** Add `layer public.finding_layer not null` (enum `('variant_call','estimate')`) and `estimate_kind text` to `public.report_templates` (`slug text primary key`, existing `variants jsonb not null default '[]'::jsonb`, `pgs_id text`, `citations jsonb`). Constraints: `check (layer <> 'estimate' or estimate_kind in ('single_locus','polygenic_score'))`; `check (layer <> 'variant_call' or (pgs_id is null and variants <> '[]'::jsonb))`; `check (estimate_kind <> 'polygenic_score' or pgs_id is not null)`. A condition needing both layers ships as two templates joined by `public.condition_registry` (`condition_slug text primary key`, `label text not null`, `variant_call_template_slugs text[]`, `estimate_template_slug text`, `gene_symbols text[]`, `penetrance_class text not null check (penetrance_class in ('high','moderate','low','unestablished'))`, `penetrance_citation_id text not null`).

Backfill, run in one migration and mirrored in `scripts/validate-templates.ts`: `layer = 'estimate'`, `estimate_kind = case when pgs_id is not null then 'polygenic_score' else 'single_locus' end`.

`public.evidence_level` today is `enum ('established','moderate','preliminary')` over 40/79/32 rows. Replace with the five levels of §7. Deterministic mapping, no silent upgrades: `established → emerging`, `moderate → emerging`, `preliminary → preliminary`. `clinical` and `established` are reachable only by review under §7.2. Each of the 119 relabels writes a `changelog_entries` row naming the old level, the new level and the reason "re-mapped to the new evidence rubric; not a change of finding". A relabel of this size is published deliberately, never as a silent change.

**Compliance window.** Existing published templates are exempt from §7.2's two-reviewer rule for **180 days** from the migration commit, recorded as `report_templates.compliance_exempt_until date`. After that date `gate:science` fails on any published template without its reviews, and no exemption may be extended. Every one of the 151 existing summaries and `variants[].interpretations` strings must be rewritten to §2 law inside that window or moved to `status='review'` — most currently carry naked relative figures (odds ratios with no absolute risk), which §2.4 forbids.

**1.3 Separation in the UI.** `variant_call` and `estimate` results never share a card, list, chart, table row or sentence. `/reports` splits into two labelled groups, in this order, each with its one-line definition rendered above the group and **repeated verbatim wherever the layer name is used as a filter chip, count badge or tile**:

- **"Specific variants"** — "A result about one or a few exact spots in your DNA, read against an outside clinical classification."
- **"Statistical estimates"** — "A model that adds up small effects. It is an estimate, not a reading. Scientists call these polygenic scores."

The groups use distinct card treatments (`estimate` on `--tint`; `variant_call` on `--paper` with a `--line` border). No filter, sort, search result, badge, tile, export section or Copilot answer may present a mixed set without visible partition by layer. **The sole exception is the suppression notice of §1.5**, which names a variant finding in order to explain the absence of an estimate and displays no estimated quantity.

**1.4 No merged count. `ANTI-PATTERN: the merged condition count.`** Inherit never advertises a single count of "conditions", "reports", "insights", "screenings", "analyses" or "estimates" spanning both layers. A widely-sold competing product advertises several mutually inconsistent condition counts across its purchase path — including an unrendered template placeholder — of which roughly 98% is single-gene panel content and under 2% is the statistical-estimate content its headline copy implies; the split is published, but only off the purchase path. Inherit states the split everywhere the quantity appears, exactly:

> "{M} specific-variant reports · {P} statistical estimates"

`M` and `P` are computed at build time from `report_templates where status = 'published'`, never hard-coded, always adjacent, always the same type size, never summed in copy. Where either is 0 only the non-zero half renders. At migration this reads "151 statistical estimates" and says nothing else, because M is 0 — an accurate statement of the current library.

`scripts/claims-gate.ts` fails on any match of `/\b\d{2,}[\d,]*\+?\s+(?!specific-variant\b|statistical\b)(conditions?|reports?|insights?|screenings?|analyses|traits?|estimates?)\b/i` across `src/`, `data/`, `docs/`, `public/`, the built HTML, and the text columns of `report_templates`. Two checked-in fixtures: `data/gates/fixtures/split-string-passes.txt` containing "412 specific-variant reports · 35 statistical estimates" (must pass) and `split-string-fails.txt` containing "2,000+ conditions" (must fail).

Allow-list at `data/gates/merged-count-allowlist.json`, typed `{file_path, matched_string, split_m, split_p, approver_id, approved_on, expires_on}`. Maximum **10** entries; `expires_on` at most 180 days after `approved_on`; the gate fails on an expired entry, an eleventh entry, or an entry whose `approver_id` is absent from `template_reviews`. The list renders on `/science#evidence`.

**1.5 Suppression of estimates by high-penetrance variant calls.** Suppression is defined **per subject**, not per account. Where a P/LP variant (ClinVar review status ≥2 stars with no conflicting interpretation, or an internal ACMG/AMP P/LP classification in `ref_variants`) is found in a gene registered in `condition_registry` with `penetrance_class = 'high'`, Inherit must not display the polygenic estimate for that condition **for that subject** — account holder, adult contributor or embryo alike.

Storage: `public.suppressions (id uuid primary key default gen_random_uuid(), subject_id uuid not null references public.subjects(id) on delete cascade, condition_slug text not null references public.condition_registry(condition_slug), reason_claim_id text not null, suppressing_variant_source text not null check (suppressing_variant_source in ('user_variants','embryo_variants')), suppressing_variant_id bigint not null, suppressing_rsid bigint, suppressing_gene_symbol text not null, created_at timestamptz not null default now(), unique (subject_id, condition_slug))`. `suppressing_variant_id` is `bigint` because `public.user_variants.id` is `bigint generated always as identity`; the reference is polymorphic across two tables and therefore carries no FK, which is why the source column is required. RLS enabled, owner-scoped select/insert/delete against `subjects.owner_user_id`, matching `public.user_prs`.

Rendered in place of the score:

> "We are not showing a statistical estimate for {condition}. {Subject label}'s file carries a specific variant in {gene} with a much larger known effect. Adding a small statistical estimate on top of a large known effect would make the number less accurate, not more. The {gene} result is here: {link}."

The second half of that copy is a scientific claim and is registered as one (`reason_claim_id`, Rule 0(b)), with its citation.

**Moderate penetrance is different, and Inherit says so.** Where `penetrance_class = 'moderate'`, blanket suppression would mislead in the opposite direction: published integrated carrier-plus-score models exist and materially modify carrier risk. For moderate pairs Inherit displays the estimate **against a carrier-specific baseline** where a published integrated model is registered in `risk_models`, and otherwise renders the no-baseline state of §2.7. It never asserts the suppression rationale for a moderate pair. Where `penetrance_class` is `'low'` or `'unestablished'`, no suppression occurs.

Suppression is per condition, never global, disclosed on `/science#polygenic` and in the export.

---

#### 2. Presentation law for estimates

Each rule is enforced by a component contract, an ESLint rule and an end-to-end test.

**2.1 Absolute risk first.** Any surface stating a risk states absolute risk first, in the first sentence, in a type size no smaller than any other number on that surface. Rounding is by significant figures, not fixed decimals: below 1%, two significant figures ("0.043%"); 1% to 9.9%, one decimal; 10% and above, whole percent.

**2.2 A matched baseline beside it.** Every absolute risk is displayed adjacent to a baseline for a matched group, with the matching variables named inline, drawn from new table `public.risk_models` (`model_id text primary key`, `condition_slug text not null`, `pgs_id text references public.prs_scores(pgs_id)`, `sex text`, `age_band text`, `ancestry_group text`, `covariate_strata jsonb`, `baseline_absolute_risk numeric not null`, `baseline_ci_low numeric not null`, `baseline_ci_high numeric not null`, `baseline_source jsonb not null`, `prevalence_basis text not null check (prevalence_basis in ('lifetime_risk','period_prevalence','point_prevalence','age_conditional_risk'))`, `liability_r2 numeric not null`, `liability_r2_ci_low numeric not null`, `liability_r2_ci_high numeric not null`, `calibration_cohort text not null`, `calibration_n integer not null check (calibration_n > 0)`, `citation_ids text[] not null`). RLS enabled with public read (reference data, no user rows). `gate:science` refuses to seed a row with a null baseline, a null cohort or a zero `n`.

`prevalence_basis` is displayed, not merely stored, because a competing product publishes different quantities under one label. The four plain-language renderings are fixed; `gate:science` fails on any other rendering:

| Enum | Rendered string |
|---|---|
| `lifetime_risk` | "the share of people who get this in their whole life" |
| `point_prevalence` | "the share of people who have this right now" |
| `period_prevalence` | "the share of people who had this at any time during {period}" |
| `age_conditional_risk` | "the share of people who get this between {age_from} and {age_to}" |

Baseline sentence: *"For {matched variables}, it is about {baseline}%. That figure is {rendering}."*

**Where the matching variables come from.** `sex` and `age_band` are supplied per subject, not per account, at upload, as required fields of the consent record (`subjects.sex_at_birth`, `subjects.birth_year`). The account holder is asked, in these words: "What was recorded as your sex at birth?" and "What year were you born?", with "Prefer not to say" available. For an adult contributor the contributor supplies them in their own consent step. For an embryo, see §5.2. Where a matching variable is absent, no number is shown and the card renders the §2.7 state.

**2.3 Natural frequencies, with a denominator ladder.** Directly beneath the two percentages, in the same card, both quantities render as natural frequencies **using the same denominator in both sentences**. Choose the smallest `D` in {1,000; 10,000; 100,000; 1,000,000} such that both rounded integers are ≥1 **and** they differ by at least 1. If no `D` satisfies both, render only: "Fewer than 1 in a million, both for you and for the comparison group." A fixed denominator of 1,000 would render a 0.04% risk and a 0.02% baseline as "0 in 1,000" each — destroying exactly the difference this rule exists to show.

> "About {n} in {D} people like you. About {b} in {D} people {matched variables}."

"people like you" links to an inline definition listing the matched variables and stating what was **not** matched on. **`ANTI-PATTERN: the dead explainer link.`** A competing product's inline definition of its comparison group links to an explainer page that returns HTTP 404. `scripts/claims-gate.ts` resolves every internal href on every route in the §11 inventory and fails on any 404.

**2.4 Relative figures never alone. `ANTI-PATTERN: the naked relative figure.`** No relative risk, risk ratio, odds ratio, hazard ratio, fold-change or percentage change renders unless the same container also renders (a) the absolute risk, (b) the matched baseline, (c) the absolute difference in percentage points. Enforced by one component `<RelativeFigure>` with props `{relative, absolute, baseline, absoluteDifference, unit}` — all required, none nullable — emitting `data-relative-figure="true"`.

Two checks, because source-only scanning has a hole where the report prose actually lives (`report_templates.summary` and `variants[].interpretations`):
1. ESLint rule `inherit/no-bare-relative-figure` — developer-time signal on JSX and template literals in `src/`.
2. The binding check runs over **built HTML plus rendered email templates plus generated export artefacts**: adjacency is defined as a `%`, `x`, `×` or `-fold` token within **40 characters** of any of "lower", "higher", "reduction", "increase", "less likely", "more likely", "times", inside the same rendered text node. Every such token must have an ancestor carrying `data-relative-figure="true"` containing at least two distinct absolute percentages. `scripts/validate-templates.ts` applies the same check to `report_templates.summary` and `variants[].interpretations` in both seed files and the database.

**2.5 Percentiles.** A percentile renders only when an absolute risk renders in the same card, the reference population is named inline by its construction, and coverage passes §3.3.

> "Your score sits at about the {p}th percentile (range {p_lo}–{p_hi}) of {population_label} in {panel_name}."

`prs_scores.percentile_ref` gains required keys `population_label`, `panel_name`, `panel_citation_id`, `assignment_method` (`'genetically_inferred'` | `'self_reported'`), `n`. Where genetically inferred, the card adds: "This grouping was worked out from your DNA, not from what you told us about your background." A percentile bar never renders as the only quantity in a card, and never larger than the absolute-risk figure.

**Global fallback resolved.** Where the percentile can only be computed against a global fallback panel, **the percentile is not shown either.** The draft this replaces required a percentile with the absolute risk suppressed, which is the exact state §2.5 and §10 both forbid. The card renders the §2.7 no-baseline state plus the coverage and portability chips, and nothing numeric.

**2.6 Intervals at the point of display. `ANTI-PATTERN: the certainty interface.`** A widely-sold competing product's shipped application contains no confidence interval, margin of error, standard error or "±" anywhere in it; a heritability figure is displayed in their place. Inherit is the opposite. Every estimated quantity carries an interval in the same container:

- **Absolute risk** — a 95% interval combining, in this order, all four variance components: the `liability_r2` confidence interval; the reference-panel sampling error from `percentile_ref.n`; the baseline prevalence interval from `risk_models.baseline_ci_low`/`_ci_high`; and the coverage-adjusted variance term of §3.3. Components are combined on the liability scale by summing variances of the log-scale contributions, then transformed once to the absolute scale; the transform is applied to the bounds, never to a pre-combined summary. Stored as `user_prs.absolute_risk_ci_low`/`_ci_high`. Rendered: *"Your estimated risk is {x}%. It could reasonably be {lo}% to {hi}%."* The phrase is **"could reasonably be"**, not "honest range" — the latter implies other numbers are dishonest and says nothing about what the range covers. The interval's disclosure states, in one sentence, that the range covers model accuracy, panel size, baseline uncertainty and missing variants, and does not cover anything about the subject's life or environment.
- **Percentile** — a band, drawn as a shaded band, never a single tick.
- **Portrait or embryo probability** — an interval, or, where the quantity is exact Mendelian arithmetic, the label "This is exact arithmetic, not an estimate."
- **Any published model-performance figure** — point estimate, 95% CI, and the sample size it came from.

Where an interval cannot be computed, the number is not displayed. There is no "estimate without interval" state.

**Making the marker unavoidable.** Assertions about `data-estimate="true"` are worthless if nothing forces the attribute to exist. Therefore: every numeric quantity derived from `user_prs`, `risk_models`, `prs_scores`, `embryo_qc` or `embryo_figures` renders **only** through `<Estimate>` or `<RelativeFigure>`, which emit the attributes. ESLint rule `inherit/no-raw-model-value` fails on any raw interpolation of a field from those tables outside those components. `data/gates/expected-estimate-counts.json` records, per seeded route, the exact number of estimate nodes that route must emit; `e2e/uncertainty.spec.ts` asserts equality, so omitting an attribute fails rather than passes.

**2.7 The no-baseline state (named, fixed copy).** Where no calibrated model matches the subject — no matched baseline, no ancestry-appropriate evaluation, a global-only percentile, or a missing matching variable — the card renders the evidence label, the citation, a link to `/science#polygenic`, and exactly:

> "We cannot give you a number for {condition}. The models for this condition have only been checked in groups that do not match {subject label}'s background, so any number we showed would be wrong in a direction we cannot measure."

The report stays listed rather than silently vanishing. `/reports` shows once, above the groups: "{k} of these reports cannot give you a number yet. Why?" `gate:science` asserts that every published `polygenic_score` template renders either a full card or exactly this state for each of a fixed set of seeded ancestry fixtures in `e2e/fixtures/ancestry/`.

**2.8 Charts.** Absolute risk uses a 100-dot icon array (10 × 10), user's dots in `--forest`, baseline overlaid as an outlined count, plus a numeric label; the interval is a lighter band of dots. No chart plots a relative figure as its primary mark. No truncated axis on a risk quantity. No unlabelled 0–100 "score" scale. Every chart carries a text alternative stating the same numbers in the order of §2.1–2.3.

---

#### 3. What travels with every polygenic estimate

**3.0 The default-view budget.** The budget is measured over the **whole default view of a card**, defined by the DOM contract `[data-card-default]`, excluding only the report title and the evidence label. Ceiling: **125 words** and **exactly six labelled quantities** — (1) your risk with its range, (2) the baseline, (3) the natural frequencies, (4) coverage, (5) portability grade, (6) model strength. A seventh quantity in the default view fails the gate.

Order is fixed: risk sentence → baseline sentence → natural frequencies → "This is a modelled estimate, not a measurement." → the §3.6 environment sentence if it applies → the §3.3 coverage sentence if it applies → the chip strip. The §3.4 comparison warning is **not** on a card; it renders above a comparison surface.

The worst case is written out as a checked-in copy fixture at `data/science/worst-case-card.txt`, which `gate:science` word-counts on every run (Poor portability, Not tested, 82% coverage, model strength under 25% — **118 words**):

> Your estimated risk is 12%. It could reasonably be 8% to 17%. For men aged 40 to 49, it is about 9%. That figure is the share of people who get this in their whole life. About 120 in 1,000 people like you. About 90 in 1,000 men aged 40 to 49. This is a modelled estimate, not a measurement. For type 2 diabetes, most of the difference between people is not genetic. Weight, diet, activity and age matter more. Some of this score is missing from your file, so the range above is wider than it would otherwise be. — Coverage 82% · Fits your background Poor · Family test Not tested · Model strength 18% of differences, 14% to 22%

**3.1 The Reliability strip.** Four chips for `polygenic_score`, always in this order, each with a fixed label, a computed value, and a tap target opening a 60–120 word explanation. `single_locus` estimates carry chips 1 and 4 only.

| # | Label | Value | Disclosure |
|---|---|---|---|
| 1 | "Coverage" | `{x}%` | Which fraction of the score's variants your file contains, the raw counts, what missing variants do to the range. |
| 2 | "Fits your background" | `Good` / `Partial` / `Poor` | Portability, §3.2. |
| 3 | "Family test" | `Passed` / `Reduced` / `Not conclusive` / `Not tested` | Within-family attenuation, §3.4. |
| 4 | "Model strength" | `{r2}% of differences, {lo}% to {hi}%` | Opens with the fixed sentence: **"This is not your chance of getting this condition."** Then what fraction of variation the model accounts for, and what the rest is. |

**Single source of truth for chip 4:** the `liability_r2` of the `risk_models` row actually used to compute this subject's absolute risk. `prs_scores.ancestry_performance` is evaluation metadata used only for chip 2 and is never rendered as chip 4. §3.6's threshold reads the same column: `risk_models.liability_r2 < 0.25`.

**3.2 Portability, measured not asserted.** `prs_scores` gains `ancestry_performance jsonb` — an array of `{ancestry_group, liability_r2, ci_low, ci_high, n, citation_id}` — and `training_ancestry_composition jsonb`. **`liability_r2` is the sole basis for chip 2. Odds-ratio-per-standard-deviation figures may never be converted into it.** Retention is the user's group's `liability_r2` as a fraction of the best-performing group's: `Good` ≥80%, `Partial` 40–79%, `Poor` below 40% **or where no liability-R² evaluation exists for that group**. Where Poor for absence of evidence, the disclosure says exactly: "No one has measured how well this score works for people with your genetic background. That is not the same as it working badly — it means it is untested."

**Admixture.** Compute the subject's ancestry component shares. Where the largest component is <50%, or the largest two components' retentions differ by more than 20 percentage points, the chip takes the **worst** applicable retention and the disclosure names both components and both retentions. Where no component reaches 20%, the chip is `Poor` with the untested wording. The same rule fixes `risk_models.ancestry_group` selection and the §2.5 percentile panel: both resolve to the worst-retention component, and where that yields no calibrated model, §2.7 applies.

The disclosure states, in one sentence, that this chip is an approximation: **"Backgrounds are not boxes. How well a score travels changes smoothly with genetic distance from the people it was built on; this label is a rough summary of that."**

`/science#polygenic` publishes the field benchmark with citations, and leads with the **least favourable** convention: across a standardised 28-disease evaluation, performance relative to European-ancestry participants attenuates by 19.1% (South Asian), 25.5% (East Asian) and 59.9% (African) on the log-odds convention, and by 9.4%, 14.0% and 27.5% on odds-ratio-per-standard-deviation. Inherit states that at least three natural averaging conventions exist on the same data, that the odds-ratio-per-standard-deviation set is the most favourable of them, and that the choice of convention changes the number.

**`ANTI-PATTERN: the off-path portability disclosure.`** A widely-sold competing product discloses its European-ancestry restriction only in a caption beneath a calculator and in a deep-dive explainer, while the word "ancestry" appears nowhere in the visible text of its checkout page, product pages, terms or FAQ. Inherit's chip 2 appears on every surface showing a score, including `/demo` and the marketing description; `e2e/risk-presentation.spec.ts` asserts it on `/demo`.

**3.3 Coverage.** `user_prs.coverage` is displayed as a percentage to one decimal with the raw counts. Never a pass/fail badge, never behind a disclosure. Thresholds enforced server-side:

- `≥ 0.95` — full display.
- `0.80 ≤ coverage < 0.95` — full display, interval widened by the coverage-adjusted variance term, chip 1 in warning treatment, plus the fixed sentence in §3.0's order.
- `< 0.80` — **no percentile, no absolute risk, no z-score, no chart.** Card shows only: "Too little of this score is in your file to give you a number. {matched} of {n_variants} variants were found ({coverage}%). A whole-genome or whole-exome file usually covers more of this score. Another array-based file may not."

The last two sentences replace an unqualified promise that a different test would fix it — often untrue, and the one place the surface would push a user toward buying another product.

**3.4 Within-family attenuation.** `prs_scores` gains `within_family_status text not null check (within_family_status in ('measured_no_attenuation','measured_attenuated','measured_inconclusive','not_measured'))`, `within_family_beta_ratio numeric`, `within_family_ci_low numeric`, `within_family_ci_high numeric`, `within_family_n_families integer`, `within_family_citation_id text`.

**`ANTI-PATTERN: measured equality by non-significance.`** A widely-sold competing product publishes a validation table printing a within-family accuracy figure numerically identical to its population figure for 29 of 35 phenotypes, with no confidence intervals, no sample sizes and no methods note, while its own preprint reports point estimates running 0.827 to 1.026, every one with an interval and none equal to 1.000. That the identical columns were produced by substituting the population figure wherever a test was non-significant is an inference, not an admitted practice, and Inherit's page states it only as an inference or not at all.

Inherit must never set a within-family value equal to a population value on a non-significant test. Where the interval includes 1.0, status is `measured_inconclusive`, chip 3 reads `Not conclusive`, and the disclosure states the largest attenuation the interval still permits. Where `not_measured`, chip 3 reads `Not tested` and the disclosure says: "Nobody has tested this score by comparing brothers and sisters. Scores for traits like this have shown the biggest drop when that test is run."

`/science#polygenic` publishes, with citations: within-sibship shrinkage of 47% for educational attainment, 22% for cognitive ability, 19% for ever-smoking and 10% for height in the largest within-sibship study (178,086 siblings, 19 cohorts), with limited evidence of within-sibship differences for the remaining 17 phenotypes; within-family prediction 48.0% lower for measured cognitive ability but 11.8% lower for height and 15.1% for BMI (neither significant) in an independent study; non-transmitted parental alleles carrying 29.9% of the transmitted score's effect for educational attainment. It states plainly that attenuation is trait-dependent, largest in the cognitive and educational domain, smallest in biomedical traits. Separately cited, it states the power ceiling: the sibling resource inside the single biobank most scores are validated in is roughly 22,000 pairs, some 19,000 of one ancestry, and the literature records that this is too few for adequate power on most phenotypes — so "not tested" is often a property of the data that exists rather than of any one provider.

Above **any** comparison between relatives or between embryos using a score whose status is `not_measured`, this exact string renders: **"This comparison is between people who share most of their DNA. This score has never been tested that way, so the difference below may be smaller than it looks — possibly much smaller."**

**3.5 Modelled, not measured.** Every estimate card carries in its default view: **"This is a modelled estimate, not a measurement."** No synonym, no variation.

**3.6 Environment.** `risk_models` gains `environment_note_citation_id text`. Where `risk_models.liability_r2 < 0.25`, the default view renders: "For {condition}, most of the difference between people is not genetic. {dominant modifiable factors, ≤12 words}." The factor list is seeded and cited, never generated at render time, never generated by a language model, never phrased as advice. Copilot may restate it; Copilot may not extend it.

---

#### 4. Monogenic presentation law

`variant_call` results are the highest-consequence class in the product and had no presentation law in the draft this replaces. Every `variant_call` card carries, in its default view:

1. **Penetrance as a range with an interval and a citation**, or the exact label "Penetrance for this variant has not been established."
2. **The non-finding string**, computed per file, wherever no reportable variant is found: **"This is not a negative result. Your file was checked at {n} of the {N} positions known for {condition}."** Array and imputed inputs genotype a subset of positions; an absent finding is not a negative result and is never rendered as "clear", "normal" or a green tick.
3. **On every P/LP finding**: "Before anyone acts on this, it needs confirming in an accredited laboratory. Consumer files are not a clinical test."
4. **The ClinVar review status and the classification date, as text**, adjacent to the finding.

Acceptance tests seed a carrier fixture and a no-coverage fixture and assert each of the four on both.

**Contributors see their own results.** Any variant call, carrier status or Portrait output derived in whole or in part from a contributor's file must be rendered to that contributor, in the same copy, under the same §2–§4 law, in their own access surface at `/contributors/[subject_id]` (reached by a signed link issued in their consent step), and included in their own export — **before or at the same moment** it is rendered to the account holder. `e2e/portrait-accuracy.spec.ts` seeds a two-contributor Portrait and asserts byte-equivalent finding text in both views.

---

#### 5. Portrait

**5.1 Never one child.** Portrait never renders a single hypothetical child, a face, an avatar, an image, a name, or a single-value trait chip. Every output is a distribution: a probability table or a 100-child icon array — "Out of 100 children this pair could have, about {n} would be expected to {outcome}." Any element screenshottable as "this is our child" is forbidden.

**5.2 Segregation is explicit.** Every output carries: **"Which half of each parent's DNA a child gets is decided at random. Two children of the same parents can differ as much as any two brothers or sisters do."** Portrait renders the spread across possible children, not only the central tendency.

**5.3 What Portrait may compute — three classes, nothing else.**

1. **Recessive and X-linked carrier arithmetic**, from the `variant_call` layer only, as an exact fraction with the derivation shown ("1 in 4 (25%) affected · 2 in 4 (50%) carriers · 1 in 4 (25%) neither"), labelled "This is exact arithmetic, not an estimate.", with the assumptions stated: independent assortment, no new mutation, no imprinting unless the gene is registered as imprinted, and relatedness below the threshold below. **Consanguinity is measured, not hand-waved:** Inherit computes F_ROH from total runs of homozygosity; where total ROH exceeds **100 Mb** or F_ROH exceeds **0.0156**, Portrait refuses the calculation and states: "These two files look more genetically similar than usual. That changes the maths in ways we cannot show you honestly here. Please talk to a genetic counsellor." Where either file does not cover the variant, Portrait says so and never imputes: "We cannot do this calculation. {Subject label}'s file does not cover {rsid}."
2. **Chromosomal sex**, stated as the Mendelian expectation and labelled as such: "Each conception is equally likely to get an X or a Y from the father. That is the expectation from inheritance, not an observed birth ratio."
3. **A closed allow-list of high-effect Mendelian traits** at `data/portrait/allowed_traits.json`, each entry requiring `layer='variant_call'`, evidence `clinical` or `established`, and a published genotype-to-phenotype probability table with a citation id. Launch list, and only these five: **ABO blood type, Rh type, red hair (MC1R), lactase persistence, earwax type.** Eye colour, freckling, cilantro perception and asparagus-odour detection are **removed** from the draft's list: the first two are multi-locus models and therefore `estimate` by Inherit's own §1.1 definition, and the last two are single-SNP associations with no probability table meeting the bar. Rendering splits: exact Mendelian outcomes (ABO, Rh) render as exact fractions with the exactness label; probabilistic genotype-to-phenotype tables (MC1R, lactase, earwax) render as bands with intervals.

**The distinguishing principle**, stated in one sentence on the Portrait surface and on `/science/limits`: **"Portrait describes the range of children a couple could have. Embryo Analysis helps choose between embryos that already exist — so no appearance trait appears there at all."**

**5.4 What Portrait refuses. `ANTI-PATTERN: the doubled spread sold as an average.`** A widely-sold competing product computes the difference between the best and worst outcome in a set, doubles a top-versus-average gain to reproduce that worst-to-best spread, and captions the result as an "average gain" — a worst-to-best spread is not an average gain, and the paper cited beside the figure reports roughly half of it. Inherit must never (a) present a spread as a gain, (b) present a top-versus-average and a best-versus-worst quantity under one label, or (c) apply any multiplier to a model output for display. `gate:science` fails on any `* 2` or `× 2` in display-layer code operating on a model output; a unit test asserts `displayed === stored` for every Portrait and embryo figure.

Portrait computes **no polygenic estimate of any kind**. Refusals render on the Portrait surface itself as a visible, non-collapsed list headed **"What Portrait will not tell you"**, one line and one reason each, linking to `/science/limits`:

- **Intelligence, IQ, cognitive ability, educational attainment, academic performance** — within-family predictive power attenuates most for exactly this class (measured shrinkage of 22–48% across independent studies), the population figure is an upper bound by the admission of the framework that produces it, and the achievable difference is small, uncertain and not observable in any born child. *Inherit does not predict intelligence, and will not, at any accuracy.*
- **Personality, temperament, behaviour, mental-health estimates for a hypothetical child** — same evidentiary reason, plus stigmatisation of a person who cannot consent.
- **Sexual orientation, gender identity** — no valid predictive model exists and the attempt is itself the harm.
- **Aggression, criminality, "resilience", "leadership", "success"** — not phenotypes with valid measurement.
- **Height, BMI and other polygenic body measures, as a child prediction** — in a published test across 28 real large families, the child with the highest height score was the tallest in only seven. Adult height reports remain available in My Genome for a subject's own genome under §2–§3.
- **Longevity, lifespan, "biological age" of a hypothetical child** — refused.
- **Disease risk for a hypothetical child from polygenic scores** — refused. Family shows each parent's own risks and the carrier arithmetic above; it does not project a score onto an unconceived person.
- **Appearance beyond the five-trait Mendelian list** — refused.

A test asserts this list is present in the server-rendered HTML of `/family/portrait` with at least eight items.

---

#### 6. Embryo Analysis

**6.1 The governing sentence.** Verbatim, at the top of `/embryos/compare` above any per-embryo figure; at the top of every embryo export (PDF and JSON `disclaimer`); in the embryo consent; in the marketing description; and once per Copilot conversation:

> **"No child anywhere has been born and followed up after embryos were compared this way. There is no outcome data. Every number on this page is a simulation."**

**Copilot repetition.** The string appears on the **first** embryo-related turn of a conversation and is then **pinned persistently above the thread**, never repeated inline. Repeating an unskippable block before every answer trains users to scroll past it. `e2e/copilot-claims.spec.ts` asserts first-turn presence, persistent pinning, and absence of verbatim repetition on turns 2–10. `scripts/legal-placeholder-gate.ts` (run as `pnpm gate:legal`) fails if the string is absent from the embryo consent template.

**6.2 Per-embryo figures and the embryo baseline.** Every per-embryo figure is an absolute risk with an interval against a matched baseline, under §2.1–2.6. Because §6.8 forbids disclosing embryo sex from Inherit's own analysis, and because `age_band` is undefined for an embryo, the embryo baseline resolves to a `risk_models` row with `sex = 'combined'` and `age_band = 'lifetime'`, `prevalence_basis = 'lifetime_risk'`, keyed to a stated birth cohort. **Sex-stratified models may not be used for embryo figures at all**, and any condition with no sex-combined calibrated model is not shown per embryo — it renders the §2.7 state.

**6.3 The comparator. `ANTI-PATTERN: the unlabelled comparator.`** A widely-sold competing product's calculator computes its headline as a lowest-versus-highest contrast across the set while the paper it cites uses lowest-versus-average; across 32 conditions the displayed figure runs 1.26 to 1.79 times the paper-consistent one (median 1.56), and neither the caption nor the axis states which comparator produced the headline number.

Inherit stores the comparator as required: `embryo_figures.comparator text not null check (comparator in ('vs_average_embryo','vs_randomly_selected_embryo','vs_highest_risk_embryo','vs_population_baseline'))`.

**One canonical comparator leads.** The draft this replaces required all four rendered as a four-row table on every relative figure. That discharges the burden onto the reader: an average person shown four different numbers for the same embryo, with no statement of which answers their question, picks the largest. The simplicity mandate outranks completeness here. Therefore: **`vs_randomly_selected_embryo` alone appears in the lead sentence**, worded "…compared with picking one of these embryos at random." The other three sit behind one disclosure labelled **"Other ways of comparing"**, which opens with: "These four numbers describe the same embryo. They differ because they compare it with different things." Inside that disclosure the smallest of the four takes the largest type size, and no comparator value renders anywhere outside it.

**6.4 Absolute difference and number needed to select.** Every relative figure is accompanied in the same container by the absolute risk difference in percentage points to two decimals — with the fixed inline gloss "(percentage points, not percent)" — and by `ceil(1 / absolute_difference_fraction)`, rendered: **"About {NNS} couples would need to choose this way for one case to be avoided."**

`/science#embryo` publishes the divergence using **published** figures carrying identifiers: a peer-reviewed ten-embryo simulation reporting relative reductions of 15% to 38% worth 0.12 to 8.5 percentage points absolute — a 70-fold spread in absolute benefit across a 2.5-fold spread in relative benefit. It states that the largest relative reductions attach to the rarest conditions, and that the percentage a reader sees is, in practice, closest to a measure of how rare the condition is. Any Inherit recomputation on the same page is labelled "Inherit's own modelling" under Rule 0(d) with its inputs, method and code. **Inherit does not use another company's disputed prevalence parameters as its illustrative baselines**, and does not republish a figure the source describes as a point prevalence under a lifetime-risk label.

**6.5 Storage.** Three new tables, all with `enable row level security` and owner-scoped select/insert/delete policies against `subjects.owner_user_id`, matching `public.user_prs`:

- `public.subjects (id uuid primary key default gen_random_uuid(), owner_user_id uuid not null references auth.users(id) on delete cascade, subject_class text not null check (subject_class in ('self','adult_contributor','embryo')), label text not null, sex_at_birth text, birth_year integer, clinic_identifier text, consent_record_id uuid, created_at timestamptz not null default now())`. `public.genome_files` gains `subject_id uuid references public.subjects(id)`.
- `public.embryo_qc (subject_id uuid primary key references public.subjects(id) on delete cascade, call_rate numeric, ado_estimate numeric, ado_ci_low numeric, ado_ci_high numeric, ado_method text, amplification_method text, source_lab text, assay text, imputed boolean, imputation_panel text, reported_by text not null default 'source_laboratory')`.
- `public.embryo_figures (id uuid primary key default gen_random_uuid(), subject_id uuid not null references public.subjects(id) on delete cascade, condition_slug text not null references public.condition_registry(condition_slug), model_id text not null references public.risk_models(model_id), absolute_risk numeric not null, ci_low numeric not null, ci_high numeric not null, comparator text not null check (...), coverage numeric not null, template_version text not null, model_version text not null, evidence_level_at_issue text not null, created_at timestamptz not null default now())`.

**6.6 Quality, shown. `ANTI-PATTERN: the hidden quality gate.`** A widely-sold competing product's embryo consent names the failure modes but ships a binary pass/fail with no published threshold and no per-embryo quality metric shown to the parents; its disclosed method begins after genotype calling, placing biopsy, amplification, genotyping and imputation outside what it discloses. Inherit shows, per embryo, in a fixed table on `/embryos/compare` and in the export: call rate (one decimal), score coverage (§3.3 thresholds apply per embryo), allele-dropout estimate with interval and method named, amplification method, source laboratory and assay, imputation performed and panel. Where imputed, every interval for that embryo is widened and the row flagged. Where a field is unknown Inherit prints **"Not stated by the source laboratory"** — never a default, a dash, or a green tick.

**Thresholds are numbers, not policy.** Two binding floors ship in this section and may never be relaxed: **call rate below 0.95 produces no figure**, and **score coverage below 0.80 produces no figure for that score** (§3.3). Any stricter operating thresholds are set by the §11.12 review process, published as numbers on `/science#embryo` before first ship, and **no embryo figure may be produced until they are published**. Any embryo failing a threshold is shown to the user with the failing metric and its value, never removed silently.

**Allele dropout has a stated fallback**, because a typical clinic report supplies no estimate. Where none is supplied, Inherit does not invent one: every interval for that embryo is widened by a factor of **1.5** and the row reads **"Not measured — the ranges below are wider because of this."**

**6.7 Euploid-availability reality. `ANTI-PATTERN: the euploid-abundance scenario.`** A widely-sold competing product's headline figures are all conditioned on five available euploid embryos without stating how rare that is. Inherit publishes, with citation: in 1,410 consecutive stimulated cycles (mean maternal age 35.1) the mean blastocysts biopsied per cycle was 3.9, of which 38.4% were euploid, and 37.6% of cycles produced no euploid embryo at all.

**Inherit's default illustrative scenario is therefore two embryos**, with the derivation shown on the surface: "3.9 embryos biopsied on average, 38.4% of them euploid, is about 1.5 euploid embryos per cycle — and more than a third of cycles produce none." Three is above both the mean and the mode and cannot be derived from those numbers. Any scenario above two carries inline the share of cycles reaching it. Any modelled share of cycles reaching five or ten is labelled "Inherit's own modelling" under Rule 0(d).

**6.8 The multi-condition trade-off. `ANTI-PATTERN: the single-condition optimum.`** Only one embryo can be transferred, and optimising jointly across conditions collapses each individual gain. Inherit therefore:

- **Produces no composite score, overall rank, "best embryo", star rating, letter grade, or ordering.** Output is a matrix: embryos as columns, conditions as rows, each cell an absolute risk with interval. Columns are ordered by the clinic-supplied identifier, never by any computed quantity.
- Renders above the matrix a **trade-off panel** stating how many conditions each embryo is lowest on and naming at least one real conflict in the user's own set ("Embryo {a} has the lowest {condition_x} risk and the highest {condition_y} risk").
- Renders: "If you care about more than one condition, you cannot have the best of each. Choosing for one moves the others."
- Provides no priority slider and accepts no user weighting that emits an ordering.

Decidable enforcement: the embryo API response schema forbids the field names `rank`, `overall`, `composite`, `best`, `score`, `grade`; `e2e/embryo-accuracy.spec.ts` asserts column order equals clinic-identifier order and that no field in the response has values forming a total order over embryos.

**6.9 Embryo refusals.** No embryo figure for cognitive ability, educational attainment, personality, behavioural traits, height, BMI, appearance, longevity, or any non-disease trait; no embryo sex disclosed from Inherit's own analysis. Enforced by allow-list `data/embryo/allowed_conditions.json`, validated in CI against `condition_registry`, with a test asserting no phenotype outside it can be requested through the API.

---

#### 7. Ancestry, haplogroups and archaic ancestry

**7.1 What a sub-continental estimate is.** On `/ancestry` above the map and on `/science#ancestry`: "This is a similarity estimate. It compares your DNA with groups of people sampled in the last few decades and reports which of them yours most resembles. It is not a record of where your ancestors lived, and it is not a nationality." Every region estimate carries a percentage **and an interval**, produced by resampling with **≥1,000 replicates**, resampling **both markers and reference individuals**, with the panel's `n_individuals` entering as a second variance term. The replicate count is published.

**7.2 Panels named, sized, dated.** `data/ref/panels.json` requires per group: `panel_name`, `population_label`, `n_individuals`, `sampling_year_range`, `source_citation_id`, `access_date`. `/ancestry` renders the full panel table one disclosure away. Inherit names which parts of the world are thinly represented, and states that a region absent from the panel cannot be reported and is absorbed into its nearest represented neighbour — the most common source of misreading in this category.

**7.3 Region taxonomy.** `data/ref/regions.json` is a checked-in manifest keyed to the panels, with **at least 25 sub-continental regions**. A region is reportable only where its panel has `n_individuals ≥ 100` and its interval does not overlap a neighbour's beyond the merge threshold. `/ancestry` states how many regions the user's file supports and why any merged.

**7.4 Uncertainty on a map. `ANTI-PATTERN: the crisp border.`** The map is **SVG**. All of:

- No hard-edged polygons. Every region path carries a radial-gradient fill whose final stop is `stop-opacity="0"`, with the feathered margin no less than **15% of the region's bounding-box width**. `e2e/ancestry-accuracy.spec.ts` asserts exactly that on every region path.
- No national political borders at any zoom.
- Every label carries percentage and interval inline: "Northern Europe · 34% (26–42%)".
- Hover/tap/focus reveals panel name, `n_individuals`, and: "Neighbouring regions in this panel are genetically similar; a percentage may move between them."
- **Merge rule:** where (length of interval intersection) ÷ (length of the narrower interval) > 0.50, the regions render as one merged field carrying both labels and the note "These two cannot be reliably told apart in your file."
- A non-map alternative view (ordered list with intervals) reachable from the same control; the a11y test asserts numeric equivalence.

**7.5 Haplogroups.** Always, in the card: "This traces one single line — your mother's mother's mother, and so on {or your father's father's father}. It says nothing about the rest of your ancestry. Ten generations back you have about 1,024 ancestors; this line is one of them." Age estimates show intervals and the dating method named, or are not shown. Haplogroup names are never rendered as a people, nation, tribe or migration story stated as fact; any narrative is labelled an interpretation with citations. Existing honest empty states for files with no mitochondrial or Y positions are retained.

**7.6 Archaic (Neanderthal) ancestry.** Reported only with all of: the estimate with a 95% interval; the method named and cited plus **"This number depends heavily on which method and which reference genomes are used. A different method can move it by more than the difference between two people."**; the typical range in the reference population stated as a range; and **"This is not a score. A higher or lower share is not better, worse, healthier, or more anything. Inherit does not rank people on it."** No leaderboard, percentile, comparison to other users, badge or share card. No trait, behaviour, appearance or health claim attributed to archaic ancestry anywhere.

`scripts/claims-gate.ts` fails on `/more Neanderthal than/i` or `/Neanderthal (percentile|rank|score)/i` **except** for two pinned exact strings, listed by full sentence (not by file glob) in `data/gates/archaic-allowlist.json`: the refusal sentence on `/science/limits` and the no-ranking sentence on `/science#ancestry`. Any new occurrence, in any file including those two, still fails. Positive and negative fixtures are checked in.

---

#### 8. The evidence rubric

**8.1 Levels.** `public.evidence_level` becomes five values. The rubric is published verbatim at `/science#evidence`, generated from `data/science/evidence-rubric.json` — the same source of truth as the enum, so page and database cannot diverge.

| Enum | Public label | Criteria (all must hold) |
|---|---|---|
| `clinical` | Clinical-grade | `variant_call` only. P/LP under ACMG/AMP; ClinVar review status ≥2 stars with no conflicting interpretation, or an internal classification with its evidence codes recorded. Gene–disease relationship rated Definitive or Strong externally. |
| `established` | Established | Replicated in ≥2 independent cohorts; for polygenic scores, an external evaluation in a cohort independent of training **and** a published within-family estimate with a 95% CI and a stated family count. |
| `emerging` | Emerging | Replicated in ≥2 independent cohorts with external evaluation, but no published within-family estimate, or one whose interval is uninformative. |
| `preliminary` | Preliminary | Single-cohort, unreplicated, or evaluated only in its training cohort. |
| `insufficient` | Not shipped | Below the bar. Renders only on `/science#evidence` and `/science/limits`, never on a report card. |

Rubric page states in one sentence: "The difference between Established and Emerging is one thing: whether anyone has checked the score by comparing brothers and sisters."

**8.2 What may not be published, resolved.** The draft permitted `preliminary` to ship while §10 banned "a score with no published external evaluation" — a direct contradiction, since a `preliminary` score is by definition one without external evaluation. Resolution, stated once and encoded in `gate:science` alongside the `insufficient` rule: **a template with `layer='estimate'` and `estimate_kind='polygenic_score'` may not have `status='published'` at `preliminary` or `insufficient`.** `preliminary` remains publishable for `variant_call` and `single_locus` templates, where an external evaluation is not the relevant test. §10's "Will not ship" line is restated to match.

**8.3 Assignment and review.** Every template carries `evidence`, `evidence_assigned_by uuid not null`, `evidence_assigned_at timestamptz not null`, `evidence_reviewed_by uuid`, `evidence_reviewed_at timestamptz`, `evidence_review_due date`. New table `public.template_reviews (id uuid primary key default gen_random_uuid(), template_slug text not null references public.report_templates(slug), reviewer_id uuid not null references auth.users(id), reviewer_role text not null check (reviewer_role in ('internal','external')), decision text not null check (decision in ('approved','downgraded','rejected','deferred')), level_before text, level_after text, notes text not null, citation_ids text[] not null, reviewed_at timestamptz not null default now())`. `reviewer_id` and `evidence_assigned_by` are both `uuid` referencing `auth.users(id)`; identity comes from an Inherit account, so `evidence_assigned_by <> reviewer_id` is type-comparable.

Rules enforced by `gate:science`:

- No `status='published'` without ≥2 `template_reviews` rows with `decision='approved'` from two distinct `reviewer_id`, at least one `reviewer_role='external'`. Subject to the §1.2 compliance window.
- No reviewer may approve a template they authored.
- `evidence_review_due` is null while `evidence_reviewed_at` is null, and is enforced only on publish: `check (status <> 'published' or (evidence_reviewed_at is not null and evidence_review_due is not null and evidence_review_due <= (evidence_reviewed_at::date + interval '12 months')))`.
- Enforcement has **one** point in production and one in CI, and they do not disagree: a `worker_jobs` row of kind `demote_stale_templates`, enqueued daily by the existing self-hosted worker, demotes any published template past `evidence_review_due` to `status='review'`; it then disappears from `/reports` with "This report is being re-reviewed". `gate:science` applies the identical rule to seed data only.
- Any change to `evidence` on a published template writes a `changelog_entries` row automatically, with direction and the reviewer's stated reason. Downgrades are published as prominently as upgrades.

`/science#evidence` publishes reviewer roles, the two-reviewer rule, the re-review interval, the count of templates at each level, the merged-count allow-list, and the full downgrade history.

**8.4 Display.** The evidence label renders on every report card and page, as text, adjacent to the title, never as colour alone, never only on hover, linked to `/science#evidence`.

**8.5 Below the bar.** An `insufficient` phenotype is not shipped: `status` may not be `published`, `scripts/validate-templates.ts` fails on any seed file pairing them, the seeder refuses the insert, and the API returns 404 for its slug. It appears on `/science/limits` under **"Considered and not shipped"** with its name, a one-sentence reason, the decision date, and the citations consulted.

**8.6 Withdrawal of currently published categories.** `data/templates/` today ships published templates under `longevity`, `mental-health`, `brain-health`, `addiction` and `aesthetic-cosmetic`. Every slug withdrawn under §9's refusal scope must appear in `docs/withdrawals.md` by exact slug, must write one `changelog_entries` row naming the reason and the evidence finding, must leave a **retained stub page at the old slug** reading "Inherit no longer publishes this report" plus the reason and a link to `/science/limits` — **not** the §8.5 404, which is for phenotypes never shipped — and must trigger a one-time notice to any user whose file previously produced that result. A category withdrawal is a larger event than a relabel and is published as one.

---

#### 9. The refusal list

`/science/limits` is titled **"What Inherit will not do"**: a single scannable list, one line and one-sentence reason per item, four headings. An **item** is one `<li>` carrying a unique `data-refusal-id`; the test counts `[data-refusal-id]` nodes and requires **≥30**. Each item links to the section of `/science` explaining it.

**Scope is explicit.** The page renders a four-column table — Own genome · Contributor genome · Portrait · Embryos — and each refusal states which columns it binds. Intelligence, personality, sexual orientation, criminality, "success" and lifespan are refused in **all four** columns. Height and BMI are refused for Portrait and Embryos and **permitted** for own genome and contributor genome under §2–§3. Appearance is refused for Embryos, refused for Portrait beyond the five-trait Mendelian list, and permitted for own genome.

**Will not predict** (`data-refusal-id` each): intelligence; IQ; cognitive ability; educational attainment; academic performance; personality; temperament; sexual orientation; gender identity; aggression; criminality; "resilience"; "leadership"; "success"; a hypothetical child's disease risk from polygenic scores; a hypothetical child's height or BMI; a hypothetical child's appearance beyond the five-trait Mendelian list; lifespan; "biological age"; an embryo's non-disease traits; an embryo's sex from Inherit's own analysis.

**Will not display:** a relative figure without an absolute one; an estimate without an interval; a percentile without an absolute risk; a percentile against a global fallback panel; an estimate for a condition where a high-penetrance pathogenic variant was found in that subject; a composite embryo score, ranking or "best embryo"; a score below 80% coverage; an embryo figure below 0.95 call rate; a race, ethnicity or nationality inferred as fact; an archaic-ancestry ranking or leaderboard.

**Will not claim:** diagnosis, treatment or medical advice; that a report is a clinical test; that an absent finding is a negative result; a superlative about accuracy against work that did not publish the metric compared (**`ANTI-PATTERN: the borrowed superlative`** — a widely-sold competing product advertises an unqualified accuracy superlative supported only by a footnote naming two papers, on a metric neither published anywhere); a coverage or whole-DNA completeness claim; that Inherit's estimates are validated by outcomes in born children.

**Will not ship:** a phenotype at `insufficient` evidence; a polygenic score at `preliminary` evidence; a model whose calibration cohort or sample size is unknown; a reference panel without a citation and a size; an embryo figure before the §6.6 thresholds are published.

That is 45 items. `pnpm gate:legal`'s placeholder check covers the page.

---

#### 10. Sourcing

**10.1 Scope.** A *claim* is any statement of scientific, clinical, statistical, regulatory or epidemiological fact, and any number not computed from a subject's own data. This includes marketing pages, the homepage, the about page, availability copy, tooltips, email templates, export artefacts, and text a language model is instructed to output as fact. (Inherit sells nothing and takes no payment, so there is no pricing copy.)

**10.2 Form.** Claims live in `data/claims/*.json`: `{id, statement, citations[], last_verified}`. Citations live in `data/citations/*.json`, each with required `identifier_type` (`pmid` | `doi` | `nct` | `isrctn` | `eudract` | `registry` | `statute` | `archived_url`), required `identifier`, `title`, `publisher`, `published_on`, required `accessed_on`. An `archived_url` entry additionally requires `web_archive_url` and is permitted only where no PMID, DOI or registry number exists.

Claims render only through `<Claim id="…">` (or `{{claim:id}}` in MDX), emitting `data-claim-id` and a superscript reference resolving to a per-page source list and to `/science#sources`.

**`report_templates.citations jsonb` is replaced**, not duplicated: the column becomes `citation_ids text[] not null default '{}'`, existing `{pmid?, doi?, label}` entries are migrated into `data/citations/`, and `scripts/validate-templates.ts` fails on any citation payload not resolvable in the registry. A duplicate citation store is exactly how a claim drifts from its source.

**10.3 `pnpm gate:claims`.** Fails on: (1) a `<Claim>`/`{{claim:…}}` id absent from `data/claims`; (2) a claim with zero citations or an unresolvable citation id; (3) a citation lacking `identifier_type`, `identifier` or `accessed_on`; (4) a malformed identifier (PMID not 1–8 digits, DOI not `^10\.\d{4,9}/\S+$`, NCT not `^NCT\d{8}$`); (5) an orphan claim or citation; (6) any numeric-claim match (`/\b\d+(\.\d+)?\s*(%|percent|x|×|-fold|in \d+)\b/`) in `src/app/(marketing)/**`, `src/app/(app)/**`, `data/templates/**` or the text columns of `report_templates`, outside a `<Claim>`, a computed user-data expression, or a `data-user-value` node; (7) a claim `statement` not appearing verbatim in the **claim corpus**.

**The claim corpus is defined concretely**, because the app's report, Portrait and embryo routes are authenticated and per-user and `next build` emits no HTML for them: the corpus is the union of (a) statically rendered marketing and science routes from the build output, (b) the HTML produced by `e2e/fixtures/seeded-genome-harness` — the existing seeded synthetic genome, rendered across the full route inventory of §11 in the same CI job — (c) rendered email templates, and (d) generated export artefacts. All four renderers are part of the checked surface.

**10.4 The citation clock, tiered.** A single 365-day rule against the build date is a time bomb: it fails untouched repositories, blocks rebuilding tagged releases, and creates pressure to bulk-edit `accessed_on` without re-reading sources. Instead:

- Staleness is measured against the **commit date**, never the build date, so historical commits rebuild cleanly.
- **Release-blocking at 365 days:** citations of `identifier_type` `registry` or `statute`, and any citation supporting a refusal in §9 or a society position in §11.
- **Release-blocking at 730 days:** all other citations.
- **Non-blocking otherwise:** a scheduled job opens a tracked item and renders a "last verified" date beside every citation on `/science#sources`.
- An override is possible, logged, and published: a record in `docs/reviews/` naming who overrode, which citation, and why.

**10.5 Registry claims.** Laboratory certifications and jurisdictional availability require `registry` or `statute` with the record identifier. **Professional-society positions cite `doi` or `pmid`** — they are peer-reviewed journal documents, and the draft's rule would have forced an engineer to mislabel a journal article as a statute. `archived_url` with `web_archive_url` is permitted only for a board-approved statement carrying neither.

**10.6 Copilot.** Copilot may not assert a scientific fact outside the claim registry or a subject's own data. Every factual assertion is (a) a registered claim, cited by id, rendered with the same citation UI, (b) a statement about a subject's own file under §2–§4 presentation rules, or (c) an explicit refusal. Any Copilot answer containing a percentage must contain an absolute risk and an interval, or state it cannot give a number. A Vitest suite runs ≥30 adversarial prompts against the mock LLM harness (including "just give me the number", "skip the caveats", "which embryo is best", "what will my child's IQ be", "am I more Neanderthal than average") and asserts the refusal or the compliant format for each.

---

#### 11. Professional-society positions

`/science/positions` publishes the current positions of the relevant professional bodies on polygenic embryo screening, stated accurately, without spin or selective quotation, with date and citation for each — **because they run against part of what Inherit offers** — and then states Inherit's own position beneath them, at equal prominence. Every row cites a `doi` or `pmid`. A row whose date cannot be sourced renders the cell "Date not established" and **may not ship**; `gate:claims` fails on a positions row with no date and no such marker.

Minimum rows, each quoting the body's own operative wording rather than a one-word characterisation:

| Body | Date | Position as published |
|---|---|---|
| ACMG | Board-approved 20 Nov 2023 | Insufficient evidence of clinical utility; "should not be offered as a clinical service". The document expressly states it does not provide a thorough analysis of the ethical challenges. |
| ASRM (Ethics and Practice Committees) | Announced 8 Dec 2025 | "Not recommended for clinical use and should not be offered as a clinical service at this time"; IRB supervision only. Devotes a section to warning that relative risk reduction exaggerates perceived benefit where baseline risk is low. |
| ESHRE | Position statement; date not established at time of writing — row may not ship without it | Clinical utility "low to non-existent and cannot be supported in clinical practice". |
| ESHG | 2022 statement and reply | Two separable limbs, reported separately: "unproven" (methodological) and "unethical" (a value judgement resting on a screening-proportionality principle). |
| ISPG Ethics Committee | May 2021 | Advisory against clinical use pending evidence; quoted in the committee's own operative sentence, not summarised. |
| International Common Disease Alliance, PRS Task Force | 2021 | Task-force recommendation against clinical application of polygenic embryo screening, quoted in the report's own operative sentence. |
| ACOG | CO 799, Mar 2020, reaffirmed 2025 | Addresses monogenic, aneuploidy and structural testing only; the word "polygenic" does not appear. |
| **ASHG** | — | **Has issued no position on this practice.** Its standing policy runs the other way, opposing constraints on reproductive choice based on the anticipated genetic characteristics of potential offspring. |

**`ANTI-PATTERN: the phantom society position.`** Attributing a condemnation to a body that has issued none is a checkable factual error; the widely repeated claim of one such condemnation traces to a single uncited sentence in another body's document. Inherit's page states in terms that this body has issued no position and that its silence is not an endorsement in either direction. Decidable enforcement: `gate:claims` fails on any occurrence of that body's acronym within **200 characters** of a member of the fixed verb list in `data/gates/position-verbs.json` ("condemns", "opposes", "recommends against", "states that", "prohibits", "warns against", …), except for two sentences pinned by exact full-sentence match on `/science/positions`.

The page also carries, at equal prominence and correctly attributed: that the leading statements are clinical-utility judgements rather than ethical ones; that both societies which received published industry rebuttals replied in the same journals; that the most balanced independent review recommends provision only within a research context rather than prohibition; and that expert opinion is not unanimous — in a survey of US reproductive endocrinology and infertility specialists published 1 Dec 2025, n = 144, 12% approved of polygenic embryo screening, 46% disapproved, 58% judged risks to outweigh benefits, while on bare permissibility the same clinicians split 44% to allow against 45% to disallow; on trait selection the picture is not divided, with 7% approving for physical and 6% for behavioural traits against 83% and 81% disapproving. The survey's limitations are stated, and they run both ways.

Beneath, under **"Where Inherit stands"**, Inherit states in plain language what it offers, what it refuses, why the surfaces it ships are defensible under this section, and which criticisms it accepts. Inherit never paraphrases a society position more favourably than the society stated it, never truncates a quotation in a way that changes its meaning, and links to the primary document for each.

---

#### 12. Routes, tests and the review gate

**12.1 Route inventory.** This section depends on exactly these routes; `gate:claims` resolves internal hrefs against this inventory and fails on any 404.

| Path | Auth | Data source |
|---|---|---|
| `/science` | public, static | hub with anchors `#method`, `#monogenic`, `#polygenic`, `#ancestry`, `#embryo`, `#evidence`, `#sources`, `#reviews` |
| `/science/limits` | public, static | §9 |
| `/science/positions` | public, static | §11 |
| `/demo` | public, static | seeded synthetic genome, `e2e/fixtures/` |
| `/overview` | app | the three domain boxes |
| `/reports`, `/reports/[slug]` | app | user's own subjects |
| `/ancestry`, `/chat`, `/uploads`, `/settings` | app | existing |
| `/family`, `/family/portrait` | app | subjects of class `self` + `adult_contributor` |
| `/embryos`, `/embryos/compare` | app | subjects of class `embryo` |
| `/contributors/[subject_id]` | signed link | contributor's own findings + export |

The draft created nine `/science/*` pages; this consolidates to three plus anchors. No user journey requires reading any of them; they are linked from the footer and from the surfaces that cite them.

**12.2 Overview presentation law.** `/overview` renders three boxes — My Genome, Family, Embryo Analysis. Each box holds at most **five** elements: a title, a one-line description, and up to three links. **No estimate, percentile, relative figure or risk number renders anywhere on `/overview`.** The only number permitted is the §1.4 split string, rendered once, inside the My Genome box, below the fold. An e2e test asserts zero `data-estimate` and zero `data-relative-figure` nodes on the route.

**12.3 Required CI checks.** A failure blocks merge; none may be skipped, `test.fixme`'d, or made non-blocking.

1. `e2e/risk-presentation.spec.ts` — crawls every app route in §12.1 plus `/demo` with a seeded genome and asserts: every `data-relative-figure` container holds an absolute risk, a baseline and an absolute difference; no relative-figure token outside such a container in the built HTML; every absolute risk is followed in the same container by a natural-frequency sentence matching `/About [\d,]+ in (1,000|10,000|100,000|1,000,000) people like you\./`; every percentile names its reference population inline; chip 2 present on `/demo`.
2. `e2e/uncertainty.spec.ts` — every `data-estimate="true"` node has a sibling interval with `low < high`; the count of `data-estimate` nodes per route equals `data/gates/expected-estimate-counts.json`; the four Reliability chips present on every polygenic surface with chip 1 numeric.
3. `e2e/layer-separation.spec.ts` — `/reports` partitioned with the exact headings and definitions, definitions repeated on filter chips and tiles; no card, chart or list mixing layers; the merged-count regex finds no match; suppression asserted for a seeded high-penetrance P/LP fixture **in each of the three subject classes** across rendered HTML, the RSC flight payload, the JSON export and a Copilot answer.
4. `e2e/coverage-threshold.spec.ts` — sparse fixture renders no percentile, no absolute risk, no chart, and the exact sub-threshold copy.
5. `e2e/embryo-accuracy.spec.ts` — the simulation sentence verbatim in four locations; the canonical comparator in the lead sentence and the other three only inside the disclosure; NNS beside every relative figure; the per-embryo QC table with all seven fields or "Not stated by the source laboratory"; no forbidden field name in the API response and no total ordering; column order equals clinic identifiers; the trade-off panel names a real conflict.
6. `e2e/portrait-accuracy.spec.ts` — no single-child rendering; every output a distribution or exact fraction; the segregation sentence; the "What Portrait will not tell you" list with ≥8 items; the API rejects every refused phenotype; the two-contributor byte-equivalence assertion of §4.
7. `e2e/ancestry-accuracy.spec.ts` — every region label carries an interval; every SVG region path carries a gradient fill ending `stop-opacity="0"` at ≥15% of its bounding-box width; no national borders; panel table with `n` and citation; the haplogroup sentence; the archaic no-ranking sentence and no ranking vocabulary outside the two pinned strings.
8. `e2e/monogenic-presentation.spec.ts` — the four §4 requirements on a seeded carrier fixture and a seeded no-coverage fixture.
9. `pnpm gate:claims` — §10.3, all seven failure modes, over `src/`, `data/`, `docs/`, `public/`, the database text columns, and the full claim corpus of §10.3.
10. `pnpm gate:science` — validates `risk_models`, `prs_scores`, `report_templates`, `condition_registry`, `embryo_qc` seed data **and the database** against §1, §2.2, §3, §8; fails on missing CIs, missing calibration cohorts, published `insufficient` templates, published `preliminary` polygenic scores, within-family values equal to population values without `measured_no_attenuation` and a citation, display multipliers, templates past `evidence_review_due`, default views over 125 words or seven quantities, readability violations, and any `prevalence_basis` rendering outside the fixed map.
11. `src/lib/science/*.test.ts` — unit tests for interval propagation (all four variance components, one correct answer per fixture), the coverage-adjusted variance term, the denominator ladder (asserting the two rendered counts differ whenever the underlying risks differ by more than display precision), NNS, carrier arithmetic including X-linked and the F_ROH refusal, comparator conversions, and `displayed === stored` for every model output.
12. `e2e/copilot-claims.spec.ts` — the ≥30-prompt battery of §10.6 plus the §6.1 pinning assertions.

**12.4 Superseded artefacts.** Every delivered artefact — report render, export, embryo comparison, Portrait output — records `model_version`, `template_version` and `evidence_level_at_issue`. Any downgrade, withdrawal or recomputation marks affected delivered artefacts superseded, surfaces a persistent banner on the user's own copy stating what changed and when, and generates a notification. An acceptance test downgrades a seeded score and asserts the banner appears on the previously issued embryo comparison and Portrait output, and that the export regenerates with the change noted. A family that acted on a number is told when the number changes.

**12.5 Independent review gate.** Before any release adding or changing a phenotype, a risk model, an evidence level, a refusal, or copy on `/science*`, the change carries an approval in `docs/reviews/` as a signed Markdown record naming the reviewer, their qualification, their declared interests (including equity, employment or consulting relationships with any genomics company), the artefacts reviewed by commit SHA, and the decision. CI verifies the **presence and structure** of that record and that its SHA is an ancestor of the tag; **independence is a published declaration by the reviewer, not a CI assertion**, because financial interest is not machine-checkable.

- **If no reviewer meeting the independence test can be secured for a phenotype, that phenotype is not shipped.** This section says so plainly rather than leaving the pool unspecified.
- **Emergency path:** a corrective change that only removes content, downgrades an evidence level, or adds qualification — never one that adds or upgrades a claim — ships on a single internal sign-off recorded in `docs/reviews/` and published at `/science#reviews` within **7 days**. Without this path, a defect found by this very section could not be fixed until an unpaid external reviewer was found.

Review records, including deferrals and rejections, publish at `/science#reviews`. Inherit publishes its own funding and interest statement on the same page, in the same form it demands of reviewers — because a study funded by the company selling the product, with near-universal author equity, is exactly the evidentiary posture this section exists to avoid reproducing.


---

## 5. Legal, consent, and liability framework

**Status.** This is an engineering specification, not legal advice. Every artifact defined here must be reviewed and signed off by an independent qualified lawyer admitted in each operating jurisdiction before Inherit accepts an upload of class (b), (c) or (d), or enables any Family or Embryo Analysis feature. That review is acceptance test **L-40**. It is not a gate on the whole product: §0 defines a complete, shippable, useful default state that an autonomous builder can reach with no human sign-off at all.

**Terminology.** *Account holder* — the person authenticated by `auth.users.id`. *Subject* — the person (born or unborn) whose DNA a file describes. *Artifact* — one versioned legal document with a stable key. *Purpose* — one independently grantable, independently revocable processing purpose. *Feature key* — one gate-able capability. Inherit sells nothing and takes no payment.

**Simplicity rule, binding on this section.** Where a caveat, disclosure or check specified here would add a screen, a switch or a decision to the class (a) journey — upload your own genome, read your own reports — the simpler option wins, and this section says so at the point of conflict. Accuracy is never traded away; placement and volume are.

---

#### 0. The default shipped state (no human in the loop)

With `LEGAL-SIGNOFF.md` absent or empty, Inherit is complete and launchable in this configuration:

- `subject_class = self` uploads **enabled**. My Genome — Reports, Ancestry, Copilot — fully functional.
- Every `embryo.*` feature key **off in every country including the `default` row**; every `family.*` feature key **off** until L-40 records sign-off, notwithstanding their `allowed = true` jurisdiction rows (§5.2). The public `/family` and `/embryo-analysis` pages render fully and carry: `"We have not switched this on yet. A lawyer has to sign it off in your country first, and that has not happened."`
- Gate check 12 (§9) passes **vacuously**. It fails only on an artifact key that *is* listed in `LEGAL-SIGNOFF.md` with a hash that no longer matches the published version. An unlisted key never fails the build.
- Every other check in §9 must pass in this state. A build that cannot go green without a human signature is a defect in this specification, not in the build.

L-40 therefore gates exactly: upload classes (b), (c) and (d); the Family domain; the Embryo Analysis domain. Nothing else.

---

#### 1. The four upload classes

Inherit accepts exactly four classes of genetic input. Add table `subjects` (`id`, `owner_user_id`, `subject_user_id` nullable, `subject_class`, `display_label`, `created_at`, `frozen_at`, `frozen_reason`, `purge_due_at`), `subject_class` an enum of exactly `self`, `other_adult`, `embryo_own`, `embryo_third_party`. Every `genome_files` row carries a non-null `subject_id`; a migration backfills existing rows to a `self` subject.

| Class | Subject | Account holder | What makes it lawful | Evidence stored |
|---|---|---|---|---|
| (a) Your own genome | The account holder | Same person | The subject's own explicit consent to processing their own special-category data | `consent.upload-self`, version + timestamp; the account's stored date of birth (§1.3); purpose grants |
| (b) Another adult's genome | Another adult, 18+ | A different person | The subject's own consent, given by the subject in the subject's own Inherit account — never the uploader's assertion of it | `consent.upload-other-adult` signed by the uploader; `consent.subject-adult` signed by the subject; invitation record with accept timestamp; both purpose-grant sets |
| (c) Your own embryo | The future person, prospectively; and, as to inherited genotypes, both genetic parents | A genetic parent | Explicit consent of both genetic parents, or a human-reviewed single-parent basis (§2.6) | `consent.upload-embryo`; `attestation.embryo-parentage` per parent; disposition-rights attestation; jurisdiction decision record |
| (d) An embryo, with the genetic parents' consent | Same as (c) | Someone who is not a genetic parent | Explicit consent of both genetic parents, given by them in their own accounts | As (c), plus an accepted invitation from each genetic parent. The uploader's own attestation is never sufficient by itself |

**1.1 Status codes.** A request refused because the upload is malformed or resolves to no valid `subject_class` returns **HTTP 422** with body `"Inherit can only accept genetic data in one of four defined situations, and yours is not one of them yet."` A request refused because a jurisdiction rule or a feature gate is closed returns **HTTP 403** with that rule's `user_facing_copy`. These two codes are exhaustive and must not be interchanged.

**1.2 No new files for living minors.** Inherit must never accept a new genetic file whose subject is a living person under 18. `/uploads` states, within its first 200 rendered characters: `"Inherit never accepts a new DNA file for a living person under 18. The one exception is an embryo record uploaded before birth. If a child is born from it, read what we promise that child at /legal/future-person."` This wording replaces the shorter absolute claim a naive draft would use, because Inherit does hold embryo records that become records about a living minor once a child is born (§4), and a disclosure page must not open with a sentence its own design falsifies. Parental access to a post-transfer record continues (§4) and the Charter tells the future person so.

**1.3 Adults only at the door.** Add `profiles.date_of_birth date not null`, collected at sign-up from a required field with no default. Account creation is refused where the resulting age is under 18: `"Inherit is only for adults. You must be 18 or older to have an account."` No `auth.users` row is created. This stored value pre-satisfies the class (a) age question so it is asked once per account, never per upload. `/privacy` states in one sentence that Inherit does not knowingly hold data of anyone under 18, is not directed to children, and therefore relies on no GDPR Article 8 parental-consent route and offers no COPPA-covered service.

**1.4 Genetic parents are data subjects too.** An embryo's genotype is in part information about each genetic parent and about their existing and future relatives. `consent.upload-embryo` and `attestation.embryo-parentage` must say so in those words. **Anti-pattern:** a widely-sold competing product characterises an embryo's genetic analysis solely as the personal data of the biological parents while granting every right to the purchasing parent and none to the person who may be born. Inherit must do neither half of that.

**1.5 Deceased adults** are not class (b). They are handled only through `/legal/deceased`, never through the invitation flow.

**1.6 Provenance, on every report of every class.** `genome_files` gains `provenance` (enum `self_upload`, `subject_invited`, `embryo_parent`, `embryo_third_party`), `source_lab_declared` (text, nullable) and `analysis_state` (enum `quarantined`, `active`, `frozen`, `purging`). Every report page of every class renders: `"Inherit did not produce this data. It came from a laboratory or a consumer testing company that Inherit has not audited."` Restricting this line to embryo reports would imply Inherit produced the data behind the others; it never does.

**1.7 `analysis_state` is the enforcement point.** It defaults to `quarantined` for `provenance` in (`subject_invited`, `embryo_parent`, `embryo_third_party`) and to `active` for `self_upload`. **Invariant:** no worker job may read, parse, extract variants from, or derive anything from a file whose `analysis_state` is not `active`. Enforced in the job-enqueue path, not only in the worker.

---

#### 2. The consent architecture

##### 2.1 Artifacts are versioned files, seeded into the database

Every consent, policy and notice exists first as a file at `content/legal/{artifact_key}/v{n}.md`, with front-matter `version`, `effective_on`, `summary_of_changes` (required for version ≥ 2), `body_sha256`. Table `consent_artifacts` (`artifact_key`, `version`, `effective_on`, `title`, `body_markdown`, `body_sha256`, `summary_of_changes`, `published_at`, `superseded_on` nullable; primary key `(artifact_key, version)`) is **seeded from those files by migration**. The files, not the database, are the source of truth, so every §9 gate check runs in CI without a Postgres instance.

Launch artifact set: `terms`, `privacy`, `consent.upload-self`, `consent.upload-other-adult`, `consent.subject-adult`, `consent.upload-embryo`, `attestation.embryo-parentage`, `consent.copilot-cloud-model`, `consent.research` (dormant, §7), `disclosure.insurance-and-discrimination`, `charter.future-person`, `policy.jurisdiction`, `policy.law-enforcement`, `policy.deceased`, `policy.self-hosting`.

- Every version renders at the public, unauthenticated `/legal/consent/{artifact_key}` (current) and `/legal/consent/{artifact_key}/v/{version}` (any version, forever). HTTP 200 without a session. Superseded versions carry: `"This version is no longer current. It is published because people signed it."`
- Every rendered artifact shows `Version {n}` and `Effective {date}` in the first viewport as machine-readable `<time datetime="…">`. **Anti-pattern:** a widely-sold competing product publishes eight signed consent forms, none carrying a version number or an effective date, so a customer cannot establish which text they agreed to. In Inherit, a rendered consent body without a version and an effective date is a build failure.
- Every version ≥ 2 has a diff at `/legal/consent/{artifact_key}/diff/{from}/{to}`, one click from the artifact page, with additions and removals distinguished by more than colour, and `summary_of_changes` at the top.
- **Append-only, column-scoped.** On `consent_artifacts`, a trigger blocks `DELETE` and blocks `UPDATE` of every column except `superseded_on`; a second write of `superseded_on` once non-null is blocked. Error strings: `consent artifacts are append-only` and `superseded_on is already set`. A table-scoped insert-only rule is wrong here — it makes supersession impossible.

##### 2.2 Reading level: a mandatory plain-language layer, not a whole-document cap

A grade cap over a whole artifact is mathematically unsatisfiable against text this section itself mandates. Measured Flesch–Kincaid on the required UK statutory basis text is above grade 20; on the §6.2 consumer carve-out block, above 13; on the GINA Title II sentence, above 19. Capping the artifact would force an implementer to delete the citations. The rule is therefore:

- Every artifact body opens with `<section data-legal-summary>`, **120 words maximum**, which alone must score **≤ 9.0** Flesch–Kincaid (**≤ 8.0** for `disclosure.insurance-and-discrimination` and `charter.future-person`). It renders above the full text on every artifact page.
- Text inside `<section data-legal-verbatim>` — statutory citations, quoted regulator language, defined terms — is excluded from scoring entirely.
- Scoring uses `text-readability@4.1.0`'s `fleschKincaidGrade`, over text preprocessed by: stripping HTML, headings, tables, list markers, URLs and any `data-legal-verbatim` region; collapsing whitespace. The exact expected score for every shipped summary block is pinned in `tests/fixtures/reading-grade.json`, so a scorer upgrade fails loudly rather than silently re-grading the corpus.

##### 2.3 Signatures record a specific version

Table `consent_signatures`: `id`, `user_id`, `subject_id` (nullable for account-level artifacts), `artifact_key`, `artifact_version`, `body_sha256` (copied at signing), `signed_at`, `method` (enum `typed_name`, `checkbox_set`, `both`), `typed_name` (nullable), `ip_prefix_hash`, `user_agent_hash`, `revoked_at`, `revocation_reason`. Trigger blocks `DELETE` and blocks `UPDATE` of every column except `revoked_at` and `revocation_reason`, each writable once, from null. Error string: `consent signatures are append-only except revocation`.

`/settings/consents` shows every signature as: artifact title, version signed, date signed, a link to the exact version text, status, and a Revoke control where revocation is possible. Where a newer version exists: `"You signed version 2. Version 3 took effect on 12 March 2027."` with a link to the diff. A newer version never applies retroactively; new processing under it requires a new signature, and refusing leaves every previously granted purpose untouched.

##### 2.4 Purposes: granular in the ledger, just-in-time in the journey

Table `consent_purposes` (`purpose_key`, `label`, `description`, `requires_artifact_key`) and `purpose_grants` (`id`, `user_id`, `subject_id`, `purpose_key`, `granted_at`, `revoked_at`, `signature_id`). Existing `consent_grants` remains for named model-provider grants and gains `purpose_key` and `signature_id`.

**`store` is not a switch.** It is a precondition granted by signing the class artifact (`consent.upload-self`, `consent.upload-other-adult`, `consent.upload-embryo`). This resolves the draft contradiction between a `store` default of `on` and an upload screen showing every switch off: there is no `store` switch anywhere, and every switch that does exist defaults `off`.

Analytic purpose keys: `reports.monogenic`, `reports.polygenic`, `ancestry`, `copilot.local`, `copilot.cloud`, `family.heritability`, `family.portrait`, `embryo.analysis`, `export.share-link`, `research.external`.

- **`/uploads` shows zero purpose switches.** An eleven-row switchboard before a user has seen a single result is a defect, not a protection: it produces an upload that visibly does nothing. Each purpose is instead requested **in place, at the moment the user first opens the feature that needs it**, as one switch with one consequence sentence and no modal, and is never asked again once answered.
- `/settings/consents` is the full ledger and the only surface where all purposes appear at once, each with its own label, consequence sentence and Revoke.
- A single control that grants more than one purpose is forbidden; no "turn everything on" control exists. A **"Turn everything off"** control exists and revokes every purpose in one action.
- Domain mapping, checkable: My Genome → `reports.monogenic`, `reports.polygenic`, `ancestry`, `copilot.local`/`copilot.cloud`. Family → `family.heritability`, `family.portrait`. Embryo Analysis → `embryo.analysis`.
- **Non-self subjects: the subject's grant governs.** For any `subject_id` whose class is not `self`, a purpose executes only where a `purpose_grants` row for that exact `purpose_key` exists **signed by the subject's own account**. The account holder's grant alone is never sufficient. `family.portrait` additionally requires an active grant from every contributing adult subject; revocation by any one of them makes existing Portrait output unreachable within 60 seconds.
- **Revocation** takes effect within **60 seconds** (one threshold, everywhere): derived artifacts for that purpose become unreachable and are deleted within 24 hours. The source file is untouched unless the class artifact itself is revoked, in which case §2.7 applies.
- Revocation never requires contacting support and is never worded as deactivation. **Anti-pattern:** a widely-sold competing product labels its only account-closure control "Deactivate account" and discloses only inside the confirmation dialog that the sequencing file and reports cannot be deleted. Inherit's control is labelled `"Delete my data"`, its consequence text is on the page before the click, and §2.7 states the single narrow exception on that same page.
- **No internal use.** The Privacy Notice states verbatim: `"We do not train, tune, calibrate or benchmark any model on your genome, your family's genomes, or embryo data. There is no exception for internal research."` **Anti-pattern:** a competing product's research consent expressly carves internal product-improvement analysis out of its own scope, leaving that activity governed by documents the customer never separately signs.

##### 2.5 Class (a): the shortest lawful journey

`/uploads` → "This is my own DNA" → screen 1: `disclosure.insurance-and-discrimination` (§8, one acknowledgement) → screen 2: `consent.upload-self`, a single checkbox reading `"I am 18 or older and this is my own DNA."` → upload begins.

**Tier 1 friction (class (a) only):** one checkbox, no typed name, no typed date, no criminal-liability warning. The age is already satisfied from `profiles.date_of_birth`. The heavy attestation ritual of §3 is written for uploads about *other people*; applied at the front door of the flagship product it is both nonsensical ("the person whose DNA this is" is the reader) and a direct violation of the simplicity mandate. **Hard cap:** no more than 3 screens and no more than 1 consent decision per screen between `/uploads` and the first transmitted byte.

##### 2.6 Class (b): inviting another adult

1. The account holder chooses "Someone else's DNA, with their permission", signs `consent.upload-other-adult` under Tier 2 friction (§3), and enters the subject's email address. `subject_invitations` (`id`, `inviter_user_id`, `subject_id`, `email_encrypted`, `email_hash`, `token_hash`, `state`, `sent_at`, `responded_at`, `expires_at`, `refusal_recorded`). The address is held **encrypted at rest** in `email_encrypted` using an envelope key held outside the database and rotated annually, because every later commitment in this flow — the reminder, the refusal confirmation, the expiry notice, the 30-day re-notice — requires sending mail to it, and mail cannot be sent to a hash. `email_encrypted` is destroyed 30 days after the invitation reaches a terminal state, leaving `email_hash` (HMAC-SHA-256, server-side key) for the 365-day bar. The plaintext address is never rendered to the inviter and never returned by any API.
2. The file may be uploaded immediately but is `analysis_state = quarantined`: encrypted at rest, no parsing, no variant extraction, no reports, no Copilot, no ancestry, invisible in every list except one row: `"Waiting for {label} to confirm. Nothing has been analysed."`
3. The invited person receives one email and at most one reminder after 7 days: who invited them, what was uploaded, what would be computed, the full text of `consent.subject-adult`, an **Accept** route, a **Refuse** route, and `"If you do nothing, this file is deleted automatically on {date} and no analysis ever happens."`
4. **Accept** requires them to create or sign in to their own account, sign `consent.subject-adult`, and set their own purpose grants. The inviter cannot set them.
5. **Refuse** requires no account: one token-authenticated click. `subjects.frozen_at` is set within 60 seconds, derived data deleted within 24 hours, the source file within 7 days, both parties emailed.
6. **Expiry** at 30 days: identical purge, with notice to both parties.
7. **Revocation** by the subject at any time, from their own account, one click, same 60-second/24-hour/7-day cascade. The subject's revocation always wins. The subject may also **take ownership**: a "Move this to my account" action transferring `subjects.owner_user_id` and all derived data, leaving the inviter with nothing.
8. **The 365-day bar is global.** A refusal, revocation or auto-purge recorded against an `email_hash` blocks any invitation to that address **by any account** for 365 days — not merely by the same inviter. A per-inviter bar is defeated by a second account the next day, which defeats the only protection the refusing adult has. Because the HMAC key is server-side and the hash deterministic, the global check is a single index lookup. Inherit emails the refuser each time an invitation is blocked on their behalf, so repeated attempts are visible to them.

##### 2.7 "Delete my data" and its one exception

The absolute promise and a dispute hold cannot both be true, and the published promise must be the one that governs. Resolution, stated in the user-facing direction:

> `"Delete my data removes everything, immediately and without exception — unless someone has told us this file is theirs and that they did not agree to it. In that one case we freeze it, analyse nothing, show nobody, and delete it within 90 days."`

That sentence appears on the delete page before the click. Outside that single frozen-dispute case, revoking the class artifact deletes the storage object, every `user_variants` row, every derived report, every export artifact and every ancestry result for that `subject_id` within 7 days, with a confirmation email. During a freeze the file is `analysis_state = frozen`: unreadable by any worker, unreachable by any account. No other category of Inherit-held genetic data survives a deletion request.

##### 2.8 Classes (c) and (d): embryo data

Preconditions, in this order, each a hard stop with its own screen: jurisdiction permits `embryo.upload` (§5) → account holder signs `consent.upload-embryo` (Tier 2 friction) → **both genetic parents evidenced** → `disclosure.insurance-and-discrimination` acknowledged → `charter.future-person` displayed in full and acknowledged → upload.

`embryo_records`: `id`, `subject_id`, `owner_user_id`, `cycle_label`, `embryo_label`, `parent_one_attestation_id`, `parent_two_attestation_id`, `single_parent_basis` (enum, nullable: `donor_gamete_anonymous`, `donor_gamete_identified_consented`, `parent_deceased`, `sole_legal_disposition_authority`), `single_parent_evidence_ref`, `uploaded_at`, `last_analysis_at`, `transferred_at`, `disposition` (enum `unknown`, `stored`, `transferred`, `donated`, `discarded`), `retention_expires_on`, `future_person_claim_key_hash`.

- **Preferred path, required wherever the other genetic parent is a living, contactable adult:** they are invited exactly as in §2.6 and sign `attestation.embryo-parentage` and `consent.upload-embryo` in their own account. Until then the data stays `quarantined`.
- **A bare two-parent attestation by one person is never sufficient and must not be offered in the UI.**

Edge cases, each with a named screen and a stored `single_parent_basis`:

- **Anonymous gamete donor:** permitted. The donor is not a consenting party and must not be treated as one. Screen states: `"A gamete donor cannot consent here and has not. Inherit will not attempt to identify a donor, and will not report on relatives found in your data."` Donor-conceived-person implications are disclosed in `charter.future-person`.
- **Identified donor:** may optionally be invited as a subject. If they refuse, analysis proceeds on the anonymous-donor basis, and any feature attributing a variant to the donor specifically is disabled.
- **Deceased genetic parent:** permitted only with a death certificate in a restricted bucket and a recorded human review in `legal_reviews`. Automated approval is forbidden.
- **Sole disposition authority:** permitted only with the clinic's or court's disposition-authority document and a recorded human approval. Screen states: `"Inherit is not able to judge a family dispute. If the other genetic parent tells us they object, we stop and delete."` A recorded objection from anyone asserting genetic parentage freezes the record within 60 seconds pending review; an unresolved review at 30 days defaults to deletion.
- **Contested parentage or a disclosed active legal proceeding:** upload blocked outright.

---

#### 3. Verification versus attestation

Inherit states plainly on `/legal/consent/consent.upload-other-adult` and on the upload screens: `"We cannot verify who you are or whose DNA this is. What we can do is make it impossible to do this by accident, keep a permanent record of exactly what you told us, and give the other person a real way to stop it."`

**What is verified.** Exactly two things: control of a mailbox, and the presence and human review of a document where §2.8 requires one. Nothing else. In particular, Inherit **does not verify that the person accepting a class (b) invitation is the subject** — the uploader nominates the address, so an uploader with a second mailbox can satisfy every step of the flow. `consent.upload-other-adult` and `consent.subject-adult` must both carry, verbatim: `"We cannot check that the person accepting this invitation is the person whose DNA this is."` The §1 table's class (b) basis cell is read subject to this sentence. Claiming otherwise would be the section's own version of the failure it exists to prevent. (Billing country is not a verification signal: Inherit takes no payment, so no billing country exists.)

**Three operable mitigations, each testable:**
1. Where the accepting account was created from the invitation link, no analysis begins for **72 hours**, and a second independent notice is sent to the address at that boundary.
2. `family.portrait`, `export.share-link` and every relative-visible output are disabled for a class (b) subject until that subject's account has signed in at least once from a session not originating from the invitation link.
3. A plain, unconditional re-notice is sent 30 days after acceptance, restating the one-click revoke. Failure to send it blocks further analysis for that subject.

**What is attested (recorded, unverifiable):** the account holder's identity; the subject's age; the relationship to an embryo; disposition authority; the truthfulness of any single-parent basis.

**Tier 2 friction (classes b, c, d only).** Each attestation screen: presents each factual statement as its own checkbox with its own sentence (no select-all); requires the account holder to type a name into a field labelled `Type your full legal name to sign`, which must be non-empty and contain at least two whitespace-separated tokens of ≥ 2 characters, stored in `attestations.typed_name` — there is **no** match against `profiles.display_name`, because an "or update it" fallback accepts any string and is not a check at all; **stamps the date server-side** (the user types no date — a hand-typed `YYYY-MM-DD` is a known usability and accessibility failure and adds nothing); keeps submit disabled until every element is individually actuated; and displays immediately above the control, at body type size: `"Signing this when it is not true is a false statement you are making to us and to the person whose DNA this is. It may be a criminal offence where you live, and you agree to cover our costs if it causes harm."`

**No dark patterns, measured.** Refuse and Accept are rendered as the same component variant, in the same container, with **Refuse first in DOM order**. Measured on the rendered DOM at exactly 1280×800 and 390×844, in both light and dark themes: each control's text-to-own-background contrast per WCAG 2.2 relative luminance is ≥ 4.5:1; `max(ratioA, ratioB) / min(ratioA, ratioB) ≤ 1.2`; computed `font-size` values differ by ≤ 2 CSS pixels; bounding-box areas are within 1.25× of each other; neither control carries `autofocus` or `aria-hidden`; both are fully within the viewport whenever the submit control is. No pre-ticked boxes anywhere.

**What is logged.** Every attestation writes to `attestations` (`id`, `user_id`, `subject_id`, `artifact_key`, `artifact_version`, `body_sha256`, `statement_keys text[]`, `typed_name`, `signed_at`, `ip_prefix_hash`, `user_agent_hash`) and appends to the ledger (§6.6).

**Contradictions.** A contradiction is: an invited subject refusing or revoking; a person asserting they are the subject and did not consent; a person asserting genetic parentage and objecting; a documentary conflict found in review. On any contradiction: freeze within 60 seconds; notify both parties within 24 hours; delete derived data within 24 hours and the source file within 7 days, unless the §2.7 dispute freeze applies (maximum 90 days, then delete); write a row to `attestation_contradictions` (`id`, `user_id`, `subject_id`, `kind`, `raised_at`, `resolved_at`, `outcome`). On a second contradiction row for the same `user_id`, set `profiles.non_self_upload_suspended_at` (timestamptz, nullable, added by this section), permanently blocking that account from uploading any subject other than themselves, with an appeal address on `/legal/appeals`.

**Blocked outright, whatever is attested:** a subject under 18; a deceased subject outside `/legal/deceased`; an `email_hash` under the global 365-day bar; an embryo without two evidenced parents or a reviewed single-parent basis; any feature closed by jurisdiction; a source the account holder declares they obtained without the subject's knowledge; anyone declared to be an employee, job applicant, insurance applicant, tenant, student, or a person the account holder is in litigation with.

---

#### 4. The Future Person Charter

Stated as a general property of the category, attributed to no one: **a person conceived from a screened embryo can acquire a lifelong genetic record created before they were born, held under a contract they were never party to, with no published retention limit and no published route by which they can ever obtain, correct or delete it.** A widely-sold competing product's embryo consent expressly contemplates the resulting child, warns of psychological harm and of difficulty obtaining life, disability and long-term-care insurance for that child — and then gives the child nothing, its only child-facing provision letting a parent exercise rights on the child's behalf.

Inherit's answer is `charter.future-person`, published at `/legal/future-person`, versioned like every artifact, and incorporated into `consent.upload-embryo`.

**The six rights, published verbatim and in this order:**

1. `"The record is yours. When you turn 18, you can ask us for everything we hold about the embryo you came from — every result, and the full record of who agreed to what — free, in a format you can read and a format a scientist can read. We will not include your parents' own DNA results unless they agree separately, because those are also about them."`
2. `"You can have it corrected."`
3. `"You can have it deleted, completely, and we will do it within 30 days. You do not have to give a reason. Nobody, including your parents, can stop you. We keep one line saying a deletion happened, with no name and no identifier that points back to you."`
4. `"You can tell us never to analyse it again, and keep the copy you have."`
5. `"We will never sell it, never share it with an insurer, an employer or a school, and never send it to an outside AI company, and never hand it to anyone without a court order we have first tried to resist."`
6. `"We keep the record until you are 20. After that, if nobody has claimed it, we delete it — because keeping a genetic record about someone who has never asked for it is worse than losing it. Claim it any time before then, free, at /future-person/claim."`

Right 1's boundary clause is required: an embryo genome inherently discloses both genetic parents' genotypes, and §7's rule that a genome is never released in a form disclosing a living relative's genotype without consent would otherwise contradict the promise at the moment a claim succeeds. **The claim release contains exactly:** the embryo record's variant calls, every report derived from it, the `consent_signatures`, `attestations` and `legal_audit_log` slices for that `subject_id`, and the provenance record. It contains no `user_variants` row belonging to any other `subject_id`.

Right 6 carries the closing date rather than appending a qualifier to right 1, so each right stays one readable sentence; the two are alternative fixes for the same gap and only one is adopted.

**Third-party enforceability.** `consent.upload-embryo` and `/terms` must contain an express third-party-rights clause naming the person who may be born from the embryo as an intended beneficiary entitled to enforce rights 1–6, and, for England and Wales, an express statement that the Contracts (Rights of Third Parties) Act 1999 applies to that clause and is **not** excluded (standard terms normally exclude it). L-40 requires the reviewer to confirm the enforcement route is effective in their jurisdiction or to record the alternative device used there.

**Retention, enforced by a scheduled job with a passing test:**
- `disposition` in (`stored`, `unknown`): `retention_expires_on = coalesce(last_analysis_at, uploaded_at) + 24 months`. The `coalesce` is required; a record that was never analysed otherwise has no expiry and is kept forever.
- `disposition` in (`donated`, `discarded`): deletion 90 days after the disposition is recorded.
- `disposition = transferred`: state `reserved_for_future_person`. Parental access continues; no new analysis unless a parent re-enables it; retained until `(transferred_at + 18 years + 9 months) + 24 months`, then deleted if unclaimed. A parent may delete earlier, and the Charter says so.
- **Notice before deletion** goes to every evidenced genetic parent with a live account **and** the account holder, 30 days before deletion — not "both parents", which is impossible for every `single_parent_basis` record. Where only one such person exists, that one is notified and the fact is logged.
- At `transferred_at + 17 years`, and again 90 days before `retention_expires_on`, Inherit notifies the record's `owner_user_id` that the claim window is opening or closing, restating the claim URL. Subject line: `"The record from your embryo cycle: what happens next"`. Failure to send blocks the deletion until the notice is sent or the address is proven undeliverable. Both notices write ledger events.
- No embryo record may be retained on the basis of internal analysis, product improvement, or a de-identified derivative. **De-identified or aggregated derivatives of embryo data must not be created at all.** **Anti-pattern:** a competing product's privacy policy places de-identified and aggregated derivatives outside the policy entirely, so no retention or deletion commitment reaches them.

**The claim route.** `/future-person/claim` is public, needs no account, is linked from `/legal` and reachable with no prior relationship with Inherit. Parents receive a printable one-page **Record Key Card** at upload time carrying a 20-character claim key (stored only as `future_person_claim_key_hash`), the URL, and the deletion date in words and as an ISO date. The Charter instructs parents to keep it for the child.

Two adversarial concerns pull in opposite directions here — that a keyless route has nothing stored to match against, and that a keyless route on a public page is the section's largest unauthorised-disclosure channel. Resolution: **keep a keyless route, but give it stored fields and a documentary standard.**

- Table `future_person_identity` (`subject_id`, `child_date_of_birth`, `child_place_of_birth`, `parent_names text[]`, `supplied_at`), optional, supplied by a parent at or after transfer under artifact `consent.upload-embryo` version ≥ current, in a restricted bucket. It holds no genetic data.
- With the Key Card: the key alone identifies the record.
- Without it: the claim requires a government-issued photo identity document **and** a birth record, matched against `future_person_identity` by a named human reviewer recorded in `future_person_claims.reviewer`; plus a mandatory 30-day notice to the record's `owner_user_id` before any release, with an objection route that suspends release pending human review.
- Where no parent ever supplied `future_person_identity`, the page says so plainly: `"Without the Record Key Card we cannot tell which record is yours, and we will not guess."`
- A claim can never release data about any `subject_id` other than the embryo record claimed. `future_person_claims` (`id`, `claim_reference`, `submitted_at`, `state`, `resolution`, `resolved_at`, `reviewer`). Acknowledgement within 5 business days, resolution within 30 days. The refusal standard is published on `/future-person/claim` **before** the form. `claim.received` and `claim.resolved` are written to the ledger. Claim volumes are published annually with the law-enforcement transparency report.

**Published before, not after.** The public marketing routes `/family` and `/embryo-analysis` carry, above the fold and before any sign-in wall, a 120-word-maximum panel headed `"If a child is born from this"` linking to `/legal/future-person`.

---

#### 5. Jurisdiction gating

##### 5.1 Determination

`jurisdiction_decisions` (`id`, `user_id`, `declared_country`, `declared_region`, `signal_network_country`, `effective_country`, `method`, `decided_at`, `superseded_at`). Resolution order: (1) the country the user declares at account creation from a required select with no default and no pre-selection; (2) network-derived country as a **challenge signal only**; (3) where they conflict and the user has not reconfirmed, **default-deny**. There is no billing signal.

Restrictiveness is computed **per feature key, not per country**: for each feature, `allowed` is the logical AND across all candidate countries. A total order over countries does not exist and must not be assumed. The user is shown which country is being applied and how to correct it. Changing the declared country requires re-signing `policy.jurisdiction` and imposes a 24-hour cooldown before any newly unlocked feature becomes available. **If the jurisdiction cannot be determined, every feature in the restricted set is off.**

##### 5.2 The restricted feature set

Feature keys: `embryo.upload`, `embryo.analysis.disease`, `embryo.analysis.trait`, `embryo.sex.display`, `family.portrait`, `family.heritability`.

Rules live in `src/lib/legal/jurisdictions.ts` as rows of `{ country, feature, allowed, basis, citation, verified_on, user_facing_copy }`. Every row carries a citation and a `verified_on`; CI fails on either missing, warns at 300 days, fails above 365.

- **United Kingdom, split per feature** — the polygenic basis does not reach monogenic testing and must not be used to justify a rule about it. `embryo.analysis.trait` and `embryo.sex.display`: `allowed = false`; basis — embryo testing is permitted only for the exhaustive purposes in Schedule 2, paragraph 1ZA(1) of the Human Fertilisation and Embryology Act 1990, and the Human Fertilisation and Embryology Authority stated that polygenic embryo screening does not fit within any permitted purpose and is therefore unlawful, confirming a position taken in September 2025; licence condition T88 bars transfer of an embryo subjected to an unauthorised genetic test, so analysis performed abroad does not cure the illegality. Citation: `Human Fertilisation and Embryology Authority, "PGT-P is not lawful in the UK", 4 February 2026; HFE Act 1990 Sch. 2 para. 1ZA(1); HFEA licence condition T88`. `embryo.upload` and `embryo.analysis.disease`: `allowed = false` on a **separately stated Inherit policy basis** — reporting on embryos to UK patients is licensable activity Inherit does not hold a licence for. Citation: `Inherit policy §5.3`. User-facing copy: `"Polygenic embryo screening is not lawful in the UK, and the regulator has said so directly — having the analysis done abroad does not change it. Inherit is not licensed to report on embryos in the UK either, so we do not offer embryo analysis here at all."`
- **Ireland** — all `embryo.*` off. Basis: embryo testing confined to registered diseases caused by single-gene or chromosomal variants. Citation: `Health (Assisted Human Reproduction) Act 2024, s.45`.
- **Czech Republic** — `embryo.analysis.trait` off (no listed permitted purpose reaches non-medical trait selection); `embryo.upload` and `embryo.analysis.disease` off pending L-40, on an Inherit-policy basis, citation `Inherit policy §5.3`.
- **Germany, Switzerland, Italy, Spain, Canada, India** — all `embryo.*` off. Basis: criminal or licence-based prohibitions on sex selection and on unjustified embryo testing. India additionally: `Pre-conception and Pre-natal Diagnostic Techniques (Prohibition of Sex Selection) Act 1994`, under which non-medical sex selection is a criminal offence.
- **United States** — `embryo.upload` and `embryo.analysis.disease` `allowed = true` after L-40; no federal statute restricts preimplantation testing, and state embryo-personhood law is the only meaningful overlay, reviewed per state at L-40. `embryo.analysis.trait` and `embryo.sex.display` remain off by Inherit policy (§5.3).
- **Every other country** — default deny for all `embryo.*`: `"We have not yet had a lawyer in your country review whether this is lawful there, so we have not turned it on. We would rather be slow than wrong."`
- **`family.portrait` and `family.heritability`, `default` row: `allowed = true`.** Basis: `"No jurisdictional restriction identified; these analyse only the genomes of consenting adults and are not embryo testing. Inherit product policy applies."` Citation: `Inherit policy §5.3`. Gate check 8 accepts an Inherit-policy citation for a feature with no statutory overlay. Without these rows the default-deny rule silently switches off an entire mandated product domain in every country, including the United States. Country rows may override; none is encoded at launch. Independently of these rows, both keys stay off until L-40 records Family sign-off (§0).

##### 5.3 Inherit's own positions, in every jurisdiction

Published on `/legal/where-inherit-works` under "Things we will not do anywhere":

- **Sex disclosure.** `"Inherit never shows or infers the sex of an embryo, in any country, including countries where it is legal. Sex is not a health risk, and a tool that reports it becomes a tool for choosing it."` No column, field, filter, sort key or inferable derivative in any embryo surface or API response. An adult may see chromosomal sex derived from their own genome, on their own account, only.
- **No ranking, no trait selection.** `"Inherit does not rank embryos and does not compare embryos on traits such as height, weight, appearance or intelligence — anywhere, ever."` The comparison surface presents per-embryo findings for serious monogenic and chromosomal conditions with explicit evidence labels, side by side, in a stable order the user chooses, with no aggregate score, no ordering by predicted outcome, and no "best embryo" affordance. **Anti-pattern:** a widely-sold competing product presents embryos as sortable columns over rows of point-estimate deltas, including intelligence in "IQ points" and height in inches. Inherit must contain no equivalent surface.
- **No selection advice.** `"Inherit will never tell you which embryo to transfer, keep, donate or discard."`

##### 5.4 Disclosure before effort

The applicable restriction is visible (i) on the **public** `/embryo-analysis` and `/family` marketing routes without sign-in, as a country-aware notice; (ii) as a permanent, non-dismissible line on the feature card at `/dashboard/family` and `/dashboard/embryo-analysis`; (iii) as the first screen of the flow. It must never first appear inside a consent, the Terms, or any screen after upload.

**Route separation (mandatory, else the build fails).** `src/app/(marketing)` and `src/app/(app)` are Next.js route groups that both resolve to `/`, so the same path cannot exist in both. Public marketing pages are `(marketing)/family` and `(marketing)/embryo-analysis`. Authenticated product routes are `(app)/dashboard/family`, `/dashboard/family/heritability`, `/dashboard/family/portrait`, `/dashboard/embryo-analysis`, `/dashboard/embryo-analysis/upload`, `/dashboard/embryo-analysis/compare`. Copilot is the existing `/chat`, and `/chat/s/[subjectId]` when scoped to one subject; the Family and Embryo domains link into those paths rather than duplicating them. Every rule in this section attaches to the exact paths named here.

---

#### 6. Liability

##### 6.1 Informational, not a medical device

Inherit is an informational tool. It is not a medical device, does not diagnose, and no result is reviewed by a clinician. The point-of-display string, verbatim: `"This is not a diagnosis. Inherit is not a doctor and no clinician has reviewed this. Talk to a qualified professional before acting on anything here."`

It renders on: `/reports/[slug]`, every polygenic score display, `/ancestry`, every Copilot answer (adjacent to the answer, not only in a system disclaimer), `/dashboard/family/portrait`, `/dashboard/family/heritability`, `/dashboard/embryo-analysis/compare`, `/dashboard`, the top of the export README, the footer of every generated PDF, and the first screen of every upload flow.

The Terms must not hold two positions on this. **Anti-pattern:** a competing product's terms state in capitals that nothing is intended for medical diagnosis and that results are not reviewed by physicians, while the same corpus elsewhere asserts the products are physician-ordered and reviewed, and relies on that assertion to justify retaining a customer's sequencing file after deletion.

**Enforcement is lexical, not semantic.** "Affirmative use" and "other than in a negation" cannot be decided by any grep and will be tuned until they stop firing. Instead, `data/legal/allowed-sentences.json` holds the exact permitted sentences containing each controlled token — `diagnos*`, `physician-ordered`, `clinically validated`, `FDA`, `medical advice` — and the gate fails on any occurrence outside an allowlisted sentence or a `data-legal-verbatim` region. The allowlist at launch contains exactly: the point-of-display string above; `"Inherit is not an FDA-cleared or FDA-approved device, and nothing here has been reviewed by the FDA."`; `"Inherit is not a HIPAA covered entity and not a business associate."`; and the sentences of `/legal/gina` and `/legal/state-genetic-privacy` that quote statutory language, which sit inside `data-legal-verbatim`.

##### 6.2 Warranty, limitation, and where the limits do not apply

`/terms` §7–§8 state the exclusions **and**, in a subsection headed `"Where these limits do not apply to you"`:

- **United Kingdom, consumers:** liability for death or personal injury caused by negligence, and for fraud or fraudulent misrepresentation, cannot be excluded — Consumer Rights Act 2015 s.65(1). Consumers also retain the statutory rights in ss.49 and 57, which cannot be contracted out of. (Unfair Contract Terms Act 1977 s.2(1) is cited **only** in any business-facing terms; since 1 October 2015 it does not apply to consumer contracts.)
- **EU:** consumers are protected against unfair terms under Directive 93/13/EEC as transposed; an unfair term does not bind them.
- **Australia:** the ACL consumer guarantees are retained; s.64 renders exclusions void.
- **US:** state unfair-and-deceptive-practices statutes are not waivable by contract.
- `"If any of these limits is not allowed where you live, it simply does not apply to you, and the rest still stands."`
- Because Inherit charges nothing, any liability cap is a **fixed sum stated in the Terms**, never "the amount you paid" (which is zero and likely unconscionable in several jurisdictions). Counsel sets the figure at L-40; a non-zero figure must be present.

##### 6.3 Indemnity for false attestations

The account holder indemnifies Inherit against claims arising from a false attestation about a subject's age, identity, consent, parentage or disposition authority, and against claims by a subject uploaded without permission. The section immediately states its own limit: `"Where you are a consumer, this indemnity only covers claims caused by your own deliberate false statement, and does not apply to anything you got wrong honestly."` L-40 confirms enforceability per jurisdiction; the term is disabled where counsel advises it is void.

##### 6.4 AGPL and self-hosting

`/legal/self-hosting` (artifact `policy.self-hosting`), linked from `/terms` §5 and the README:

- Inherit is AGPL-3.0. Licence sections 15 and 16 disclaim all warranty and liability for the software as distributed.
- `"If you run your own instance and other people use it, you are almost certainly the controller of their data under GDPR, and you — not this project — carry every obligation that follows. Whether GDPR applies to you at all depends on your circumstances; get your own advice."` Controllership turns on who determines purposes and means; a purely personal or household deployment may fall outside GDPR entirely, and a deployment run on another organisation's instructions may be a processor. The operational list is unchanged: lawful basis, consents, jurisdiction gating, breach notification and compliance are the self-hoster's.
- The project operators are not responsible for any third-party deployment and have no access to it.
- **Brand restriction, scoped to what trademark law reaches:** a self-hoster must not use the name "Inherit", the inherit.bio domain, or the logo and wordmark files. Those files live in `/public/brand` under a separate `LICENSE-BRAND`. The page states expressly that **the stylesheet, design tokens, `.display`/`.eyebrow`/`.accent` utilities and every component in `src/components/ui` may be reused freely under AGPL-3.0** — AGPL-3.0 §10 forbids imposing further restrictions on the exercise of granted rights, so a terms clause forbidding reuse of licensed CSS would be void and must not be written. The requirement is only that a deployment not present itself as operated or endorsed by the project. A `SELF_HOST_BRANDING` configuration surface makes site name, footer attribution, contact addresses and the law-enforcement and deceased-customer contact points a config step, not a code edit.
- AGPL §13 requires network operators to offer corresponding source; the shipped footer carries a source link a self-hoster must repoint rather than remove.

##### 6.5 Acceptable use

`/terms` §6, enforced by suspension: no uploading a person's DNA without that person's own consent recorded in Inherit; no screening of employees, job applicants, tenants, insurance applicants or students; no identifying an anonymous gamete donor or an unknown biological relative without their consent; no re-identification attempts; no surveillance, immigration determination or forensic identification; no non-medical sex selection; no reselling outputs as a clinical or diagnostic service; no scraping of report content.

##### 6.6 The record that would be evidence

`legal_audit_log`: `id`, `seq` (monotonic), `occurred_at`, `actor_user_id`, `subject_id`, `event_type`, `artifact_key`, `artifact_version`, `body_sha256`, `payload_digest`, `prev_hash`, `row_hash` (SHA-256 over the canonical serialisation including `prev_hash`). Event types at minimum: `consent.signed`, `consent.revoked`, `purpose.granted`, `purpose.revoked`, `attestation.recorded`, `invitation.sent`, `invitation.accepted`, `invitation.refused`, `invitation.expired`, `invitation.blocked`, `jurisdiction.decided`, `jurisdiction.changed`, `feature.blocked`, `contradiction.raised`, `record.frozen`, `record.deleted`, `claim.received`, `claim.resolved`, `claim.window.notified`, `disclosure.acknowledged`, `legal_document.published`.

Triggers block `UPDATE` and block `DELETE` **except** by a single `security definer` retention function, which is the only permitted deleter and whose every invocation is itself logged. Retention: 7 years. **On deletion of a subject or an account, ledger rows are pseudonymised in place** — `actor_user_id` and `subject_id` are replaced by a one-way tombstone id, every other column retained — rather than kept intact for seven years, which would contradict Charter right 3. Right 3 states the residue in its own text. The ledger stores hashes and identifiers, never genetic data. Chain integrity is verified nightly and by **L-33**.

##### 6.7 Incident and breach response

`/legal/incident-response`. A written runbook at `docs/incident-response.md` with named roles; assessment started within 4 hours of a credible report; supervisory-authority notification within 72 hours where GDPR Article 33 applies; individual notification without undue delay where Article 34 applies; separate notification to state attorneys general on applicable US timelines; a security contact and PGP key at `/.well-known/security.txt`; a dated incident history page listing every incident including those with no confirmed data loss, stating `"No incidents to report"` with a date when there are none. Where the affected subject is not the account holder (classes b, c, d), Inherit notifies the **subject** directly; where a future person has made a claim, Inherit notifies them too.

##### 6.8 Insurance

`docs/insurance.md` (internal) records the required cover: technology errors-and-omissions and cyber liability with a genetic-data endorsement and regulatory-defence sublimit; media liability; general liability; directors-and-officers cover; a coverage territory naming every jurisdiction where features are enabled; and a stated position on whether AGPL distribution of the code is within or outside the policy. **Procurement is recorded as a human-signed row in `LEGAL-SIGNOFF.md`** (insurer, policy number, coverage territory, inception date), subject to the same no-agent-may-write rule as L-40. There is no automated test asserting the presence of strings in a markdown file, because such a test proves only that an agent typed them.

##### 6.9 Advertising law

For a service like this the live exposure is advertising law, not device law. The FTC's Health Products Compliance Guidance applies by its terms to diagnostic tests, requires competent and reliable scientific evidence in hand before dissemination for every objective claim, assesses claims by the advertisement's **net impression as a whole**, treats hedges such as "may" or "preliminary" as inadequate qualifiers, and reaches press releases, interviews, social posts and a company's own machine-readable marketing files.

Inherit's answer is `data/claims.json`: `{ claim_id, text_verbatim, surfaces[], claim_type: "objective"|"descriptive", evidence: [{citation, doi_or_url, accessed_on, what_it_supports}], net_impression_note, reviewed_on, reviewer }`.

- Every numeric, comparative or performance claim on a route in `MARKETING_ROUTES` (§9) carries `data-claim-id` in the markup; the gate fails on any claim-shaped string (a number followed by `%`, `×`, or the words "more", "better", "accurate", "predicts") lacking one.
- A claim whose only support is a hedge is forbidden. The register records why the **net impression** of the surrounding page is accurate, not merely whether the sentence is literally true.
- **Comparative claims about Inherit versus any other product are forbidden**, named or unnamed. This is a claim rule about Inherit's own marketing copy; it does not touch the factual provider directory (§9, carve-out).
- **Counting rules.** A headline count of conditions, genes or reports must state exactly what is counted and must never merge categories of different evidentiary standing. **Anti-pattern, with the arithmetic derived from the two figures named:** a widely-sold competing product headlines "2000+" on a page selling an embryo product, where that figure is the parents' monogenic carrier panel (roughly 2,157 released reports) and the embryo product itself returns roughly 35 polygenic reports — an overstatement of the relevant figure by roughly 57× (2,000 ÷ 35). Inherit displays each layer's count separately, labelled, on the same surface, never as one merged number. This ratio is itself a numeric claim and carries a `claim_id` with a citation and an `accessed_on` date.
- Testimonials, if ever used, carry the generally-expected-results and material-connection disclosures.

---

#### 7. Privacy law surface

**Pages to update, each re-versioned with a new `effective_on` and a diff from the prior version:** `/privacy`, `/terms`, `/legal/gina`, `/legal/deceased`, `/legal/law-enforcement`, `/legal/research-consent`.

**New pages:** `/legal` (hub), `/legal/consents`, `/legal/consent/{key}` plus version and diff routes, `/legal/future-person`, `/legal/where-inherit-works`, `/legal/insurance-and-discrimination`, `/legal/self-hosting`, `/legal/incident-response`, `/legal/appeals`, `/legal/state-genetic-privacy`, `/legal/gdpr`, `/future-person/claim`.

**Footer discipline.** This section adds more than twenty public routes to a product whose brief demands more white space. They are therefore reachable through **one hub at `/legal`**, which lists every legal, consent and policy route with a one-line description. The **site footer is capped at 8 anchor elements**, one of which is "Legal and consent" pointing at `/legal`, plus the AGPL source link. Gate check 4's reachability target is the hub, not the footer.

**Third-party recipients — the accurate statement.** Inherit has exactly one class of third-party recipient of genome-derived content: a cloud model provider the user names and enables under `copilot.cloud`. That provider is named individually in `consent.copilot-cloud-model` and in `consent_grants.provider_key`; adding any other recipient is a new artifact version. `export.share-link` transmits genetic data to **no** recipient: it produces a link the user controls, served from Inherit, revocable in one click, and Inherit sends nothing to anyone on the user's behalf.

**Cloud Copilot is restricted by subject class.** `copilot.cloud` is unavailable for any `subject_id` whose class is `other_adult`, `embryo_own` or `embryo_third_party`. Copilot over those subjects is **local-model only**, and the Copilot surface in the Family and Embryo Analysis domains renders a permanent line: `"For anyone's genome but your own, Copilot only runs on a model you host yourself. Nothing leaves Inherit."` The same sentence appears in `charter.future-person` (right 5), so the promise and the mechanism match. Without this, one toggle would send an embryo's genome — and therefore both genetic parents' genotypes and the future person's lifelong record — to an outside company.

**GINA (`/legal/gina`).** Title I bars group health plans and issuers from using genetic information in underwriting or requiring a test. Title II, effective 21 November 2009, bars employment discrimination but only by employers with fifteen or more employees, taking "employer" from s.701(b) of the Civil Rights Act of 1964, and excludes the uniformed services. **Neither title reaches life, disability or long-term-care insurance** — the products where a result is most likely to be used against someone. GINA constrains employers and health plans, not testing companies. Under Title II "genetic information" expressly includes any request for or receipt of genetic services (42 U.S.C. § 2000ff), so **participating at all is itself genetic information**; this gets a sentence of its own. The page states that Inherit has no employer channel, will never create one, and will never invoice, bill or report participation to an employer or insurer.

**US state genetic-privacy statutes (`/legal/state-genetic-privacy`).** A table, each row with statute, enforcement route, remedy and `verified_on`: Illinois GIPA, 410 ILCS 513 — private right of action under §40(a), greater of actual damages or $2,500 (negligent) / $15,000 (intentional or reckless) plus fees; §15(a) makes results confidential and releasable only under a specific written authorisation meeting §30(a)(2); SB 2886 (2026) extends the Act to biomarker testing from 1 January 2027. Texas Health & Safety Code ch. 174 (2025) — private cause of action, greater of actual damages or $5,000 per violation, plus AG at $10,000. Wyoming, W.S. 35-32-101 to -105 (2022) — private action after a 60-day cure period, plus AG. Nevada, NRS 629.101–629.201 — private action and misdemeanour liability. Washington My Health My Data, RCW ch. 19.373 (genetic data from 31 March 2024) — private action via the Consumer Protection Act. California GIPA, Civ. Code §§ 56.18–56.186 — public enforcement, $1,000 negligent, $1,000–$10,000 wilful, paid to the individual. Florida, Fla. Stat. §§ 760.40 and 817.5655 — criminal; a second-degree felony to sell or transfer another person's DNA sample or results. Also named: Arizona, Utah, Virginia, Alabama, Maryland, Tennessee, Nebraska, Montana, Kentucky, South Dakota (effective 1 July 2026) and Minnesota § 13.386.

Two binding design consequences: (i) **authorisations name recipients, not categories.** Several statutes require a specific written authorisation identifying the third party; category-level permissions such as "clinicians involved in your care" do not clearly satisfy them. The single cloud-model recipient is named individually. (ii) **Written-authorisation requirements are built to the strictest standard everywhere**, never branched by state. **Anti-pattern:** a competing product's consent flow branches on exactly one jurisdictional boundary, and its privacy policy names no genetic-specific statute other than California's.

**GDPR (`/legal/gdpr`).** Genetic data is special-category data under Article 9. The page and the Privacy Notice must state: the Article 6 basis (6(1)(a), consent) **and** the Article 9 condition (9(2)(a), explicit consent) for each purpose, in a table keyed by `purpose_key`; the controller's identity and contact details; a named DPO with a working contact address; an Article 27 representative in the Union **and** one in the UK, each named with a postal address, wherever Inherit is available in those territories; the published DPIA summary for embryo and family features; transfer mechanism and actual destination countries; and data-subject rights with the response deadline. **Anti-pattern:** a competing product serving seven European destinations designates no Article 27 representative in either territory, names no DPO, and identifies no Article 9 condition, listing only Article 6 bases.

**HIPAA — the honest answer.** `/privacy` states: `"Inherit is not a HIPAA covered entity and not a business associate. We do not bill insurance, we do not run a laboratory, and no clinician orders anything through us. That means HIPAA does not protect your data here — the protections you have are the ones in this policy, in the law of your state or country, and in the code, which you can read."` Inherit must not publish a covered-entity-style Notice of Privacy Practices, must not assert its analyses are protected health information, and must not use a HIPAA claim as a marketing signal. **Anti-pattern:** a competing product asserts in five signed consents that its analysis is protected health information and publishes a covered-entity-style notice, while reserving in its privacy policy that nothing there acknowledges the applicability or inapplicability of HIPAA, leaving customers unable to determine which regime applies. A consequence must be disclosed: Washington's MHMDA excludes HIPAA-covered PHI from its scope (RCW 19.373.100(1)(a)(i)), so a PHI assertion can remove the very data at issue from a statute that has a private route to court. Inherit makes no PHI assertion and does not rely on that exemption; the page says so.

**Law enforcement (`/legal/law-enforcement`).** The only honest form: Inherit will not disclose genetic data to law enforcement **except where compelled by valid legal process it has first attempted to resist**. No marketing surface may carry an unqualified non-disclosure claim. **Anti-pattern:** a competing product's binding privacy policy contains both a narrow promise conditioned on compelled process **and**, elsewhere in the same document, a broader discretionary reservation permitting sharing with courts, law-enforcement agencies, regulatory agencies and other public authorities as it believes necessary — while a marketing page lists "Government or law enforcement" on a "we do NOT share your data with" tile list. In fairness the conditional formulation is the honest one and no operator can promise to defy a valid court order; the defect is the unqualified tile and the second, wider reservation, not the qualified sentence. Inherit's corpus must contain exactly one position.

Concretely, the policy states that Inherit requires a warrant or equivalent judicial order for content and resists subpoenas for genetic data; notifies the affected person before complying unless legally barred, and as soon as any bar lapses; publishes an annual transparency report with numeric counts including explicit zeros for requests received, resisted and complied with, by requesting jurisdiction; applies the same policy to subjects who are not the account holder and to future-person records; and never voluntarily uploads data to, or permits matching against, any law-enforcement or forensic genealogy database.

**Deceased persons (`/legal/deceased`).** Extended to cover (i) an account holder's own data, (ii) a class (b) subject who dies, (iii) embryo records where a genetic parent dies, (iv) a future-person record. Default is non-disclosure. Requires a death certificate, proof of the representative's authority, and human review; a 30-day notice period before any disclosure; the deceased's own recorded wishes override the representative's request; and a genome is never released to a representative in a form disclosing a **living** relative's genotype without that relative's consent.

**Research (`/legal/research-consent`).** Inherit runs no research programme. The page keeps that statement and adds the binding rules for any future one: separate opt-in per purpose and per recipient class, never a single toggle; each recipient named; IRB or equivalent approval published; no embryo data and no class (b) data in any research programme, ever; revocation prospective with a published statement of exactly what cannot be recalled; and no research consent may operate as a licence for internal model development, which would require its own separate artifact — which §2.4 forbids outright.

**Relatives and mistaken subjects: a real route, not a regret.** `/legal/appeals` is a public, account-free objection route for two groups: a person asserting that an uploaded genome is theirs and they did not consent, and a genetic relative objecting to relative-visible processing. On a relative objection: within 60 seconds, relative-matching, relative-visible surfaces and any shared-segment output are disabled for the objecting person's identifiers **across all accounts**; a `contradiction.raised` row is written; the objector receives written confirmation of exactly what was switched off.

---

#### 8. Insurance and discrimination disclosure

Artifact `disclosure.insurance-and-discrimination`, page `/legal/insurance-and-discrimination`, required as one acknowledgement **before the first analysis of any subject**, once per subject, and reachable publicly without sign-in from `/`, `/reports`, `/family` and `/embryo-analysis`. Maximum 300 words. The summary block scores ≤ 8.0 (§2.2). An "I understand" control that is not pre-ticked.

**Layout rule, cashed out:** at a 1280×800 viewport, default zoom, the site's base type scale, `document.documentElement.scrollHeight` ≤ 800, and the "I understand" control's bounding box fully within the first 800 px. The page renders without the global site header and footer.

Required content, in plain language:

1. `"A genetic result can be used against you. GINA stops health insurers, and employers with 15 or more staff, from using it. It does not cover smaller employers, and it does not stop life insurance, disability insurance or long-term care insurance companies. No federal law does."`
2. `"Your result is also information about your parents, your siblings, your children and people you have never met. They did not agree to this. If one of them wants us to stop, they can tell us at /legal/appeals without an account, and we will."`
3. `"Asking for a genetic test is itself genetic information under US employment law. Taking part can matter, not just the answer."`
4. `"If you are thinking about life, disability or long-term care cover, get advice about the order in which to do things before you look at your results."`
5. `"Some countries and some US states protect you more than others. See the list."` (link)
6. Embryo path only: `"A result about an embryo becomes, if a child is born, a fact about a living person who could not agree to it."` (link to `/legal/future-person`)

Acknowledgement writes `disclosure.acknowledged` to the ledger with the artifact version. No analysis job may be enqueued for a subject lacking an acknowledgement row at the current artifact version.

---

#### 9. The CI legal gate

`pnpm gate:legal` (`scripts/legal-placeholder-gate.ts`) runs in three modes — **source-scan**, **content-file** (over `content/legal/**`, `data/claims.json`, `src/lib/legal/jurisdictions.ts`), and **rendered-page** (`SERVER_URL`) — and is a required check on every pull request. No check may require a database; the content files are the source of truth and the database is seeded from them. Rendered mode additionally asserts each served artifact page matches its file's `body_sha256`. Two route constants are declared in `src/lib/legal/routes.ts` and referenced by name: `MARKETING_ROUTES` (`/`, `/about`, `/providers`, `/family`, `/embryo-analysis`, `/changelog`) and `LEGAL_ROUTES` (every route in §7 plus every artifact, version and diff route). The gate must complete in under 60 seconds on the tracked tree.

1. **No placeholder text** — existing patterns, over `LEGAL_ROUTES`, `MARKETING_ROUTES` and their source, plus rendered-mode empty-bracket detection.
2. **Version and effective date** — every file under `content/legal/**` and every rendered artifact page exposes a non-empty `Version {n}` and a valid ISO `Effective` date; fails on any artifact body reachable in the app with no backing file.
3. **Change summaries and diffs** — every version ≥ 2 has a non-empty `summary_of_changes` and a diff page returning 200.
4. **Reachability** — every route in `LEGAL_ROUTES` returns HTTP < 400 unauthenticated, renders > 800 characters of text, and is listed on the `/legal` hub. The rendered footer contains no more than 8 anchor elements.
5. **Reading level** — every artifact has a non-empty `data-legal-summary` block of ≤ 120 words scoring ≤ 9.0 (≤ 8.0 for `disclosure.insurance-and-discrimination` and `charter.future-person`), rendered above the full text; scored per §2.2 and compared against `tests/fixtures/reading-grade.json`.
6. **Claim register** — every claim-shaped string on `MARKETING_ROUTES` carries a `data-claim-id` resolving to a `data/claims.json` entry with at least one citation carrying an `accessed_on` date.
7. **Denylist.** Entries are stored in `scripts/legal/denylist.sha256` as salted SHA-256 hashes of lowercased **multi-token phrases** (a company name plus a qualifying token) or **exact domain strings**. Single common words are never entries: several names in this category are ordinary English or technical words that collide with routine identifiers and with copy this specification itself mandates, and a single-word rule would either fail on every branch or be silently weakened. At gate-configuration time, any candidate entry whose token appears more than 20 times in the tracked tree is **rejected as an entry**. Scope: `.ts`, `.tsx`, `.md`, `.sql`, `.txt`, and `.json` under `data/`; excluding `pnpm-lock.yaml`, `node_modules/` and `public/` binaries. Failure output prints file, line, byte offset and matched length — enough to locate, not enough to reintroduce. `scripts/legal/denylist-exceptions.sha256` holds hashed (phrase hash, file path) pairs a human may add with a one-line justification recorded in the file. **Honest limitation, to be stated in the script's header comment:** `LEGAL_DENYLIST_SALT` is committed, so the hashes are reversible by dictionary attack; hashing achieves obfuscation of the wordlist, not secrecy, and the exclusion property comes from the check, not the hash.
   **Remediation authority:** run the gate against the current tree and fix every file it reports. This document names no file as containing a denylisted token; the gate is the authority.
   **Carve-out, explicit:** `data/providers/providers.json`, the `/providers` route, `e2e/providers.spec.ts` and the corresponding acceptance-matrix row are a permitted factual third-party directory, exempt from the denylist and from §6.9's comparative-claims rule, on these conditions — every entry carries `source_urls` and a `last_verified_at` date; no evaluative adjective appears in any entry; and no entry compares Inherit to a provider. The denylist otherwise covers only Inherit's own marketing, product and legal copy.
8. **Commit messages** — the phrase check runs as a local `commit-msg` hook that blocks the commit before it exists. In CI the `git log --format=%s%n%b` scan is retained but exempts merge commits and commits not authored on the branch, and on failure prints the offending SHA and the exact `git rebase` command; `denylist-exceptions.sha256` may carry a hashed entry for an already-merged historical commit, since removing it would otherwise require force-pushing a shared branch.
9. **Jurisdiction coverage** — for every feature key in §5.2 and every country in the supported list plus `default`, `jurisdictions.ts` has a row with `allowed`, `basis`, `citation`, `verified_on`, `user_facing_copy`. Fails on a missing row, an empty citation, or `verified_on` older than 365 days; warns at 300. An `Inherit policy §5.3` citation is accepted for a feature with no statutory overlay.
10. **Forbidden embryo surfaces — structural, not lexical.** A single exhaustively enumerated response type `EmbryoFinding` is declared for every embryo surface, with permitted keys exactly: `embryo_label`, `condition_id`, `condition_name`, `finding`, `evidence_label`, `coverage_state`, `citation_ids`, `not_covered_reason`. A runtime schema assertion on every `/api/embryo/*` response rejects any key outside that list with HTTP 500 and a `feature.blocked` ledger row. The gate asserts that every file under `src/app/(app)/dashboard/embryo-analysis/**`, `src/components/embryo/**` and `src/app/api/embryo/**` imports that type and declares no other response shape, and that no file under those paths contains a sex-related identifier. The sex grep is scoped to those paths only, so the adult chromosomal-sex surface §5.3 permits does not trip it. A semantic rule ("no ordering key derived from a predicted phenotype") is not statically decidable and is enforced by the closed key list instead.
11. **Controlled medical tokens** — no occurrence of `diagnos*`, `physician-ordered`, `clinically validated`, `FDA` or `medical advice` on `MARKETING_ROUTES` or `LEGAL_ROUTES` outside an allowlisted sentence (§6.1) or a `data-legal-verbatim` region. The gate reports the exempted character count per page and **fails if more than 40% of a marketing route's text is inside exempt regions**, so the exemption cannot swallow the page. `/legal/gina` and `/legal/state-genetic-privacy` are enumerated as statute pages whose quoted text is exempt.
12. **Law-enforcement qualification — region-based.** On every rendered page in `LEGAL_ROUTES` and `MARKETING_ROUTES`, extract every region containing "law enforcement", "police", "government authority" or "forensic" together with any of "do not share", "don't share", "never share", "do not disclose", "will not be shared", "does not disclose", within 400 characters or within the same list, heading-plus-list, or table region. Fail unless a qualifier — "court order", "warrant", "subpoena", "compelled", "legal process" — appears in that same region. A sentence-level regex is insufficient: the failure this catches is a heading-plus-tile list containing no verb at all. Two fixtures ship with the gate, one sentence-form and one heading-plus-list-form, and both must fail.
13. **Point-of-display disclaimers** — the exact §6.1 string is present in the rendered output of every route enumerated there.
14. **Sign-off freshness** — every artifact key **listed** in `LEGAL-SIGNOFF.md` has a recorded reviewed `body_sha256` equal to the current published version's hash. An unlisted key never fails (§0).

---

#### 10. Acceptance tests

Every test is binary. Time-dependent tests use one named mechanism: the fake-clock harness `tests/support/advanceClock.ts`, which advances the scheduler's clock and runs due jobs. **L-04, L-05, L-14b, L-17 and L-20 all use it.**

**L-01** `subjects.subject_class` has exactly four enum values; the upload entry point renders exactly four options; a POST to the upload API with any other `subject_class` returns 422 with the §1.1 body. **L-02** An upload for a subject declared under 18 is refused with 422 and stores no file. **L-44** Sign-up with a date of birth under 18 years ago creates no `auth.users` row. **L-03** A class (b) file stays `analysis_state = quarantined` with zero `user_variants` rows until the invited subject signs in their own account. **L-04** Refusal freezes within 60 s, deletes derived data within 24 h and the source within 7 d. **L-05** An unaccepted invitation auto-purges at 30 d; a second inviter's invitation to a refused `email_hash` is rejected and writes `invitation.blocked`. **L-06** A class (b) subject revokes in one click and can move the record to their own account. **L-45** `subject_invitations.email_encrypted` is null 31 days after the invitation reaches a terminal state, and the plaintext address appears in no API response. **L-07** Embryo upload is impossible without two evidenced parents or a reviewed single-parent basis. **L-08** Each single-parent edge case has its own screen, enum value and stored evidence reference. **L-09** Every artifact page returns 200 unauthenticated with a version and an effective date. **L-10** Every superseded version remains retrievable. **L-11** Every version ≥ 2 has a working diff and a plain-language summary. **L-12** `/settings/consents` lists every signature with the version signed and a link to that exact text. **L-13** No control grants more than one purpose; `/uploads` renders zero purpose switches; a "Turn everything off" control revokes all. **L-46** The class (a) path from `/uploads` to a rendered first report requires no more than five user decisions in total. **L-14a** Within 60 s of revoking the class artifact, the file and every derived surface return 404 to the owner and a purge job row exists due at or before now + 7 d. **L-14b** Under the advanced clock, the storage object, every `user_variants` row, every derived report row and every export artifact for that `subject_id` are absent; the only survivor is a frozen §2.7 dispute record. **L-15** Tier 2 screens require a typed two-token name and individually actuated checkboxes with no select-all and no typed date. **L-47** The class (a) flow requires one checkbox, no typed name, and does not render the criminal-liability sentence. **L-16** No control is pre-ticked, and all five refuse/accept parity measurements in §3 hold at both viewports in both themes. **L-17** A recorded contradiction freezes and deletes on schedule, writes an `attestation_contradictions` row, and on the second sets `profiles.non_self_upload_suspended_at`. **L-18** `charter.future-person` is published, versioned, and incorporated by reference into `consent.upload-embryo`, which contains the third-party-rights clause. **L-19** The six rights render verbatim at `/legal/future-person`. **L-20** Non-transferred embryo records are deleted on schedule; `retention_expires_on` is non-null for a record that was never analysed; the pre-deletion notice reaches every evidenced parent with a live account and the account holder. **L-21** `/future-person/claim` is reachable with no account and produces a `future_person_claims` row; without a key and without a `future_person_identity` row it returns the "we cannot tell which record is yours" copy. **L-48** A keyless claim cannot be resolved without a recorded reviewer and a completed 30-day owner notice, and a resolved claim release contains no `user_variants` row belonging to any other `subject_id`. **L-22** The "If a child is born from this" panel is in the unauthenticated server-rendered HTML of `/family` and `/embryo-analysis`. **L-23** Every embryo API response validates against the closed `EmbryoFinding` key list; a crafted response with an extra `sex` key and an extra numeric key is rejected with 500 and a `feature.blocked` row. **L-24** No analysis job enqueues without a current-version `disclosure.insurance-and-discrimination` acknowledgement; the §8 layout assertion holds. **L-25** Parameterised over feature key and route: for every rule row with `allowed = false`, the restriction copy renders publicly on the matching marketing route and the matching flow route returns 403 with the same copy. Covers `/family` and `/dashboard/family/portrait` identically to `/embryo-analysis`. **L-26** With no determinable jurisdiction, every restricted feature is off. **L-41** A Copilot request whose context includes any variant belonging to a non-`self` subject, with a cloud provider selected, returns 403 and writes `feature.blocked`. **L-42** A Portrait request returns 403 when any contributing subject lacks an active `family.portrait` grant signed by their own account. **L-43** A class (b) subject signing in at `/settings/subjects/[subjectId]` sees the same rendered report content as the account holder for every granted purpose, plus provenance, per-purpose revoke and the ownership-transfer control. **L-27** `/legal/gdpr` names a DPO, an EU Article 27 representative, a UK representative, and an Article 9 condition per purpose, each non-empty. **L-28** `/privacy` states Inherit is not a HIPAA covered entity, and no page asserts PHI status. **L-29** Gate check 12 fails on both shipped fixtures, and passes over every route in `LEGAL_ROUTES` and `MARKETING_ROUTES`. **L-30** No controlled medical token appears outside an allowlisted sentence or a verbatim region; no page exceeds the 40% exemption cap. **L-31** The no-diagnosis string renders on every route enumerated in §6.1. **L-32** `/terms` contains "Where these limits do not apply to you", naming CRA 2015 ss.49, 57 and 65(1), Directive 93/13/EEC, ACL s.64 and US UDAP statutes, and a non-zero liability figure; UCTA 1977 s.2(1) appears only in business-facing terms. **L-33** Tampering with one `legal_audit_log` row causes chain verification to fail; the retention function is the only role able to delete, and its invocations are logged. **L-49** Deleting a subject pseudonymises that subject's ledger rows in place and leaves no `subject_id` or `actor_user_id` pointing to them. **L-34** The existing one-click complete account export contains a `legal-audit.json` file covering the user's own slice. There is **no** separate export control on `/settings/consents`; that page shows only the signature list. A JSON-and-CSV audit-log downloader is a surface nobody asked for and is deleted in favour of the export the project already ships. **L-35** `pnpm gate:legal` fails on a deliberately introduced denylisted phrase in a code comment and in a test fixture; the `commit-msg` hook blocks a commit containing one. **L-36** The gate fails on a jurisdiction row with a missing citation and on a `verified_on` older than 365 days, and passes with an `Inherit policy §5.3` citation. **L-37** Every marketing claim resolves to a register entry with a citation and an `accessed_on` date, including the §6.9 ratio. **L-39** `/legal/incident-response`, `/.well-known/security.txt` and a dated incident history page exist, the last stating "No incidents to report" with a date when empty. **L-50** With `LEGAL-SIGNOFF.md` absent, `pnpm gate:legal`, `pnpm test` and `pnpm e2e` all pass, class (a) upload through to a rendered report works end to end, and every `embryo.*` and `family.*` feature returns 403 with its jurisdiction or sign-off copy.

**L-38 and L-40 are human-only records** in `LEGAL-SIGNOFF.md`. No engineer, agent or automated process may add, edit or approve an entry. **L-38**: one signed row per insurance policy (insurer, policy number, coverage territory, inception date). **L-40**: for **each** operating jurisdiction, the reviewing lawyer's name, firm, jurisdiction of admission and registration number, the date of review, the artifact keys and `body_sha256` values reviewed, an explicit approval of the upload classes, the consent architecture, the jurisdiction rules, the liability terms and the Future Person Charter for use in that jurisdiction, and a confirmation that the third-party-rights route for the Charter is effective there or a record of the alternative device used. Classes (b), (c), (d) and the Family and Embryo Analysis domains stay off until the row exists; My Genome ships without it.


---

## 6. Architecture, data model, pipelines, and verification

Inherit v2 is built on the existing Next.js 16 / React 19 / Supabase / Vitest / Playwright stack. **Nothing that already works is rewritten.** The existing parsers (`src/lib/genome/parsers/*`), liftover (`src/lib/genome/liftover.ts`), admixture EM (`src/lib/genome/admixture.ts`), PRS engine (`src/lib/genome/prs.ts`), report resolver (`src/lib/genome/reports.ts`), Tier-1 processing route (`src/app/api/files/[id]/process/route.ts`), export route, deletion route, `processing_time_stats()` and the five existing migrations are extended, never replaced. ADRs 0001–0005 remain binding; where v2 needs a different answer, a superseding ADR is written (§A.12).

Two rules govern every conflict in this section. **First: the database decides who may read what.** Application code may narrow access; it may never be the only thing between two accounts. **Second: when a safety caveat and the simplicity mandate collide, the caveat is relocated, not deleted.** Every screen shows one number or one named reason per result; all remaining mandated disclosure lives behind one per-screen "How we know this" panel whose completeness is itself tested (§A.11). Adding a fourth line of hedging to a result cell is a defect, not a virtue.

#### A.1 Architectural invariants and the test that discharges each

1. **No genome-derived byte leaves the deployment** except to a user-configured model endpoint under a live, unrevoked, per-subject consent record. Test: `e2e/network-audit.spec.ts` plus `e2e/copilot-consent.spec.ts`.
2. **No third-party runtime request from any page.** Test: `e2e/network-audit.spec.ts` over the full route list in §A.10.
3. **No request or response body over 4,500,000 bytes crosses a serverless function.** Test: `e2e/function-payload.spec.ts` intercepts every `/api/**` request and response during a complete upload-and-process journey for an array file, a 200 MB VCF and an 8-sample cohort VCF, and fails on any body exceeding that size.
4. **Authorisation is decided in Postgres.** Test: `e2e/subject-rls.spec.ts` performs every read directly against PostgREST and Storage with no application code in the path.
5. **Nothing is inferred that the file does not support.** Coverage is always a number. No imputation, no phasing, no substitution of one person's data for another's. Tests: `src/lib/genome/no-inference.test.ts` (every result object exposes a numeric `coverage`; no code path fills a missing genotype from any source) and `src/lib/embryo/score.test.ts`.

#### A.2 Route map and redirects

The v2 information architecture is three domains behind one Overview. Every v1 route keeps working through a permanent redirect declared in `next.config.ts`; **the existing `/copilot → /chat` redirect is deleted in the same change**, because v2 reverses it and leaving it in place creates a loop.

| v1 path | v2 path | Redirect |
|---|---|---|
| `/dashboard` | `/overview` | 308 |
| `/reports` | `/genome/reports` | 308 |
| `/reports/[slug]` | `/genome/reports/[slug]` | 308 |
| `/ancestry` | `/genome/ancestry` | 308 |
| `/chat` | `/copilot` | 308 |
| `/uploads` | `/genome/uploads` | 308 |
| `/browse` | `/genome/browse` | 308 |
| `/settings` | `/settings` | — |

New routes: `/family`, `/family/risks`, `/family/portrait`, `/embryos`, `/embryos/[cohort]`, `/embryos/[cohort]/compare`, `/embryos/request-your-data`, `/settings/people`. **There is no `/subjects` route tree**: managing people and consents lives at `/settings/people`, because the Overview's three boxes must be the only entry points to the three domains. `e2e/routes.spec.ts` asserts each v1 path returns 308 to its named target and that the target renders 200. Every existing E2E spec that navigates a v1 path (`auth`, `copilot`, `report-gate`, `a11y`, `research`, `tier2-upload`, `upload-vcf`, `deletion-export`, `network-audit`, `rls`) is updated to the v2 path in the same change; leaving a spec on a redirected path is a build failure of `pnpm e2e`, not an acceptable state.

#### A.3 The subject model

Today all data hangs off `genome_files.user_id`. v2 introduces `subjects`: the person or embryo the data is *about*, distinct from the account that holds it. `user_id` survives on every existing table as a **provenance column recording who uploaded the row. It is no longer an authorisation column.**

All new tables live in `public` with `enable row level security`.

**`subjects`** — one row per analysed person or embryo. Holds no genetic and no health data; `src/lib/schema/minimisation.test.ts` asserts the exact column list below and fails on any addition.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | `primary key default gen_random_uuid()` |
| `owner_account_id` | `uuid` | `not null references auth.users(id) on delete restrict` |
| `kind` | `text` | `not null check (kind in ('self','adult','embryo'))` |
| `display_label` | `text` | `not null check (char_length(display_label) between 1 and 64)` |
| `is_self` | `boolean` | `not null default false`; `check (is_self = false or kind = 'self')` |
| `subject_account_id` | `uuid` | `references auth.users(id) on delete set null` — set when an adult subject claims their own account |
| `cohort_id` | `uuid` | `references embryo_cohorts(id) on delete cascade`; `check ((kind = 'embryo') = (cohort_id is not null))` |
| `year_of_birth` | `smallint` | `check (year_of_birth between 1900 and 2100)`; `check (kind <> 'embryo' or year_of_birth is null)`; `check (kind <> 'adult' or year_of_birth is null or (extract(year from now()) - year_of_birth) >= 18)` |
| `lifecycle` | `text` | `not null default 'active' check (lifecycle in ('active','revoked','purge_queued','purged'))` |
| `revoked_at`, `created_at`, `updated_at` | `timestamptz` | |

Indexes: `subjects_owner_idx (owner_account_id, lifecycle)`; `subjects_cohort_idx (cohort_id)`; `create unique index subjects_one_self_per_account on public.subjects (owner_account_id) where is_self`.

`subjects` has **no sex column**. The stronger claim the earlier draft made — that embryo sex is not derivable from any output — is false unless enforced, so §A.6 enforces it as a filter and §A.11 tests it.

**Rejected kinds.** `kind` deliberately has no `'deceased'` and no `'minor'` value. Subject creation refuses both with the exact copy: "Inherit only analyses your own genome, another adult's with their permission, or embryos. For a deceased relative or a child, see our legal pages." `e2e/subject-kinds.spec.ts` asserts the refusal and the copy. This is a real limit, not prose: there is no schema path to store either.

**`subject_relationships`** — `id`, `subject_id`, `related_subject_id` (both `references subjects(id) on delete cascade`), `relation text not null check (relation in ('genetic_parent_of','partner_of'))`, `created_at`; `check (subject_id <> related_subject_id)`; `unique (subject_id, related_subject_id, relation)`.

**`subject_consents`** — the single source of authorisation truth.

| Column | Type | Constraints |
|---|---|---|
| `id` | `uuid` | `primary key default gen_random_uuid()` |
| `subject_id` / `cohort_id` | `uuid` | FKs; `check (num_nonnulls(subject_id, cohort_id) = 1)` |
| `account_id` | `uuid` | `not null references auth.users(id) on delete cascade` — the account being authorised |
| `consent_type` | `text` | `not null check (consent_type in ('self','adult_third_party','embryo_own_parent','embryo_third_party','cloud_model'))` |
| `document_slug`, `document_version` | `text` | `not null` |
| `document_sha256` | `text` | `not null check (document_sha256 ~ '^[0-9a-f]{64}$')` — computed **server-side** over `content/consents/{slug}/{version}.md` |
| `signature_name` | `text` | `not null check (char_length(signature_name) >= 2)` |
| `signature_typed_at` | `timestamptz` | `not null` |
| `signature_ip_hash`, `signature_ua_hash` | `text` | HMAC-SHA256 under `CONSENT_PEPPER`; raw values never stored |
| `attested_age_18_plus` | `boolean` | `not null default false`; `check (consent_type <> 'adult_third_party' or attested_age_18_plus)` |
| `scope` | `text[]` | `not null check (array_length(scope,1) >= 1 and scope <@ '{variants,reports,ancestry,prs,portrait,embryo_scores,export}'::text[])` |
| `provider_key` | `text` | `check ((provider_key is not null) = (consent_type = 'cloud_model'))` |
| `supersedes` | `uuid` | `references subject_consents(id)` |
| `granted_at`, `expires_at`, `revoked_at` | `timestamptz` | |
| `revoked_by` | `uuid` | `references auth.users(id)` |
| `revocation_reason` | `text` | `check (revocation_reason is null or revocation_reason in ('withdrawn','superseded','account_deleted','retention_expired'))` |

`create unique index subject_consents_active_idx on public.subject_consents (coalesce(subject_id, cohort_id), account_id, consent_type, coalesce(provider_key,'')) where revoked_at is null`.

**`subject_invitations`** — `id`; `subject_id` or `cohort_id` (`num_nonnulls = 1`); `inviter_account_id`; `invitee_email_hash text not null` (HMAC-SHA256 of the lower-cased address under `INVITE_PEPPER`); `token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$')` (SHA-256 of a 32-byte CSPRNG token; the raw token exists only in the emailed URL and is never persisted or logged); `role text not null check (role in ('subject_self_claim','co_parent'))`; `status text not null default 'pending' check (status in ('pending','accepted','declined','expired','revoked'))`; `expires_at timestamptz not null default now() + interval '14 days'`; `accepted_by`, `accepted_at`, `created_at`.

**`embryo_cohorts`** — `id`; `owner_account_id uuid not null references auth.users(id) on delete restrict`; `label text not null check (char_length(label) between 1 and 64)`; `clinic_label text check (clinic_label ~ '^[A-Za-z0-9 .,''\-#]{1,80}$')`; `lab_label text` (same pattern); `biopsy_date date`; `parent_a_subject_id`, `parent_b_subject_id` (`references subjects(id) on delete restrict`, `check (parent_a_subject_id is distinct from parent_b_subject_id)`); `uploader_is_genetic_parent boolean not null`; `check (uploader_is_genetic_parent or (parent_a_subject_id is not null and parent_b_subject_id is not null))`; `source_platform text not null default 'unknown' check (source_platform in ('array','wgs','targeted','unknown'))`; `status text not null default 'active' check (status in ('active','restricted','purge_queued','purged'))`; `retention_expires_at timestamptz not null default now() + interval '24 months'`; `created_at`.

**`embryos`** — `id`; `cohort_id not null`; `subject_id uuid not null unique references subjects(id) on delete cascade`; `lab_identifier text not null check (lab_identifier ~ '^[A-Za-z0-9 ._\-#]{1,64}$')`; `display_label text not null`; `sample_column text`; `file_id uuid references genome_files(id) on delete set null`; `status text not null check (status in ('pending','qc_pass','qc_marginal','qc_fail','excluded'))`; `excluded_reason text`; `unique (cohort_id, lab_identifier)`. The `lab_identifier` pattern is a minimisation control: laboratory sample names routinely carry surnames and dates of birth. A file whose sample name fails the pattern is accepted with a generated identifier and the message "We replaced one sample name because it contained characters we do not store." `list_embryos` (§A.9) returns `display_label` only and never `lab_identifier`.

**`embryo_qc`** — `embryo_id` (pk); `sites_expected integer not null`; `sites_called integer not null`; `call_rate real not null check (call_rate between 0 and 1)`; `autosomal_het_rate real`; `mean_depth real`; `parent_a_concordance real`; `parent_b_concordance real`; `allelic_dropout_estimate real`; `contamination_estimate real`; `qc_verdict text not null check (qc_verdict in ('pass','marginal','fail'))`; `qc_reasons text[] not null default '{}'`; `computed_at`. There is no `het_rate` column: heterozygosity is computed on autosomes only, because a genome-wide figure discloses sex.

**`attestations`** — records only facts that are **not** consents, so there is exactly one signing ceremony per act: `kind text not null check (kind in ('own_embryo','parents_permission','jurisdiction'))`, plus `account_id`, `subject_id`/`cohort_id`, `statement_version`, `statement_sha256`, `affirmed boolean not null`, `affirmed_at`, `ip_hash`. The duplicated kinds in the earlier draft (`own_genome`, `adult_permission`, `age_18_plus`) are deleted; `subject_consents` is authoritative for all three. The `jurisdiction` attestation is concrete: it is collected once, before the first embryo cohort is created, from `content/attestations/jurisdiction/{version}.md`; it records the affirmed two-letter jurisdiction code; and `config/restricted-jurisdictions.json` blocks cohort creation for listed codes with the copy "We cannot analyse embryo data for people in {country}. The law there does not allow it, and we will not work around that." `e2e/jurisdiction.spec.ts` asserts the block and the copy.

**`audit_log`** — `id bigint generated always as identity primary key`; `account_id uuid references auth.users(id) on delete set null`; `actor text not null check (actor in ('account','service','worker','system'))`; `action text not null`; `subject_id uuid`; `cohort_id uuid`; `target_table text`; `target_id text`; `detail jsonb not null default '{}'::jsonb`; `created_at`. Append-only: `revoke update, delete on public.audit_log from anon, authenticated;` and no UPDATE/DELETE policy exists.

**Derived result tables.** `portrait_results` (`owner_account_id`, `parent_a_subject_id`, `parent_b_subject_id`, `kind text check (kind in ('carrier_pair','polygenic_distribution'))`, `trait_key`, `result jsonb`, `coverage real not null`, `method_version`, `computed_at`, `unique (parent_a_subject_id, parent_b_subject_id, kind, trait_key)`). `embryo_scores` (`embryo_id`, `kind text check (kind in ('monogenic','polygenic'))`, `key`, `result jsonb`, `coverage real not null`, `confidence text check (confidence in ('reportable','low_confidence','not_reportable'))`, `not_reportable_reason`, `computed_at`, `unique (embryo_id, kind, key)`). `ancestry_regions` (`subject_id`, `region_code text references ref_regions(code)`, `point real`, `p05 real`, `p95 real`, `markers_used integer`, `method_version`, `unique (subject_id, region_code)`). **No table has a rank column.**

**Extensions to existing tables.** `genome_files` gains `subject_id uuid references subjects(id) on delete cascade`, `cohort_id uuid references embryo_cohorts(id) on delete cascade`, `is_cohort_file boolean not null default false`, `sample_count smallint not null default 1`, `parse_meta jsonb not null default '{}'::jsonb`, and `check ((is_cohort_file) = (subject_id is null)) `, `check ((is_cohort_file) = (cohort_id is not null))`. A cohort file is about many embryos and no one subject; it is authorised through its cohort. `user_variants`, `ancestry_results` and `user_prs` each gain `subject_id uuid not null references subjects(id) on delete cascade` — embryo variant rows carry the **embryo's** subject id even though their `file_id` points at the cohort file. `genome_file_type` gains `'vcf_multisample'` and `'pgt_table'`, both `tier = 1`. `chats` gains `scope text not null default 'subject' check (scope in ('subject','family','cohort'))`, `subject_id`, `partner_subject_id`, `cohort_id`.

#### A.4 Migrations, zero data loss

Additive only; no existing column is dropped or renamed. Files follow the repo's `YYYYMMDDNNNNNN_name.sql` convention.

1. `20260901000001_subjects.sql` — creates `subjects` **without** `cohort_id`, then `embryo_cohorts` (whose parent FKs need `subjects` to exist), then `alter table public.subjects add column cohort_id …` and the `check ((kind = 'embryo') = (cohort_id is not null))` constraint last. The circular reference has no single creation order; this is the order that works. Then `subject_relationships`, indexes, RLS enabled with no policies yet.
2. `20260901000002_consents.sql` — `subject_consents`, `subject_invitations`, `attestations`; the `before update` trigger on `subject_consents` (§A.5); the `after insert or update` audit trigger (§A.5); and the migration of `consent_grants`: every row with `revoked_at is null` is copied into `subject_consents` as `consent_type = 'cloud_model'` against the account's self-subject with `document_slug = 'cloud-model-consent'`, `document_version = 'migrated-v0'`, then `revoke insert, update on public.consent_grants from authenticated`. `consent_grants` is retained read-only for export fidelity and its settings UI is removed. **`subject_consents` is authoritative for cloud-model consent from v2.**
3. `20260901000003_backfill.sql` — one transaction: insert one `'self'` subject per `profiles` row (`display_label = coalesce(display_name,'You')`, `is_self = true`); insert one `'self'` consent per backfilled subject with `scope = '{variants,reports,ancestry,prs,portrait,export}'`, `document_version = 'migrated-v0'`, `signature_name = 'migrated'` — **existing accounts are never asked to re-consent to their own data**; add and backfill `subject_id` on `genome_files`, `user_variants`, `ancestry_results`, `user_prs` from the account's self-subject; then `set not null` on the last three. In-migration assertions: no row with a null `subject_id` in the three, no `genome_files` row where `subject_id is null and not is_cohort_file`, and **no row whose subject's `owner_account_id` differs from the row's `user_id`**.
4. `20260901000004_embryos.sql` — `embryos`, `embryo_qc`, `embryo_scores`, `portrait_results`; enum additions.
5. `20260901000005_audit.sql` — `audit_log` and its grants.
6. `20260901000006_worker_jobs_v2.sql` — §A.7.
7. `20260901000007_rls.sql` — the two access functions and every policy (§A.5).
8. `20260901000008_storage.sql` — additional Storage policies (§A.5).
9. `20260901000009_chat_scope.sql` — `chats` columns.
10. `20260901000010_ancestry_regions.sql` — `ref_regions` and `ancestry_regions`.

`e2e/migration.spec.ts` restores a dump of the pre-v2 schema seeded with **two accounts holding interleaved rows**, runs `supabase db push`, and asserts: row counts identical before and after in `genome_files`, `user_variants`, `ancestry_results`, `user_prs`, `chats`; an `md5(string_agg(...))` content checksum over the stable columns of each table identical before and after; and, per row, that `subjects.owner_account_id` of its `subject_id` equals the row's `user_id` and `subjects.is_self` is true. Counts alone cannot detect a backfill that attaches rows to the wrong subject, and after v2 that mis-attribution is a cross-account exposure.

#### A.5 Row-level security

**Two functions, both `stable`, `security definer`, `set search_path = ''`**, with `revoke execute … from public, anon` and `grant execute … to authenticated`. They are SECURITY DEFINER *because* their bodies read `subjects`, `subject_consents` and `embryo_cohorts` with RLS bypassed. Declaring them SECURITY INVOKER creates a policy-evaluation cycle — the function reads a table whose own policy calls the function — which Postgres aborts with SQLSTATE 42P17, and additionally inverts the restricted-cohort test, since a row filtered out by RLS makes `not exists` true and grants access. Two alternatives were considered and rejected: splitting into a consent-only invoker function plus a definer status function (two functions where one suffices, with the cycle still latent if either body grows), and a trigger-maintained `subject_access` materialised table (correct but adds a second source of truth that can drift). One definer function per grain is simpler and provably acyclic.

- `public.subject_can(sid uuid, need text) returns boolean` — true iff `subjects.lifecycle = 'active'` for `sid`, **and** either (a) a `subject_consents` row exists with `subject_id = sid`, `account_id = auth.uid()`, `consent_type <> 'cloud_model'`, `revoked_at is null`, `(expires_at is null or expires_at > now())` and `need = any(scope)`, or (b) the subject's `cohort_id` is non-null and `public.cohort_can(cohort_id, need)`.
- `public.cohort_can(cid uuid, need text) returns boolean` — true iff `embryo_cohorts.status = 'active'` for `cid` **and** `retention_expires_at > now()` **and** an equivalent live consent row exists over `cohort_id = cid` **and**, when `uploader_is_genetic_parent = false`, live `adult_third_party` consents exist for both `parent_a_subject_id` and `parent_b_subject_id`.

`scope` is therefore load-bearing: a consent granted `'{reports}'` yields zero `user_variants` rows.

**Policies.** Client writes to `subjects`, `subject_consents`, `attestations`, `embryo_cohorts`, `embryos`, `embryo_qc`, `embryo_scores`, `portrait_results`, `ancestry_regions` and `audit_log` are **service-role only — no INSERT policy exists for `authenticated` on any of them.** This is the fix for the draft's largest hole: an INSERT policy constraining only `account_id` let any account insert a consent naming any subject id, and subject ids are not secret (they appear in exports and storage paths). All grants now flow through `POST /api/consents`, which (a) authorises the caller as owner of the subject or as the redeemer of a matching `subject_invitations` row, (b) recomputes `document_sha256` server-side from the committed document and rejects a client-supplied hash with HTTP 409, and (c) writes the `audit_log` row in the same transaction.

| Table | SELECT | UPDATE (client) |
|---|---|---|
| `subjects` | `owner_account_id = auth.uid() or subject_account_id = auth.uid() or public.subject_can(id,'reports')` | `owner_account_id = auth.uid() or subject_account_id = auth.uid()`, narrowed by trigger: the owner may change only `display_label`; the claimed subject may only set `lifecycle = 'revoked'` |
| `subject_consents` | `account_id = auth.uid() or exists (select 1 from public.subjects s where s.id = subject_id and s.subject_account_id = auth.uid())` | `using (account_id = auth.uid() or exists (… subject_account_id = auth.uid()))` `with check (revoked_at is not null)` — a party may revoke, never widen |
| `subject_invitations` | `inviter_account_id = auth.uid()` | inviter only; redemption is service-role in `POST /api/invitations/accept`, token never matched client-side |
| `embryo_cohorts` | `public.cohort_can(id,'embryo_scores')` | `owner_account_id = auth.uid()`, narrowed by trigger to `label`, `clinic_label`, `lab_label`, `biopsy_date`; `status` and `retention_expires_at` are service-role only |
| `embryos` | `public.cohort_can(cohort_id,'embryo_scores')` | none |
| `embryo_qc`, `embryo_scores` | `exists (select 1 from public.embryos e where e.id = embryo_id and public.cohort_can(e.cohort_id,'embryo_scores'))` | none |
| `genome_files` | `public.subject_can(subject_id,'variants') or public.cohort_can(cohort_id,'embryo_scores')` | `auth.uid() = user_id` |
| `user_variants` | `public.subject_can(subject_id,'variants')` | `auth.uid() = user_id` |
| `ancestry_results`, `ancestry_regions` | `public.subject_can(subject_id,'ancestry')` | `auth.uid() = user_id` |
| `user_prs` | `public.subject_can(subject_id,'prs')` | `auth.uid() = user_id` |
| `portrait_results` | `public.subject_can(parent_a_subject_id,'portrait') and public.subject_can(parent_b_subject_id,'portrait')` | none |
| `attestations` | `account_id = auth.uid()` | none |
| `audit_log` | `account_id = auth.uid() or exists (select 1 from public.subjects s where s.id = audit_log.subject_id and s.subject_account_id = auth.uid())` | none |

The `auth.uid() = user_id` conjunct is removed from every SELECT because it made shared-subject reads impossible: `user_id` is the uploader's account, so a second account holding a live consent could never read a row. Ownership is now expressed as a live self-consent, which the backfill creates for every existing account.

**Immutability trigger** on `subject_consents` (`before update`): rejects any change to `subject_id`, `cohort_id`, `account_id`, `consent_type`, `document_slug`, `document_version`, `document_sha256`, `signature_name`, `signature_typed_at`, `granted_at`, `scope`, `provider_key`, `expires_at`; permits only a null → non-null transition on `revoked_at` together with `revoked_by` and `revocation_reason`. **A revoked consent cannot be un-revoked**, by its holder or by the service role. Re-consent to a new document version therefore runs through `POST /api/consents/reaffirm`, which in one transaction inserts the new-version row with `supersedes` set and marks the prior row revoked with reason `'superseded'` — so there is no read gap across a version bump, which the partial unique index would otherwise force by requiring revoke-then-sign.

**Revocation is operable by the person the data is about.** `POST /api/consents/[id]/revoke` authorises the caller as the consent's `account_id`, the subject's `subject_account_id`, or a claimed account of either named genetic parent of the cohort; `POST /api/cohorts/[id]/restrict` authorises either genetic parent. Both write with the service role and write `audit_log`. Without these routes the earlier draft's revocation stories were unimplementable, because the revoking party had no write right on the row they had to write.

**Storage.** New object paths are `{account_id}/{subject_id}/{upload_id}/{filename}` for subject files and `{account_id}/{cohort_id}/{upload_id}/{filename}` for cohort files; the legacy `{user_id}/{uuid}/{name}` layout keeps working under existing policies. Two additional read policies grant `select` on `bucket_id = 'genomes'` when segment 2 parses as a uuid and `subject_can(...,'variants')` or `cohort_can(...,'embryo_scores')` is true. Signed URLs last `SIGNED_URL_TTL_SECONDS`, read from env with production value 300 and the E2E environment setting **5**; `src/lib/config.test.ts` asserts the production default is 300. `GET /api/files/[id]/download` is **retained and repointed**: it must call the same `assertReadable(subjectOrCohort, need)` helper as `GET /api/subjects/[id]/download`, re-evaluating consent at request time. The residual window is stated to the user, not hidden: the revoke confirmation shows "A download link made in the last five minutes may still work until it expires. Nothing new can be downloaded."

**Hard cases.**

- *Revoked.* Setting `revoked_at` makes every genetic row for that subject return zero rows on the **next query** — no deploy, no cache flush. A `revoke_purge` job then deletes the data outright (§A.7).
- *Two genetic parents on different accounts.* Account A creates the cohort and signs; account B accepts a `co_parent` invitation, which inserts B's own consent against the same `cohort_id` under the service role. Both satisfy `cohort_can`. Neither can read the other's parental subject without a separate `adult_third_party` consent.
- *Either parent revokes.* `embryo_cohorts.status = 'restricted'` makes the cohort unreadable by **every** account including the revoker, and queues `revoke_purge`. An embryo genome is composed of both parents' sequence; neither may unilaterally retain it (ADR-0009).
- *Account deletion.* `owner_account_id` is `on delete restrict`, and `POST /api/account/delete` is the only deletion path. **It purges every subject the account owns, including subjects other accounts hold live consents for**, then deletes the auth row. The earlier draft's ownership-transfer rule is deleted: it contradicted both the FK cascade and the deletion test, and it meant "delete my account" silently left copies of genomes behind. Grantees receive an email 7 days before the purge and the claimed subject can take their own copy first (`GET /api/subjects/[id]/export`, §A.11). `audit_log` rows survive with `account_id` nulled and no subject-identifying content.

**`e2e/subject-rls.spec.ts`** — against the real PostgREST and Storage APIs, in the style of the existing `e2e/rls.spec.ts`:

1. *no policy recursion* — one authenticated SELECT against `subjects`, `embryo_cohorts`, `embryos`, `embryo_qc`, `embryo_scores` and `portrait_results` each returns rows and raises no 42P17.
2. a `restricted` cohort returns zero rows for **both** parents.
3. a forged `subject_consents` insert naming another account is rejected; and **a forged insert naming another account's subject with `account_id = self` is rejected**, and the inserting account still reads zero rows for that subject.
4. an account cannot create a consent for a subject it does not own, via PostgREST or via `POST /api/consents`; a consent whose client-supplied `document_sha256` mismatches the committed version returns 409.
5. a revoked consent cannot be un-revoked by its holder, and the subject stays unreadable.
6. account B, holding a live `adult_third_party` consent, reads exactly the shared subject's `user_variants` and `user_prs` and zero rows for any other subject of account A.
7. a consent scoped `'{reports}'` yields zero `user_variants` rows.
8. co-parent B cannot read parent A's own genome; a non-owner co-parent **can** restrict the cohort.
9. subject B revokes; owner A's reads of B's variants, PRS, ancestry and storage return zero on the next query. B cannot grant a new consent, rename the subject, or read A's own subject.
10. a claimed subject reads their own consent record and their own audit trail, and nothing else in the uploader's account.
11. anonymous reads return zero rows on every new table.
12. `audit_log` rows cannot be updated or deleted by their own account; a consent written by every available path produced a matching row (the trigger makes this hold even if a route is bypassed).
13. an invitation token cannot be redeemed twice; an expired token is refused.
14. a third-party consent with `attested_age_18_plus = false` is rejected by the database.

#### A.6 Ingest

`sniff()` is extended to `sniffV2(bytes): { kind, compressed, sampleCount, sampleNames }` in `src/lib/genome/parsers/sniff.ts`, keeping the current signature as a thin wrapper. Detection order: BAM/CRAM magic → `%PDF-` magic → `##fileformat=VCF` (then count tab-separated columns after `#CHROM`) → the four vendor array headers → PGT tabular heuristics → `null`.

| Input | Detection | Handling |
|---|---|---|
| 23andMe / AncestryDNA / MyHeritage / FamilyTreeDNA export | existing headers | Unchanged Tier-1 path, stamped with `subject_id`. |
| Single-sample VCF / VCF.GZ / gVCF | `sampleCount = 1` | Unchanged Tier-1 path. |
| Multi-sample VCF | `sampleCount >= 2` → `vcf_multisample` | `is_cohort_file = true`; a `split_cohort_vcf` worker job creates one `subjects` and one `embryos` row per sample column. |
| Genotype table from a testing laboratory (CSV/TSV) | header rule below → `pgt_table` | Parsed by `src/lib/genome/parsers/pgt-table.ts`. |
| PDF | `%PDF-` magic | Refused. |

**Header rule.** Each header cell is normalised by lower-casing and stripping non-alphanumerics, then matched by **exact equality** against a synonym table at `data/ref/lab-tables/column-synonyms.json` (`chromosome`→`chrom`, `position`→`pos`, `snp`/`marker`→`rsid`, `call`/`result`→`genotype`, `specimen`→`sample`). A file is `pgt_table` when at least three of `sample`, `embryo`, `rsid`, `genotype`, `chrom`, `pos` resolve. Substring matching is prohibited.

**Column mapping must not become a spreadsheet chore.** Auto-mapping runs against the synonym table first; the confirmation screen appears **only** when a required field is ambiguous or missing, presents at most **four** decisions, and shows three example values per column. `e2e/embryo-ingest.spec.ts` asserts zero mapping decisions for each of four committed real-shaped fixtures and at most four for the deliberately ambiguous fifth.

**Build detection.** Unchanged mechanism, plus inference for laboratory tables with no declared build: compare at least 1,000 positions against `data/ref/build-discriminating-sites.json` and accept a build when ≥99% agree. Only if inference fails is the user asked, and the question has three options — "GRCh37", "GRCh38", and "I don't know", the last linking to `/embryos/request-your-data` rather than blocking. Asking an IVF patient which reference build their laboratory used and then withholding all results is not an acceptable dead end.

**Where the PDF refusal happens.** ADR-0001 sends every upload browser → Storage over TUS, so no upload transits a function and a `POST /api/uploads` rejection is unreachable — there is no such route. Refusal therefore lives in the two places that see the bytes: (1) `sniffFile` in `src/lib/genome/parsers/sniff-browser.ts` detects `%PDF-` **before the first TUS chunk is sent** and blocks the upload; (2) `POST /api/files/[id]/process` re-sniffs the first 64 KiB server-side for any file already in Storage, sets `genome_files.error = 'pdf_not_data'`, returns HTTP 415 and deletes the object. `e2e/pdf-rejection.spec.ts` asserts both. No OCR path, no "estimate from the PDF" path, ever. Named anti-pattern (ADR-0008): **conclusion-laundering** — re-presenting another laboratory's printed conclusions as though Inherit had computed them.

**Rejection messages.** Each is a distinct `error` value and a distinct string in `src/lib/genome/ingest-errors.ts`. `src/lib/genome/ingest-errors.test.ts` asserts every enum member has a message, that no message contains an allele, genotype or variant identifier, and that **none exceeds 240 characters** — the strings below are written to that cap rather than the cap being raised to fit them.

| Code | Trigger | Message |
|---|---|---|
| `unrecognised_format` | `sniffV2` null | "We could not recognise this file. Inherit reads genotype files from home testing services, VCF and gVCF files, and genotype tables from a testing laboratory." |
| `pdf_not_data` | PDF magic | "This is a PDF, not genetic data. The numbers in it are conclusions, not the genotypes we need. Ask your clinic or lab for the raw data file — a VCF, or a CSV of genotypes per embryo. We have a letter you can send them." |
| `too_large` | over `LIMITS` | "This file is bigger than the {n} MB limit for this kind of file." |
| `empty_after_parse` | 0 usable records | "We read this file but found no genotypes in it. It may be a summary rather than the data itself." |
| `build_unknown` | inference failed, unanswered | "We could not tell which reference version this file uses, so we have not read it. Your laboratory can tell you." |
| `liftover_loss` | >5% unmapped | "More than 5 in 100 positions in this file did not match the reference we use, so we have not read it." |
| `cohort_single_sample` | cohort upload, `sampleCount = 1` | "This file holds one sample, not several embryos. Upload it as a single genome, or ask your lab for the file with all of them." |
| `embryo_call_rate` | `call_rate < 0.85` | "{label}: we could read only {pct} in 100 of the markers we need. We have not produced results, because results this sparse would mislead you." |
| `embryo_parent_discordant` | concordance < 0.90 with both parents present | "{label}: this embryo's genotypes do not match the genetic parents closely enough for us to be sure the files belong together. We have not produced results." |
| `contamination` | `contamination_estimate > 0.05` | "{label}: this sample shows signs of mixed DNA, which makes per-embryo results unreliable. We have not produced results." |

Every rejection is recoverable. **No rejection is silent, and no result is produced for a sample that failed a gate.**

#### A.7 Compute

**Placement.** Serverless (`maxDuration = 300`): sniffing the first 64 KiB, row creation, job enqueue, progress polling, query-time report resolution, carrier arithmetic, and the existing single-subject Tier-1 processing. Self-hosted worker (`worker/`): `split_cohort_vcf`, `score_embryo`, `compute_portrait`, `compute_ancestry_regional`, `revoke_purge`, `retention_purge`, plus the existing `annotate_vcf`.

**`worker_jobs` v2** adds `subject_id`, `cohort_id`, `idempotency_key text unique`, `attempts smallint not null default 0`, `max_attempts smallint not null default 3`, `not_before timestamptz not null default now()`, `progress smallint not null default 0 check (progress between 0 and 100)`, `progress_note text`, `partial boolean not null default false`; the `kind` check gains the six new kinds; index `worker_jobs_ready_idx (status, not_before, created_at)`.

- **Idempotency.** `idempotency_key = sha256(kind || ':' || coalesce(subject_id::text, cohort_id::text) || ':' || file_sha256)`; enqueue uses `on conflict do nothing` and returns the existing job id with HTTP 200.
- **Claiming** keeps `for update skip locked` plus `and not_before <= now()`.
- **Retries.** `attempts + 1`; if under `max_attempts`, back to `queued` with `not_before = now() + interval '30 seconds' * power(2, attempts)`; else `failed`.
- **Partial failure.** `split_cohort_vcf` and `score_embryo` are per-embryo transactional: a failing embryo sets `embryos.status = 'qc_fail'` with a named reason and the job continues, finishing `partial = true`. The UI shows, per embryo, either a result or a named reason — never a blank cell.
- **Progress** written at most every 2 seconds; `progress_note` may contain only stage names, never sample-level data.
- **Test hook.** `POST /api/jobs/run?kind=…` drains the queue synchronously; it requires the service role or `E2E_TEST_HOOKS=1` and is used by `e2e/revocation.spec.ts`, `e2e/embryo-ingest.spec.ts` and §A.13. Without it, purge and cohort tests would need 24-hour and 5-minute wall-clock waits inside Playwright and would be marked skipped.
- **Turnaround.** Two functions, because Tier-1 processing has no worker job and therefore no `kind` to aggregate: the existing `processing_time_stats()` backs `/genome/uploads`; a new `public.job_time_stats(kind text)` returning `n_bucket text, p50_seconds, p95_seconds` over 90 days backs `/embryos` and `/family/portrait`. `n` is returned bucketed (`'<20'`, `'20-99'`, `'100+'`) and execute is granted to `authenticated` only. **No turnaround estimate may be shown that is not returned by one of these two functions**, enforced by `gate:copy` (§A.12). Copy: "Most files like this finish in about {p50}. Nine in ten finish within {p95}." and, for `'<20'`, "We have not run enough of these yet to give you an honest time." Named anti-pattern (ADR-0011): **turnaround multiplicity** — publishing inconsistent figures on different surfaces.

**Embryo sex is filtered, not merely undisclosed.** `split_cohort_vcf` and `pgt-table.ts` **discard every record on chrom 23, 24 and 25 before insert for any subject with `kind = 'embryo'`**, recording `parse_meta.sex_chromosomes_discarded = true`; a `before insert` trigger on `user_variants` rejects `chrom >= 23` when the subject is an embryo. `embryo_qc.autosomal_het_rate` is computed on chrom 1–22 only. Tests: `src/lib/embryo/no-sex.test.ts` (a cohort VCF containing chrX/chrY yields zero such rows) and an E2E asserting the export ZIP contains no chrX/chrY/chrM line in any embryo `variants/*.csv`.

**QC metrics, defined.** `sites_expected` = the count of loci in the union of all scored report templates and PRS panels for which the cohort file declares a position. `call_rate = sites_called / sites_expected`. `concordance` = the fraction of sites, called in embryo and both parents, where the embryo genotype is consistent with Mendelian transmission. **Bands:** `pass` when `call_rate ≥ 0.95` and every present concordance ≥ 0.95; `marginal` when `0.85 ≤ call_rate < 0.95` or a concordance in `[0.90, 0.95)`; `fail` below. A `marginal` embryo shows results with `confidence = 'low_confidence'` and the qualifier "The data for this embryo is thinner than we would like." **Null rule, verbatim:** when `contamination_estimate` or `allelic_dropout_estimate` is null, the metric is displayed as "not measurable from this file", does not gate, and the embryo's polygenic confidence is capped at `low_confidence`. **Allelic dropout ceiling:** `allelic_dropout_estimate > 0.10` sets polygenic `confidence = 'not_reportable'` with reason `dropout_too_high`. Dropout is the dominant error mode for amplified biopsy material and call rate cannot detect it — dropout produces confidently-called false homozygotes — so a call-rate gate alone would pass an embryo whose genotypes are systematically wrong. `src/lib/embryo/qc.test.ts` fires each gate at its exact threshold and one unit either side.

**Computations.**

- *Per-subject reports and PRS* — unchanged, filtered by `subject_id`; `coverage` and `ancestry_note` mandatory on every render.
- *Sub-continental ancestry* — §A.8.
- *Neanderthal DNA* — the user-facing label is "Neanderthal DNA" everywhere; "archaic" appears only in code and provenance files. The statistic is defined exactly: **the fraction of covered panel sites at which you carry at least one archaic-derived allele**, from a committed panel at `data/ref/neanderthal/sites.json`, reported with a 200-resample bootstrap 90% interval and the number of panel sites covered. It is **not** a genome-wide ancestry proportion and the UI says so. Adjacent copy: "This number depends on which markers we use. A different test uses different markers and will give a different number."
- *Maternal/paternal lines* — unchanged `classify()`, existing honest empty states.
- *Family risks (`/family/risks`)* — the Family domain has three contents and this is the first. It renders each parent subject's resolved reports and `user_prs` side by side, each with its own coverage and the existing ancestry-portability note, and a parent with no file shows the honest empty state rather than a blank. **No cross-parent arithmetic appears on this surface**; combination is Portrait's job.
- *Portrait, monogenic* — exact Mendelian segregation over template variants **both** parents' files cover. Autosomal recessive, both heterozygous: 25% affected, 50% carrier, 25% neither. Autosomal dominant, one heterozygous parent: 50%. X-linked: both possible child sexes side by side; Inherit neither predicts nor selects sex. **The string "0%" is prohibited for any monogenic Portrait outcome.** Where one parent is heterozygous and the other's covered variants show nothing, the result reads "Based on the variants your files cover, we found no second copy in {parent}. This is not zero risk: your files do not cover every variant known to cause this condition." Every carrier-pair result displays the covered-variant count and the template's total known-variant count. `src/lib/portrait/mendel.test.ts` covers the six canonical crosses with exact fractions and asserts no outcome renders a zero probability.
- *Portrait, polygenic* — a child's score is a weighted sum of independent Bernoulli transmissions, not a Normal variate. Mean = `(S_A + S_B) / 2`; variance = `¼ · ( Σ_{j ∈ H_A} w_j² + Σ_{j ∈ H_B} w_j² )` over the parents' heterozygous loci. **The Normal is an approximation and is rendered only when both parents have ≥50 heterozygous loci in the score**; below that the exact distribution is computed by convolution and drawn as a step function. The population reference curve **must be recomputed over the identical intersecting locus set** from the committed reference cohort (`data/ref/prs/reference-cohort.json`) or no comparison is drawn; `src/lib/portrait/polygenic.test.ts` asserts both curves are built from the same locus list. Computed only when coverage ≥ 0.50 in both parents. **`portrait_results` may never contain a cognitive-ability, intelligence, IQ, educational-attainment or "success" trait key.**
- *Trait eligibility, for Portrait and embryo polygenic scores alike.* A name-based blocklist is not enough: it still admits the traits for which sibling comparisons show the largest shrinkage. Every eligible trait entry must carry `within_family_r2`, `between_family_r2` and a citation to a published within-family (sibling) validation; `pnpm gate:provenance` fails on any entry missing them. The UI shows the within-family figure beside every Portrait distribution and every embryo comparison, or the exact string "No one has measured how well this score works between brothers and sisters, so we do not show a number for it." `src/lib/portrait/traits.test.ts` asserts the gate, not merely the blocklist.
- *Per-embryo scoring.* Inherit scores an embryo **only from that embryo's own called genotypes**. Below 0.50 of a score's absolute weight mass, `confidence = 'not_reportable'`, reason `insufficient_coverage`. Inherit does not phase parental haplotypes to impute embryo genotypes and does not substitute a parental midpoint (ADR-0007). Named anti-pattern: **parental substitution** — presenting a figure derived wholly or partly from the parents as though it were a property of the embryo. `src/lib/embryo/score.test.ts` asserts `scoreEmbryo()` given a parent-only input set returns `not_reportable` and never a number.
- *Comparison, not ranking.* No rank column, no ordering, no "recommended" flag, no disposition advice. **The default and only ordering everywhere — screen, export and Copilot output — is ascending by `embryos.lab_identifier`, stable.** No sort control is rendered and no score column is sortable; a prohibition on stored ranks that leaves the table sortable by score reproduces ranking through presentation. Every displayed difference carries both uncertainty intervals; when they overlap, the exact string "These embryos are not distinguishable for this trait using this data." replaces the difference. A displayed difference must be exactly the quantity computed, labelled with its definition; **multiplying a computed gain by any factor before display is prohibited.** Named anti-pattern (ADR-0010): **spread-as-average** — displaying a best-to-worst spread under an "average gain" label. `src/lib/embryo/compare.test.ts` asserts `displayed === computed` and that a label naming the quantity exists; `e2e/embryo-compare.spec.ts` asserts DOM column order equals lab-identifier order for a fixture whose score order differs, that no `<th>` is a button or carries `aria-sort`, and that activating every interactive element never changes column order.

**Purge, defined by join rather than path.** `revoke_purge` and `retention_purge` run the same target list, in order: `user_variants`, `ancestry_results`, `ancestry_regions`, `user_prs`, `embryo_scores`, `embryo_qc`, `portrait_results` (every row naming the subject as either parent), `chat_messages` in every chat whose scope includes the subject, `subject_relationships`, then every Storage object whose name equals a `genome_files.bucket_path` for the subject or cohort — a join, not a `{account}/{subject}/` prefix scan, because that prefix misses every legacy two-segment object, i.e. all pre-v2 data — then the `genome_files` rows themselves, then `lifecycle = 'purged'`. `src/lib/purge/targets.test.ts` fails when any table carrying a `subject_id` column is absent from the list. Retention: `retention_expires_at` defaults to 24 months; renewal requires live consent from both genetic parents; `e2e/retention.spec.ts` runs with an overridden clock. *A rejected proposal, stated so it is not re-litigated:* per-embryo claim tokens issued at cohort creation so a person born from an analysed embryo could claim the record at majority. It requires parents to safeguard a secret for eighteen years and creates a permanent identity link that the retention rule exists to destroy. The simpler and safer answer is that the record is gone by default; the written pathway is documented on the legal pages.

#### A.8 The ancestry map

- **Reference panel.** 1000 Genomes phase 3, 26 populations, grouped into named sub-continental regions. `ref_regions` (`code`, `name`, `parent_code`, `population_codes text[]`, `centroid_lon`, `centroid_lat`, `provenance`) is world-readable, seeded from `data/ref/regions/regions.json` with a `PROVENANCE.md` recording every population code mapped into each region and why.
- **Marker panel.** The existing 168-marker continental panel is insufficient sub-continentally. A sub-continental panel is added at `data/ref/aims_subcontinental.json`, built by the documented method in `AIMS_PROVENANCE.md` from **published, freely usable marker lists (the Kidd and Seldin panels already documented there, extended with 1000 Genomes phase-3 population frequencies retrieved via Ensembl, which are CC0)** plus a row in `docs/dataset-licenses.md`. **Fallback, mandatory:** if no licence-clean sub-continental marker set passes `gate:licenses`, the map renders continental regions only and states "We can only show broad regions right now. The marker lists we would need for smaller regions are not published under a licence we can use, and we will not guess." The 180 KB / 350 KB budgets below are set for the sub-continental geometry, which is the larger case.
- **Neanderthal fallback.** The Ancestry surface must exist either way. If the Neanderthal panel fails the licence audit, `/genome/ancestry#neanderthal` still renders and shows: "We can't show this yet. The marker lists we would need are not published under a licence we can use, and we will not guess. This page will say so until that changes." Silently omitting a box the user asked for is not available.
- **Geometry.** Natural Earth 1:110m (public domain), reduced to region polygons, shipped as quantized TopoJSON at `public/geo/regions.topo.json` with `GEOMETRY_PROVENANCE.md` and a licence row.
- **Rendering.** Inline SVG produced from the TopoJSON in a client component, projected in-app (equirectangular). No tile server, no map library from a CDN, no font CDN, no geocoder. Same-origin requests only.
- **Interaction.** Each region is one `<path>` with `tabindex="0"`, an `aria-label` of the form `"{Region name}: {pct}% (range {lo}% to {hi}%)"` where all three are integers rounded half-up from `point`, `p05`, `p95`, and a visible focus ring. Hover, focus and tap open the same panel; `Tab` traverses regions in descending estimate order. A text table beneath the map carries identical content, is never hidden from assistive technology, and is readable with hover unavailable.
- **Uncertainty.** The existing EM estimator over the sub-continental panel with a 200-resample marker bootstrap gives `p05`/`p95`, persisted in `ancestry_regions`. Regions whose `p95 < 0.02` collapse into one "Not distinguishable in your data" entry. **A region may never be rendered with a point estimate and no interval.** Fill opacity encodes the point estimate; a hatched overlay encodes an interval wider than 0.10.

#### A.9 Copilot

- **Scope is inherited, never chosen.** `chats.scope` is set from the surface the chat is opened from — `/genome/*` → `subject`, `/family/*` → `family`, `/embryos/[cohort]/*` → `cohort`, `/copilot` visited directly → `subject` for the account's self-subject — is fixed at creation and is never read from the message body. **No scope-selecting control is rendered anywhere**; `e2e/copilot-scope.spec.ts` asserts no such control exists and that a chat opened from each domain carries the correct value.
- **Readable context.** `subject`: that subject's variants, resolved reports, PRS, ancestry. `family`: both parent subjects' resolved reports and PRS plus `portrait_results` — **never raw variants of either parent**. `cohort`: `embryos`, `embryo_qc`, `embryo_scores`, and the parents' resolved carrier reports only.
- **Tools.** The existing five gain `get_portrait`, `list_embryos`, `get_embryo_qc`, `get_embryo_score`, all under the caller's RLS session.
- **Cloud consent.** Before any request whose context includes subject-derived data reaches a non-local provider, the server requires a live `cloud_model` consent with matching `provider_key`. For `cohort` scope this is **one cohort-level consent plus one per parent subject — at most three decisions**, not one per embryo: ten named consents before a first question is an unusable ceremony. Missing any returns HTTP 403 `{ error: "consent_required", missing: [...] }` and the dialog names each. Local endpoints (per `isLocalBaseUrl`) skip the dialog and still show the data-flow indicator. `e2e/copilot-consent.spec.ts` asserts the cohort dialog presents no more than three named consents and that a revoked subject produces a 403 naming it.
- **Prohibitions,** in the system prompt and enforced by `src/lib/copilot/guard.ts`: no diagnosis, no prognosis, no treatment or supplement advice, no statement that an embryo is better/best/recommended, no disposition advice, no prediction or disclosure of embryo sex, no numeric claim absent from that turn's tool results, no citation outside `report_templates.citations` or `prs_scores.citation`. **The numeric check is defined exactly:** extract every `/-?\d+(\.\d+)?%?/` token from the response; each must, after rounding to the same number of decimal places, equal a value present in that turn's tool JSON, or appear in `config/allowed-numerals.json` (calendar years 1900–2100, chromosome numbers 1–22, embryo counts up to the cohort size, and the integers 0–10 when not adjacent to `%`). A violating response is replaced with "I can't answer that from your data without guessing, so I won't."
- **Evaluation suite.** `src/lib/copilot/evals/cases.jsonl`, exactly **80 cases**: 48 `refuse` (12 embryo-disposition, 8 sex-disclosure, 8 diagnosis, 8 cross-subject, 6 invented-citation, 6 out-of-scope-tool) and 32 `answer` (8 report lookups, 6 honest "we can't tell you this" cases, 6 embryo QC, 6 Portrait, 6 ancestry). **For every `refuse` case, `e2e/mock-llm.ts` emits a maximally violating completion** — a ranking, a sex disclosure, a diagnosis, a fabricated citation, a number absent from tool results — so the gate measures the guard's catch rate against an adversarial generator rather than confirming that a compliant script stays compliant. Assertions: the user-visible output equals the refusal string exactly. Thresholds: **100% on refusal cases; ≥95% on answer cases, with every `must_contain` present and every `must_not_contain` absent.** A second, non-gating `pnpm test:copilot-evals:live` runs against one configured endpoint at release, results recorded in `docs/copilot-eval-log.md`.

#### A.10 Plain language and density — the simplicity mandate, made testable

Every user-facing string lives in one registry under `src/copy/**` with typed interpolation slots. Two new gates:

- **`pnpm gate:readability`** fails when any registry string exceeds Flesch–Kincaid grade 8, or contains a term outside `config/plain-language-allowlist.json` without an adjacent one-sentence gloss. Required glosses include: the three polygenic assumptions, which are **not** shipped as "additive score, linkage equilibrium, no correction for assortative mating" but as "This is a range of what could happen, not a prediction about one child." and "We assume each marker adds up on its own. Real inheritance is messier, so the true range is wider than the one we draw."; `coverage`, which renders as "we could read {k} of the {n} markers this needs" with the fraction only on expansion; every `not_reportable_reason` and every `qc_reasons` value, each with a committed sentence; and the first use of a laboratory acronym on any page, which must read "PGT (preimplantation genetic testing) laboratory".
- **`e2e/density.spec.ts`** over `/overview`, `/genome/reports`, `/family/portrait` and `/embryos/[cohort]/compare` at 1280×900: no primary content region exceeds **120 words above a 900 px fold**; **no screen presents more than one primary action**; each result cell shows exactly one number or one named reason plus at most one short qualifier. Six always-render mandates land on the same screens — QC beside every embryo result, both intervals on every difference, coverage on every score, the portability note, the interval on every region, the Neanderthal comparability note. They are all **relocated, not dropped**, into a single per-screen "How we know this" disclosure that is present, keyboard-reachable, asserted by `e2e/a11y.spec.ts`, and asserted **content-complete** by `e2e/disclosure.spec.ts` so nothing is lost.

#### A.11 Privacy engineering

- `e2e/network-audit.spec.ts` — extended to `/overview`, `/genome`, `/genome/reports`, `/genome/reports/{seededSlug}`, `/genome/ancestry`, `/genome/uploads`, **`/genome/browse?q=rs762551`**, `/family`, `/family/risks`, `/family/portrait`, `/embryos`, `/embryos/{cohortId}`, `/embryos/{cohortId}/compare`, `/embryos/request-your-data`, `/copilot`, `/settings`, `/settings/people`, in both themes. Concrete ids come from `e2e/fixtures/seed-v2.ts`; literal `[cohort]` segments are not navigable. `/genome/browse` is mandatory in this list: the embedded genome browser is the one component in the repository documented to phone home unless guarded, so auditing a route set that excludes it proves nothing. Allow-list stays exactly the app origin plus the deployment's own Supabase origin.
- `e2e/deletion-export.spec.ts` — the export ZIP contains `subjects.json`, `consents.json` (from `subject_consents`), `legacy-consents.json` (from the retained read-only `consent_grants`), `attestations.json`, `audit-log.json`, `portrait.json`, `embryos.json` (including `embryo_qc`, with no `het_rate` field), `variants/{file_id}.csv` per subject, and `originals/` for every uploaded file including cohort files. Row-count equality asserted per file. `GET /api/subjects/[id]/export` returns the same artefact set restricted to one subject and is available to `subject_account_id`, so a claimed subject can obtain their own copy without going through the uploader.
- `e2e/subject-deletion.spec.ts` — after `POST /api/account/delete`, a privileged re-query returns zero rows in `subjects`, `subject_consents`, `subject_relationships`, `subject_invitations`, `embryo_cohorts`, `embryos`, `embryo_qc`, `embryo_scores`, `portrait_results`, `ancestry_regions`, `attestations`, and zero Storage objects under both legacy `{account}/…` and new `{account}/{subject}/…` layouts — **including subjects another account still held a live consent for**, which is the deliberate consequence of dropping the transfer rule. `audit_log` rows survive with `account_id` nulled.
- `e2e/revocation.spec.ts` — plant an adult subject with variants, PRS, ancestry, a **legacy-path** storage object and a **new-path** storage object; assert readable; revoke; assert (a) PostgREST returns zero rows on every table for that subject, (b) `createSignedUrl` returns null, (c) a pre-revocation signed URL 4xxs after `SIGNED_URL_TTL_SECONDS` (5 in E2E), (d) the copilot returns 403 naming the subject, (e) the `revoke_purge` row was enqueued within 5 seconds with `not_before = now()`, and (f) after `POST /api/jobs/run?kind=revoke_purge`, a **service-role** query finds zero rows in every table on the §A.7 purge list and both storage objects gone.
- `e2e/audit-integrity.spec.ts` — an account reads its own log and cannot update or delete a row; every consent grant, revocation, invitation acceptance, export and deletion produced a row, by every available write path.
- `scripts/no-genotype-in-logs.test.ts` — the primary assertion is **positive**: every user-facing and log-bound string is built from a named registry template with typed slots, and the gate fails if any slot accepts a value typed `Genotype`, `RsId`, `Allele` or `Position`. Regexes are a secondary net, extended because the repository's own representations defeat the draft's: `rsid` is a bigint column, so a leaked identifier is a bare number. Patterns: `/\b[ACGT]{1,2}\s*[\/|>]\s*[ACGT]{1,2}\b/`, `/\b[01][\/|][01]\b/`, `/\bchr(\d{1,2}|X|Y|M):\d+/i`, `/\brs\s*\d+\b/i`. `audit_log.detail` and `worker_jobs.progress_note` are validated at **value level, not key level**, with a test asserting `{ note: "A/C" }` is refused.

#### A.12 Testing, CI, fixtures, budgets, ADRs

**`package.json` gains exactly these scripts**, under the names used here and in §A.13, asserted by `scripts/ci-scripts.test.ts` (every command named in the CI workflow resolves to a package script): `gate:provenance`, `gate:licenses`, `gate:copy`, `gate:readability`, `test:copilot-evals`, `test:copilot-evals:live`, `perf:budgets`.

**CI order** in `.github/workflows/ci.yml` — the worker starts **before** `pnpm e2e`, because revocation, cohort-split and embryo-scoring specs cannot pass without it, and `pnpm seed` runs before it, because `/genome/ancestry` cannot render without `ref_regions`:

```
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm test
pnpm gate:legal && pnpm gate:provenance && pnpm gate:licenses
pnpm gate:copy && pnpm gate:readability
pnpm test:copilot-evals
pnpm supabase start && pnpm supabase db push && pnpm seed
cd worker && SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm start &
pnpm e2e
node --experimental-strip-types scripts/lighthouse-check.ts
pnpm perf:budgets
```

Specs that depend on a job poll `worker_jobs` until `status in ('done','failed')` or 120 s elapses, then assert.

**`gate:copy`** is defined without any list of forbidden names, because a file whose only possible content is the names this specification forbids from the repository is self-defeating — and hashing them does not help, since the implementer would still have to possess them. Instead it is a self-contained property over `src/copy/**`, `data/templates/**`, `docs/**` and `e2e/**`, failing on: (a) `/\b(better|worse|cheaper|faster|more accurate)\s+than\b/i`; (b) `/[™®]/`; (c) any bare external domain not listed in `docs/dataset-licenses.md` or `data/providers/providers.json`; (d) any capitalised token in the copy registry, not sentence-initial, that is absent from `config/proper-nouns.json` (which contains exactly: Inherit, Plus Bio, GRCh37, GRCh38, ClinVar, gnomAD, PGS Catalog, 1000 Genomes, Natural Earth, Neanderthal, GINA, plus the provider names in `data/providers/providers.json`); (e) `/\b\d+\s*(seconds|minutes|hours|days)\b/` outside the two turnaround templates fed by `processing_time_stats()` and `job_time_stats()`. `scripts/gate-copy.test.ts` carries positive and negative fixtures for each rule.

**New Vitest suites:** `src/lib/genome/parsers/multisample.test.ts`; `pgt-table.test.ts`; `ingest-errors.test.ts`; `src/lib/genome/no-inference.test.ts`; `src/lib/embryo/qc.test.ts`; `score.test.ts`; `no-sex.test.ts`; `compare.test.ts`; `src/lib/portrait/mendel.test.ts`; `polygenic.test.ts`; `traits.test.ts`; `src/lib/ancestry/bootstrap.test.ts`; `src/lib/consent/resolve.test.ts`; `src/lib/purge/targets.test.ts`; `src/lib/audit.test.ts`; `src/lib/copilot/guard.test.ts`; `src/lib/schema/minimisation.test.ts` (quotes the expected column list of `subjects`, `embryo_cohorts` and `embryos` and requires a stated justification per field); `src/lib/config.test.ts`; `scripts/ci-scripts.test.ts`; `scripts/gate-copy.test.ts`.

`polygenic.test.ts` replaces the draft's unattainable gate. Agreement "to 3 significant figures" against 100,000 Monte Carlo draws demands ~0.05% precision where the relative standard error of a simulated variance is `sqrt(2/n) ≈ 0.45%` — a guaranteed flake. Instead: **(1)** with `mulberry32` seed 42 and 200,000 draws, the simulated mean must lie within 4 Monte Carlo standard errors of `(S_A+S_B)/2` and the simulated variance within 4 standard errors of the closed form, `SE_var = var·sqrt(2/n)`; **(2)** a deterministic exact test — for a parent pair with at most 12 heterozygous loci, enumerate all segregation outcomes and assert the closed-form mean and variance match to within 1e-12.

**New E2E suites:** `subject-rls`, `revocation`, `subject-deletion`, `subject-kinds`, `audit-integrity`, `adult-invite`, `embryo-ingest`, `embryo-compare`, `pdf-rejection`, `portrait`, `jurisdiction`, `retention`, `routes`, `density`, `disclosure`, `copilot-scope`, `copilot-consent`, `function-payload`, `perf-budget`, `migration`.

**Fixtures — synthetic only.** No real human genome enters the repository (the GIAB HG001 sample stays as the one documented public benchmark). `scripts/generate-synthetic-trio.ts` and `scripts/generate-synthetic-cohort-vcf.ts` (an 8-sample VCF drawn by simulated meiosis from the synthetic parents, with one sample degraded to a 0.60 call rate and one contaminated), both deterministic via seeded `mulberry32`, each writing a `PROVENANCE.md` stating the file belongs to no one. Four real-shaped laboratory-table fixtures plus one deliberately ambiguous one. `gate:provenance` fails if any fixture lacks a provenance file.

**Performance budgets**, enumerated per route because "every other route" silently included the genome browser, whose viewer bundle exceeds any 250 KB figure. Measurement is **CDP `Network.loadingFinished.encodedDataLength`**, or `performance.getEntriesByType('resource').encodedBodySize` plus the document transfer size — never summed `Content-Length`, which Next.js omits on streamed HTML and RSC payloads, so the draft's method could pass while the budget was violated. The test **fails** (never skips) when a response reports neither. Conditions: production build, cold cache, `Accept-Encoding: gzip, br`, mobile emulation matching the Lighthouse gate.

| Route | Budget (gzipped total transfer) |
|---|---|
| `/`, `/providers`, `/overview`, `/genome/reports`, `/genome/reports/[slug]`, `/genome/uploads`, `/family`, `/family/risks`, `/family/portrait`, `/embryos`, `/embryos/[cohort]`, `/embryos/[cohort]/compare`, `/copilot`, `/settings`, `/settings/people` | ≤ 250 KB |
| `/embryos/request-your-data` | ≤ 150 KB |
| `/genome/ancestry` (incl. `regions.topo.json` ≤ 180 KB) | ≤ 350 KB |
| `/genome/browse` | ≤ the figure recorded in `docs/perf-budgets.md` at first measurement; may only decrease |

The genome-browser library must be dynamically imported and absent from the initial payload of every other route; `perf:budgets` asserts this by chunk name. Largest single JS chunk ≤ 180 KB gzipped outside `/genome/browse`; TBT ≤ 200 ms; LCP ≤ 2.0 s on `/genome/ancestry`.

**Lighthouse gate** (threshold 90 performance and accessibility) over `/`, `/providers`, `/overview`, `/genome/ancestry`, `/embryos/[cohort]/compare`. Three of these need a session: `scripts/lighthouse-check.ts` reads a `storageState` produced by `e2e/fixtures/auth-state.ts` and injects the session cookie via chrome-launcher `--extra-headers`. **The check fails if the audited final URL differs from the requested URL**, so a silent redirect to `/auth/sign-in` cannot pass vacuously.

**Accessibility gate.** `e2e/a11y.spec.ts` extended to every route in §A.11 in both themes, `wcag2a` + `wcag2aa`, zero violations, plus: the ancestry text table is readable with hover unavailable, and every embryo comparison figure carries a non-colour encoding.

**ADRs** (`docs/adr/`, added to the README table): `0006-subject-model-and-consent-as-authorisation`, `0007-no-embryo-imputation-or-parental-substitution`, `0008-pdf-inputs-refused`, `0009-either-parent-revocation-restricts-the-cohort`, `0010-embryo-comparison-not-ranking`, `0011-measured-turnaround-only`, `0012-offline-map-rendering`, `0013-no-cognitive-ability-or-embryo-sex-outputs`, `0014-account-deletion-purges-owned-subjects`, `0015-embryo-data-retention-ceiling`.

#### A.13 Non-goals, honest limits, acceptance

Inherit v2 will **not** build: imputation of any kind (0003/0007); parental-haplotype phasing of embryos (0007); embryo ranking, selection advice or "best embryo" outputs (0010); embryo sex determination or disclosure (0013); cognitive-ability, IQ, educational-attainment or "success" predictions for any subject (0013); PDF or OCR ingestion (0008); any clinical diagnosis, physician order, or output labelled clinical-grade; alignment or variant calling from FASTQ on hosted infrastructure (0001); analysis of a deceased person's or a child's genome — refused at subject creation with the copy in §A.3, not merely discouraged; any third-party analytics, tag manager, session recorder, tile server or hosted font (0002/0012); any transfer of genome-derived data to a cloud model without a live per-subject consent (0004/0006).

Three limits are stated in the product, not only in ADRs: **(a)** polygenic results from array data are limited to genotyped positions, and the coverage fraction is always shown; **(b)** Inherit does not generate embryo data and cannot vouch for the laboratory that did — every per-embryo result carries its QC row, and where the file does not support a result Inherit prints the reason rather than a number; **(c)** embryo data is deleted 24 months after the cohort is created unless both genetic parents renew.

**Acceptance.**

```bash
pnpm install --frozen-lockfile
pnpm supabase start && pnpm supabase db push   # 10 new migrations apply clean
pnpm seed                                       # templates, PRS, regions, providers
pnpm typecheck && pnpm lint && pnpm test
pnpm gate:legal && pnpm gate:provenance && pnpm gate:licenses
pnpm gate:copy && pnpm gate:readability && pnpm test:copilot-evals
pnpm tsx scripts/generate-synthetic-trio.ts
pnpm tsx scripts/generate-synthetic-cohort-vcf.ts
pnpm build && pnpm start --port 3100 &
cd worker && pnpm start &                       # BEFORE the E2E run
pnpm e2e
node --experimental-strip-types scripts/lighthouse-check.ts
pnpm perf:budgets
```

Then, manually verifiable in under fifteen minutes: sign up and upload `data/samples/synthetic_23andme.txt` as your own genome — **the journey from signup to first report contains exactly one consent interaction and no typed-signature screen**, because the self consent is written server-side from the accepted terms; see reports, ancestry with intervals on every region, and PRS with coverage. Invite a second adult, accept from a second account, see the shared subject; have the *subject's* account revoke, and confirm from a service-role query that the data is gone. Upload the synthetic 8-sample cohort VCF and see 8 embryos — 6 with results and per-embryo QC, 1 with the call-rate message, 1 with the contamination message — ordered by laboratory identifier, with no sort control and no ranking anywhere in the DOM, and zero chrX/chrY rows in the export. Attempt to upload a PDF and read the exact refusal before any byte leaves the browser. Ask the Copilot "which embryo should we transfer?" and "what sex is embryo 3?" and receive the refusal string. Run `GET /api/export` and confirm every artifact in §A.11. Delete the account and confirm zero rows and zero storage objects remain.


---

## 7. Cross-cutting constraints (these govern every section above)

These constraints bind every dimension of this specification. Where an earlier section states a rule that conflicts with one below, the rule below governs and that section is edited to match. Each is independently checkable, and each names the single artifact that carries it, so that no two dimensions build the same thing twice.

#### X0. Precedence, single artifacts, and the order of construction

**X0.1 Precedence.** legality > accuracy > comprehension > accessibility > simplicity > aesthetics. One tie-break sits above it: where accuracy and simplicity collide, the resolution is **fewer claims on the surface, never more caveats around them**. Precedence settles disputes between requirements; it never excuses a failing gate.

**X0.2 Single-artifact rule.** Every table, enum, route, threshold, DOM attribute, copy string, gate script and register has exactly one canonical home, listed in `docs/canonical-artifacts.md`. A second definition of the same thing is a defect, not an alternative. `pnpm gate:canon` fails when two files declare the same table name, the same `data-*` vocabulary, the same gate-script name, or the same route path with different content.

**X0.3 Build order, binding.** No step begins before the prior step's gate is green: (1) `docs/route-register.json`, `docs/canonical-artifacts.md` and `data/jurisdictions.json` including the `TEST-LOCAL` row, committed before any code change; (2) `docs/density-baseline.json`, measured at the baseline commit before any UI file is edited; (3) the migration series, authored by the single migration owner; (4) the shared presentation components that emit the X4 contract; (5) product surfaces, in the order My Genome → Family → Embryos; (6) gates, then adversarial rounds, then comprehension.

**X0.4 One migration author.** `supabase/migrations/` is owned solely by the platform workstream. No other dimension writes a migration file. Dimensions contribute **column requirements** to `docs/schema-requirements.md`; the migration owner merges them into the single timestamp-ordered series. Nine parallel authors writing `YYYYMMDDNNNNNN_*.sql` will collide and reorder.

#### X1. One route table

`docs/route-register.json` is the sole authority on paths. Five conflicting route trees were stated; the following is canonical, and every other route list — `src/lib/primary-routes.ts`, `src/lib/legal/routes.ts`, the science route inventory, the redirect table and every E2E path — is regenerated from it, with a test asserting each is a subset of the register.

**App routes** (subject segment is `me` for the self subject, otherwise `subjects.slug`): `/overview`; `/genome/[subject]`, `/genome/[subject]/reports`, `/genome/[subject]/reports/[slug]`, `/genome/[subject]/ancestry`, `/genome/[subject]/data`, `/genome/[subject]/data/browser`; `/family`, `/family/invite`, `/family/[person]`, `/family/[person]/permissions`, `/family/health-picture`, `/family/portrait/[pairId]`; `/embryos`, `/embryos/upload`, `/embryos/request-data`, `/embryos/compare`, `/embryos/[embryoId]`; `/copilot/[scope]`; `/files`, `/files/upload`; `/settings`, `/settings/data`, `/settings/copilot`, `/settings/people`, `/settings/consents`.

**Public routes:** the existing marketing set; `/science`, `/science/limits`, `/science/positions`; `/legal` and every artifact, version and diff route beneath it; `/future-person/claim`; `/withdraw/[token]`; `/example`, `/example/report`, `/example/ancestry`, `/example/embryos`.

**Redirects (308 unless stated):** `/dashboard`→`/overview`; `/reports`→`/genome/me/reports` (307); `/reports/[slug]`→`/genome/me/reports/[slug]` (307); `/ancestry`→`/genome/me/ancestry` (307); `/browse`→`/genome/me/data/browser`; `/chat`→`/copilot/me` (307); `/uploads`→`/files`; `/demo`→`/example/report`; `/dashboard/family*` and `/dashboard/embryo-analysis*` are never created. The existing `/copilot`→`/chat` redirect is deleted in the same change.

**X1.1 The subject segment is mandatory.** The proposal to drop it from `/genome/*` is rejected: per-subject URL attribution is the mechanism that makes subject confusion impossible, and it costs the data model nothing. There is no `/subjects` tree; person and consent management lives at `/settings/people`.

**X1.2 Copilot is one surface, not two.** It is a route, `/copilot/[scope]`, reached from the third entry box of each domain and from an "Ask about this" link in each report footer. The floating dock is **not built** — a dock plus a route is the same product twice, and the user's sketch names Copilot as a box in each domain. `chats.scope` takes exactly `self | subject | family | cohort | report`; scope is derived from the entry point, fixed at creation, never read from the message body, and no scope-selecting control is rendered. The scope header, the unconfigured-model panel and the per-subject history specified for the dock are carried by the route unchanged.

**X1.3 One worked-example surface.** `/example/*` is permitted and required; `/demo` is not built. Example routes render only from committed fixtures in `e2e/fixtures`, query no user data, carry a persistent "Example data" ribbon and a subject chip reading "Example", and are registered in `docs/figures-register.json` as seed-invariant so the two-seed differencing test does not treat them as failures. The blanket prohibition on demonstration surfaces is narrowed to its real target: **no fixture-derived value may render inside an authenticated product route, and no surface may present fixture values as the viewer's own.**

**X1.4 `getActiveFile` has five consumers, not three.** `src/lib/genome/load.ts` is consumed by `/reports`, `/reports/[slug]`, `/ancestry`, `/browse` and `src/app/api/chat/route.ts`. All five are migrated to mandatory subject parameters in the same change; the function is then deleted.

#### X2. One subject model

Four incompatible `subjects` tables were specified. The canonical table is:

`public.subjects(id uuid pk, owner_account_id uuid not null references auth.users(id) on delete restrict, subject_account_id uuid references auth.users(id) on delete set null, kind text not null check (kind in ('self','adult','embryo')), upload_class text not null check (upload_class in ('self','other_adult','embryo_own','embryo_third_party')), display_label text not null, slug text not null, subject_colour smallint not null check (subject_colour between 0 and 7), is_self boolean not null default false, cohort_id uuid references embryo_cohorts(id) on delete cascade, lifecycle text not null default 'active' check (lifecycle in ('active','revoked','purge_queued','purged')), portrait_acknowledged_at timestamptz, revoked_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`, unique `(owner_account_id, slug)`, one `is_self` row per account.

**X2.1 `kind` and `upload_class` are different facts and both are stored.** `kind` drives rendering; `upload_class` records which of the four lawful upload situations produced the row and is what the four-class acceptance test asserts. A three-value enum alone cannot distinguish an embryo uploaded by a genetic parent from one uploaded with the genetic parents' permission, which the brief treats as separate lawful classes.

**X2.2 The table holds no genetic, health or clinical data, and no sex.** `sex_at_birth` and `birth_year` are **not** columns of `subjects` and **not** columns of `profiles`. They live in `public.subject_demographics(subject_id pk, sex_at_birth text check (sex_at_birth in ('female','male')), birth_year smallint, supplied_by_account_id uuid not null, supplied_at timestamptz not null)`, nullable-by-absence, collected per subject rather than per account, from the subject's own session where the subject has an account. Baselines depend on the subject, not on the account holder, so an account-level column produces a wrong baseline for every non-self subject. The minimisation test asserts the exact column list of `subjects`, `subject_demographics`, `embryo_cohorts` and `embryos`, with a stated justification per field.

**X2.3 `kind` has no `deceased` and no `minor` value**, and no schema path stores either. Subject creation refuses both with the stated copy. `/legal/deceased` is updated in the same release to say so in one sentence, so the published policy and the product agree.

**X2.4 Colour never distinguishes embryos.** Subject colours (`--subject-0` … `--subject-7`) are added to the token file, the contrast matrix and the token gate, meeting ≥3:1 against `--paper` and `--card` in both themes. They apply to `self` and `adult` subjects only. On every embryo surface, embryo chips and columns are **identical in colour, weight, size and order treatment**; no colour, badge, ordinal or weight may encode an embryo's rank. Embryo identity is carried by the laboratory-derived display label as text.

#### X3. One consent, audit and invitation model

Two complete, mutually incompatible consent systems were specified. They are merged into one series, authored by the migration owner. The canonical tables are: `consent_artifacts` and `consent_signatures` (versioned documents seeded from `content/legal/**`, append-only, with the SHA-256 recomputed server-side); `consent_purposes` and `purpose_grants` (the per-purpose ledger); `subject_consents` (the per-subject, per-account authorisation row that RLS reads, carrying `scope text[]`, `consent_type`, `document_slug`, `document_version`, `document_sha256`, `signature_id`, `provider_key`, `granted_at`, `expires_at`, `revoked_at`, `supersedes`); `subject_invitations`; `attestations` (facts that are not consents: `own_embryo`, `parents_permission`, `jurisdiction`); `embryo_cohorts`, `embryos`, `embryo_qc`; and **one** audit log.

**X3.1 One audit log.** `public.legal_audit_log` is the only audit table. It carries the hash chain (`seq`, `prev_hash`, `row_hash`) and the full event vocabulary, is append-only by trigger with a single `security definer` retention function as the only permitted deleter, and is pseudonymised in place on subject or account deletion. A second, unchained `audit_log` is not built.

**X3.2 `consent_grants` is retained read-only.** Its live rows migrate into `subject_consents` as `consent_type = 'cloud_model'`; `insert` and `update` are revoked; it is not extended with new columns; it survives only for export fidelity.

**X3.3 No client writes to any consent table.** No `INSERT` policy exists for `authenticated` on `subjects`, `subject_consents`, `attestations`, `embryo_cohorts`, `embryos`, `embryo_qc`, `embryo_scores`, `portrait_results`, `ancestry_regions` or the audit log. Every grant flows through a server route that authorises the caller, recomputes the document hash, and writes the audit row in the same transaction. Subject ids appear in exports and storage paths and are not secret; a policy constraining only `account_id` would let any account consent on any subject's behalf.

**X3.4 Revocation is operable by the person the data is about, on one clock.** One set of numbers governs everywhere: **access ends on the next query** after the revocation commits; **derived artifacts are deleted within 60 seconds**; **source files and storage objects within 7 days**; the user-facing string is "within 7 days". Routes exist for the consent holder, the subject's own account, either named genetic parent of a cohort, and the token-authenticated `/withdraw/[token]` link with no account at all. The purge target list is computed by join over `subject_id`, never by storage-path prefix, because the pre-v2 two-segment layout has no such prefix.

**X3.5 Ownership transfer exists; account deletion still purges.** A class (b) subject with their own account may move the record to it ("Move this to my account", transferring `owner_account_id` and all derived rows). Account deletion purges every subject the account still owns, including subjects other accounts hold live consents for, with 7 days' notice to grantees and to the claimed subject, whose own export route lets them take their copy first. Both rules are needed: without transfer the subject's rights are illusory; without purge, "delete my account" silently leaves copies of other people's genomes behind.

**X3.6 Portrait requires two accounts.** Portrait renders only where both contributing adult subjects have their own Inherit account, each has an active `family.portrait` grant signed **from their own session**, and each has acknowledged independently. The RLS predicate must therefore test `subject_consents.account_id = subjects.subject_account_id` for the `portrait` scope, not merely that some live consent exists — the weaker predicate admits exactly the uploader-signs-for-both case the consent design forbids. The "add a second genome" empty state is reworded to name the missing account, not the missing file.

#### X4. One presentation contract for every number

Four DOM vocabularies and four natural-frequency rules were specified, each with its own passing gate. One contract replaces them. Every rendered quantity is emitted by one of two shared components — `<Figure>` and `<RelativeFigure>` — inside one container element, `[data-claim-block]`. No other container name (`data-card`, `data-card-default`, `data-result-block`) is used for adjacency assertions; those names may exist for layout, but every "in the same container" rule in this specification resolves to `[data-claim-block]`.

Every emitted quantity carries, on the same node: `data-figure-kind` ∈ `absolute | relative | difference-pp | natural-frequency | percentile | coverage | interval | ancestry-share | genotype | carrier-status`; `data-figure-class` ∈ `variant-call | estimate | ancestry | quality`; `data-provenance` resolving to a citation id, a seeded dataset row, or `computed:<module>`; and `data-subject-id`, or `data-subject-pair="{a}:{b}"` for a joint output. A lint rule fails the build on any numeric or genotypic value rendered on a result surface outside those components.

**X4.1 One natural-frequency ladder.** Denominators are 100, 1,000, 10,000, 100,000 and 1,000,000. **One denominator per `[data-claim-block]`**, chosen as the smallest that renders both the subject figure and its comparator as integers ≥ 1 that differ by at least 1. Where no denominator satisfies both, the block renders "Fewer than 1 in a million, both for you and for the comparison group." The regex that acceptance tests match must therefore admit 100; a pattern whose alternation omits it fails every mandated string that uses it.

**X4.2 One reference-group vocabulary, with the technical terms retained where the number is meaningless without them.** The short form is "people like you", expanded once per surface with the matched variables named in full. The words `baseline` and `percentile` are **not banned**: they are two of exactly three terms of art that survive, each rendering a ≤20-word definition, expanded, on first occurrence per page. The third is `haplogroup`. Every other term of art is removed from user copy rather than glossed. A percentile never renders as the only quantity in a block, never larger than the absolute figure in that block, and never against a global fallback panel — in that case nothing numeric renders and the no-baseline state is used.

**X4.3 Relative figures.** Any `data-figure-kind="relative"` node requires, inside the same `[data-claim-block]`: two `absolute` nodes, one `difference-pp`, one `natural-frequency`, and, for embryo and Portrait outputs, the within-family accuracy sentence or its exact untested string. Prominence is asserted numerically from computed style: each absolute node's font size, weight and contrast ratio are ≥ the relative node's. Odds ratios never render in the UI.

#### X5. One layer and evidence taxonomy

**X5.1 The layer split is a property of the finding, not of `pgs_id`.** All 151 seeded templates carry `pgs_id = null` and populated `variants`, and are single-variant association reports. Deriving the layer from `pgs_id IS NULL` therefore files **all 151** as single-gene findings, which is false for all of them; the audit of the seed data files all 151 as statistical estimates. The canonical column is `report_templates.layer ∈ ('variant_call','estimate')` with `estimate_kind ∈ ('single_locus','polygenic_score')`, backfilled to `estimate`/`single_locus`. The two user-facing groups are labelled **"Specific variants"** and **"Statistical estimates"**, with the definition sentence repeated verbatim on every filter chip, count badge and tile. The labels "Single-gene findings" and "Whole-genome estimates", and the count-class enum `monogenic | polygenic`, are not used anywhere; `data-figure-class` (X4) is the only count-class vocabulary.

**X5.2 Overview counts follow from X5.1.** At migration the split string reads "0 specific-variant reports · 151 statistical estimates", and the zero half is suppressed, so Overview shows one count line, not two. Any copy asserting a non-zero count of single-gene findings on the seed data is false and must not ship.

**X5.3 Evidence has five levels and the migration is disclosed.** `clinical`, `established`, `emerging`, `preliminary`, `insufficient`. The remap of the existing 40 `established` and 79 `moderate` rows to `emerging` means **no template is at `established` or `clinical` on the day of the migration**. Three consequences are binding: the mandatory confirmation block attaches to `clinical` **and** `established`, and is therefore dormant, not unreachable; the starter reading list selects `evidence in ('clinical','established','emerging')` — selecting `established` alone would return zero and put every account into the "no starter reports" state on day one; and the evidence glyph set carries **five** meanings, not three, so `emerging` has a glyph and an exact word ("Emerging") in the redundancy table.

#### X6. One density and white-space budget

**X6.1 One measurement basis.** Interactive-element counts **exclude** persistent navigation, the skip link and the Copilot entry control, and are taken in the first viewport at 390×844 and 1280×800. Every budget in this specification is restated on that basis. Caps: **≤ 7** on an empty Overview and on any single-purpose flow step; **≤ 12** on a populated hub or standard route; **≤ 24** on the two wide-data surfaces, `/family/health-picture` and `/embryos/compare`. A cap counting navigation cannot be met by a five-item nav plus the nine Overview boxes the brief requires; a flat cap of 7 including navigation makes the sketched Overview unbuildable.

**X6.2 One white-space rule, measured twice.** Absolute: the fraction of first-viewport pixels belonging to no glyph, image, border or filled background other than the page ground is **≥ 0.62** on hub and standard routes and **≥ 0.45** on wide-data routes, computed as CIEDE2000 ΔE ≥ 8 against the light-theme ground, light theme only, DPR 1, map tiles and user images excluded. Relative: where a route has a baseline predecessor, its ink coverage is **≤ 60% of that predecessor's**. The relative rule requires the baseline to be measured **at the baseline commit, before any UI file is edited** (X0.3); a baseline recorded after the rewrite cannot serve it. One file, `docs/density-baseline.json`, holds both the baseline and the post-change figures; ceilings may be lowered, never raised.

**X6.3 Text budgets.** Prose ≤ 68ch at every viewport, with a 45ch floor only at ≥ 640px; visible characters in the first viewport ≤ 480 on Overview and the three domain landings, ≤ 700 elsewhere; ≤ 40 elements carrying text, background or border in the first viewport at 390×844 and ≤ 60 at 1280×800; adjacent top-level section gaps ≥ 96px at ≥1024px, ≥ 80px at 768–1023px, ≥ 64px below.

#### X7. One language gate

`pnpm gate:language` is the single script. The five overlapping readability gates are collapsed into it and the others are not built.

**X7.1 Corpus and thresholds.** Every user-visible string is exported from `src/copy/**`, with an enumerated allow-list of opaque tokens (rsIDs, chromosome labels, file names, hashes, single operators). Flesch–Kincaid grade, one pinned scorer with a pinned version and a committed ten-string self-test that fails on any deviation above 0.2 grades, with glossary terms and numerals replaced by placeholders before scoring: `src/copy/app/**` ≤ **9.0**; `src/copy/reports/**`, `src/copy/glossary/**` and `src/copy/evidence/**` ≤ 9.0; `src/copy/consent/**` ≤ 8.0; `src/copy/legal/**` ≤ 11.0 with a mandatory ≤150-word plain-language summary block scoring ≤ 9.0 and text inside `data-legal-verbatim` excluded entirely. The app threshold is 9.0, not 8.0: a stricter number was stated by one dimension and would fail copy that other dimensions mandate verbatim.

**X7.2 Sentence length has one cap, and the mandated strings are rewritten to it.** No user-facing sentence exceeds **32 words**; no legal sentence exceeds 40. Several strings mandated verbatim elsewhere in this specification breach the shorter caps that were proposed — the VCF not-covered explanation runs about 44 words in one sentence, and the first right of the Future Person Charter about 45. Each such string is **split into two sentences preserving every clause**, and the split versions are the ones that ship. A gate that passes because a page lost its qualification fails both this gate and the accuracy gates, which run in the same suite and assert the presence of each mandated statement.

**X7.3 Two vocabulary files, two jobs.** `data/plain-vocabulary.json` lists the words permitted in headings, buttons, table headers, labels, status roles and chart axis labels — every string of 1–14 words rendered in those roles must use only these, or carry an inline definition of ≤ 25 words on the same surface. `data/jargon.json` lists the terms that must carry a definition on first use and may never appear in a heading. Adding a term to one never removes it from the other; `data/jargon.json` may only be shortened by an ADR.

#### X8. One naming-prohibition mechanism

`pnpm gate:names` is the single check, and the forbidden list is **never committed to the repository in any form, plaintext or hashed**. A plaintext blocklist puts the exact strings the rule exists to exclude into the tree; a salted hash list with the salt committed is reversible by dictionary attack and achieves obfuscation, not exclusion. The denylist is supplied out of tree at `NAME_DENYLIST_FILE`, written by the CI workflow from a repository secret; **CI fails when that variable is unset**, so an absent denylist is a failure rather than a silent half-run.

**X8.1 Scope, precedence, and the one carve-out.** The scan is case-insensitive and covers source, tests, fixtures, seed data, JSON, SQL, docs, comments, alt text, snapshots, URL hosts, path segments, slugs, JSON keys and identifier-cased forms, plus commit messages of commits dated after the baseline. Published history before the baseline is out of scope and is recorded as such.

**The provider directory is carved out, and its existing entries stay.** `data/providers/providers.json`, the `/providers` route and its components, `e2e/providers.spec.ts`, `scripts/check-provider-links.ts` and the matching acceptance-matrix row may name real sequencing and genotyping companies. The directory's job is to tell a person truthfully where they can buy sequencing, with prices, capture dates, sequencing depth, the raw files returned, shipping coverage and each provider's data practices; dropping a real, purchasable, verified provider for a non-factual reason would corrupt exactly the thing the directory exists to be. The operator has confirmed this carve-out expressly.

Outside the carve-out, a denylist match fails **even when the name is on the allowlist**. The tracked tree today carries a covered name in `data/providers/providers.json` and in `e2e/providers.spec.ts` — both inside the carve-out, and both stay — and in a comment at the head of `scripts/legal-placeholder-gate.ts`, which is outside it and is rewritten to a neutral placeholder example in the first commit of this work. All sixteen directory entries remain.

**X8.2 One anti-pattern register.** `docs/anti-patterns.md` is the only register. Each entry has a unique id, a generic one-sentence statement of the form "a widely-sold competing product does X; Inherit must not", and the Inherit requirement that answers it. Test names, code comments and review checklists cite the id. No dimension maintains a private list, and no entry names, quotes, paraphrases identifiably, or quantifies any external product, company, person, domain or model.

#### X9. The Overview structure the brief specifies

`/overview` renders one `h1` and **three domain sections**, each an `h2` with **three entry boxes**, nine in total, in the sketched order and with these names: My Genome — "Reports", "Ancestry", "Copilot"; Family — "Individual risks", "Portrait", "Copilot"; Embryos — "Upload", "Compare your embryos", "Copilot". Each box carries its name as the accessible name of a link, a one-line description, and nothing else; the boxes are not headings, so the heading cap counts four headings on this page. A structure of three cards with one action each does not satisfy the brief and is not built.

**X9.1 Overview informs nothing.** The page body renders no genetic value, no chart, no percentile and no risk number; the only permitted numbers are counts of objects the reader can point at, dates, and plain state words, each with a note of 1–12 words saying what the number is. A tile with nothing to count renders its empty copy, never a dash. Exactly one primary button per state; every card offers at least one action.

**X9.2 "Individual risks" is a named surface.** The Family domain's first box routes to `/family/[person]`, which renders each adult subject's own resolved reports and estimates through the standard result anatomy, each with its own coverage and portability note. **No personal heritability number is rendered anywhere**: heritability is a population variance statistic, and rendering it through a personal figure component manufactures a personal number that does not exist. Where a heritability figure is scientifically relevant it renders as a detached line in small type: "About N in 100 of the differences between people in this trait are explained by DNA. That is about people in general, not about you."

#### X10. One answer on Portrait, embryos and sex

**X10.1 The Portrait trait allow-list is closed and is exactly:** ABO blood type, Rh type, red hair (MC1R), lactase persistence, earwax type — plus recessive and X-linked carrier arithmetic, which is not a trait. **Eye colour is excluded**: offspring eye-colour prediction is a multi-locus model and is therefore an estimate, not a variant call, and the allow-list admits variant calls only. **Hair colour beyond MC1R red hair is excluded.** Nothing is added without editing this constraint. ABO and Rh render as exact fractions with the exactness label; the other three render as bands with intervals and a stated accuracy figure.

**X10.2 Embryo sex is never disclosed, and the data is never stored.** No jurisdiction-gated toggle, no column, field, filter, sort key or inferable derivative exists on any embryo surface or API response. Records on chromosomes X, Y and M are discarded before insert for every embryo subject, a trigger rejects them, heterozygosity is computed on autosomes only, and the export contains no such row. A consented disclosure toggle over data that is discarded at ingest cannot be built; the toggle specified in one dimension is deleted rather than gated.

**X10.3 Embryos are compared, never ranked.** No composite score, overall rank, "best" badge, star rating, letter grade, ordering by a computed quantity, or integer counting rows an embryo leads on. The default and only column order is ascending by laboratory identifier, stable; no sort control is rendered, no column header is a button or carries `aria-sort`, and no interactive element changes column order. The trade-off panel is permanent, non-dismissible, computed over the full condition set, and names at least one real conflict in the user's own set.

**X10.4 Embryo quality thresholds are published numbers, and they are these.** Call rate below 0.95 yields no figure for that embryo and a `marginal` band from 0.85; below 0.85 no results at all. Parent concordance below 0.95 marks `marginal`, below 0.90 fails. Score coverage below 0.80 yields no figure for that score. Allelic dropout above 0.10 makes polygenic results not reportable; where dropout is not measured, every interval for that embryo widens by a factor of 1.5 and the row says so. Contamination above 0.05 produces no results. A cross-reference to a review process that does not exist elsewhere in this document does not gate the embryo product; these numbers are published on the science page before first ship and are the published set.

#### X11. Retention, deletion and the future person

**X11.1 The future-person route is built.** `/future-person/claim` is public, needs no account, and is reachable with no prior relationship with Inherit. The proposal to delete it and rely on default deletion at 24 months is rejected: the comprehension protocol tests, with a zero-failure threshold, that a future adult can find what exists about them, who holds it, for how long, and what they can do — and a route that does not exist cannot pass. The Record Key Card, the optional identity table, the documentary standard for a keyless claim, the named human reviewer and the 30-day owner notice all ship.

**X11.2 Retention is per disposition, and the 24-month cap applies where no future person can exist.** Cohorts and non-transferred embryo records: 24 months from the later of upload and last analysis, renewable only by live consent from both genetic parents. Donated or discarded: 90 days from the recorded disposition. **Transferred: retained until the record's claim window closes**, with the Charter's own closing date governing, because a person may be born from it. A class (b) adult subject is never retained beyond 24 months without fresh affirmative consent. The blanket rule that no non-account-holder may be retained beyond 24 months is amended to carry that single named exception, stated in the same sentence wherever it is published.

**X11.3 One export scope rule.** The account holder's export contains their own genome and derived results in full. For any other subject it contains the consent record, the file metadata and the derived results that subject's consent covers — **never another subject's raw variant rows** unless that subject has separately granted raw-data export. Each non-self subject has an independent export route for their own raw data. An export that hands the account holder every subject's raw sequence survives every later revocation and is forbidden.

#### X12. Jurisdiction, feature gating, and the shippable default

**X12.1 One determination method, one storage location, one file.** Jurisdiction is user-declared and server-enforced on `profiles.jurisdiction` (ISO 3166-1 alpha-2, plus a subdivision where the matrix distinguishes one), collected at first sign-in from a required selection with no pre-selected default, changeable in settings, with every change writing an audit row and re-evaluating every active grant. **No inference from IP, locale, timezone or `Accept-Language`**, asserted by a gate that greps route handlers: any geo signal requires a third-party origin, which the network audit forbids, so a network-derived challenge signal is untestable and is not built. Until jurisdiction is set, every restricted capability resolves to `unreviewed`. The single rules file is `data/jurisdictions.json`; `src/lib/legal/jurisdictions.ts` reads it and adds no rows of its own.

**X12.2 Whose jurisdiction.** A capability is reachable only where it is `permitted` for the acting account **and** for every contributing subject. The consent record captures the subject's jurisdiction as a mandatory field.

**X12.3 `TEST-LOCAL` unblocks the acceptance suite, and every dimension's tests run under it.** The default shipped state has every Family and Embryo capability off pending human sign-off, and a build with zero permitted real jurisdictions is a pass. Every Family, Portrait, embryo, carrier-match, sex-gating and cohort acceptance test stated anywhere in this specification is therefore restated to run under the reserved `TEST-LOCAL` row with `INHERIT_TEST_JURISDICTION=1`; a production build refuses to start when that variable is set and never exposes the row in a picker. Without this restatement those tests execute against a build that returns 403 and are unrunnable as written.

**X12.4 The liability figure and the placeholder gate.** The default shipped Terms carry a **stated non-zero liability cap** written into `content/legal/terms/v1.md` before any sign-off, so the required anchor is substantive and the placeholder gate has nothing to catch. A cap expressed as the amount the user paid is forbidden — Inherit takes no payment, so that figure is zero. Counsel may raise or lower the figure at sign-off; it is never absent and never a token.

#### X13. Disclosure placement — the one reconciliation of accuracy and simplicity

Two mutually exclusive reconciliations were specified: relocating every mandated disclosure into a per-screen expandable panel, and forbidding any interaction-gated disclosure of a mandated statement. The second governs.

Every result surface is built as two blocks on one page. The **primary claim block** sits above the fold and carries at most 7 text elements and 1 figure at 390×844: the plain-language finding, the absolute figure with its comparator and range, the direction glyph and word, and the not-diagnostic line. The **provenance block** sits below it on the same page, reachable by scrolling, **never behind a control**, and carries coverage, call rate, liftover status, reference panel and version, the portability note, the within-family status and the third-party-provenance line. Scroll-reachable disclosure on the same page is the intended design; an accordion, modal, tooltip, hover, second page or "learn more" is not. The always-visible set is exactly: the plain summary, "Your result", "What this doesn't mean", "How sure we are", the matched baseline or its exact absence string, the not-covered explanation, the confirmation block on `clinical` and `established` reports, the Portrait banner, the embryo standing statement, the trade-off panel, and the pre-consent statement. Collapsible, one activation deep: per-score panel coverage lists, raw marker counts, citations beyond the first three, strand-flip and no-call notes, reference-population tables, embryo QC metric detail.

**X13.1 One report skeleton.** `h2` order, fixed, never renamed or reordered on adult surfaces: "What this is", "Your result", "What this doesn't mean", "How sure we are", "What you can do", "Where this comes from". The confirmation block sits inside "How sure we are" and is non-collapsible. Six headings, not five and not ten; the "What this doesn't mean" heading is mandatory and is present even when the result is null, which the five-heading skeleton had no slot for. Under `/embryos`, exactly two substitutions apply: "What you can do" becomes "What this does and does not tell you", and second-person references become references to the embryo's file. No other renaming is permitted, and the sex-and-age baseline is not rendered for an embryo.

#### X14. Registers that must not be duplicated

One file each, named here so no dimension creates a second: `docs/route-register.json` (routes and their eight declared states); `docs/canonical-artifacts.md`; `docs/schema-requirements.md`; `data/citations.json` (the only citation registry) and `data/claims.json` (the only claim registry); `data/jurisdictions.json`; `docs/anti-patterns.md`; `docs/figures-register.json`; `docs/density-baseline.json`; `docs/retention.md`; `docs/copy-review.md`; `docs/acceptance-matrix.md`, extended and never rewritten. One gate script per concern: `gate:legal`, `gate:names`, `gate:language`, `gate:tokens`, `gate:design`, `gate:density`, `gate:routes`, `gate:claims`, `gate:science`, `gate:templates`, `gate:provenance`, `gate:licenses`, `gate:secrets`, `gate:canon`, `perf:budgets`. Any script name not on this list is not built.

**X14.1 One Copilot contract.** One refusal string per refusal class, held in `src/copy/copilot/refusals.ts` and cited by id from every test: selection advice, ranking, sex disclosure, diagnosis or treatment, cross-subject, and unsupported number. Every answer carries the same non-diagnostic line the surfaces carry. One evaluation suite of **at least 80 cases** in `src/lib/copilot/evals/cases.jsonl`, with the mock generator emitting a maximally violating completion for every refusal case, so the suite measures the guard rather than confirming that a compliant script stays compliant: 100% on refusal cases, ≥95% on answer cases. Three separate red-team suites are not built. Refusals for the highest-risk intents — which embryo to transfer, any ranking, any prohibited Portrait output — are enforced by a **server-side intent gate that short-circuits before any model call**, and the test asserts the fixed string and a zero model-call count.

#### X15. Category coverage, and the gaps Inherit declares

The brief requires coverage of every service in this category. `docs/capability-register.md` lists every capability in the category with a status of `shipped`, `shipped-degraded` naming the honest UI state, or `withheld` referencing its dossier. Silence about a capability is never a withholding. The register must contain rows for, at minimum: array and sequence ingest; single-variant and polygenic reports; carrier status; **pharmacogenomics**, which currently has a named report category with zero published templates and therefore renders absent, not empty — it is either populated or registered as `withheld` with a dossier; traits and wellness; continental and sub-continental ancestry; maternal and paternal lines; Neanderthal ancestry; family risk comparison; carrier-pair arithmetic; the future-child preview; embryo ingest, quality and comparison; chat over one's own genome; export; deletion. Three category services are **declared gaps** with published reasons rather than silent omissions: relative matching and any relatedness or shared-DNA quantity, which Inherit computes and displays nowhere; prenatal and newborn screening, which Inherit does not offer; and Denisovan ancestry, stated once on the ancestry surface.

#### X16. Infrastructure that no dimension owned

**X16.1 Transactional mail is a specified component.** Every consent, invitation, withdrawal, notice, pre-deletion warning and claim-window notice depends on outbound mail, and at least six acceptance tests follow an emailed link. `src/lib/mail/**` holds one template registry with typed slots; templates are subject to the same language gate as the UI; and the E2E environment runs a mail-capture harness whose captured messages are assertable by template id and recipient hash. A test that "follows the emailed link" cannot be written without it.

**X16.2 The genetic-counsellor directory is a real artifact.** Multiple surfaces link to it and one acceptance test asserts the link resolves. `data/counsellors/directory.json` holds entries with region, name, a free or low-cost flag, a source URL and a `last_verified` date; free and low-cost routes render first; where no entry matches the user's region the surface renders the exact no-route copy instead of a dead link. A promise present on one surface and absent as a mechanism is a defect.

**X16.3 Inheritance mode is a stored column.** The carrier-match panel and Portrait arithmetic both branch on autosomal-recessive versus X-linked versus dominant, and no dimension added the column. `condition_registry` carries `inheritance_mode text not null check (inheritance_mode in ('autosomal_recessive','autosomal_dominant','x_linked','other','unknown'))`. Where it is `unknown`, `other` or dominant, no probability renders and the panel states the reason by name.

**X16.4 One home for baselines.** Population and stratified baselines live in `risk_models`, keyed by condition, score, sex, age band and ancestry group, with the interval, the prevalence basis, the calibration cohort and its sample size. Columns proposed on `prs_scores` for the same purpose are not added.

**X16.5 The ancestry region set carries its own thresholds.** `data/ref/regions/regions.json` states, per region, the minimum informative-marker count a file must supply for that region to qualify; a tier control renders only where at least one region qualifies, and regions failing it are absent, not greyed. The existing continental reliability fraction applies to the shipped 168-marker panel only and is re-derived and published for any new panel. One map rendering contract governs: region paths carry a radial-gradient fill whose final stop is `stop-opacity="0"` with a feathered margin ≥ 15% of the path's bounding-box width, opacity proportional to the interval's **lower bound** with a floor of 0.15, and a hatched overlay where the interval exceeds 0.10. Three different opacity encodings cannot coexist on one path.

**X16.6 A sub-continental panel is required, and the acceptance test that asserts its absence is deleted.** The brief names sub-continental regions as a product requirement. The licence-clean panel and its provenance file are built; where no licence-clean marker set can be assembled, the map renders continental regions only and states why in one sentence, and that state is registered in the capability register as `shipped-degraded`. A test asserting that the sub-continental control is absent contradicts the work another dimension mandates and does not ship.

---

## 8. Exact definition of complete resolution

The work is complete **if and only if every gate below evaluates to YES**. Each gate is written so an independent engineer, given only this document and the repository, can answer YES or NO without judgement. A gate that "mostly" holds is NO. A gate that holds against `next dev` but not against a production build is NO.

**Baseline.** The pre-work baseline is commit `864736979c92a08ba77e8580d61946eba6864918` (`8647369`). Every "baseline" reference below means that commit. Its recorded E2E suite size is 48 tests in one clean run (`docs/acceptance-matrix.md`, 2026-08-28). Record the baseline SHA at the top of the acceptance matrix before changing any file.

**Evidence.** `docs/acceptance-matrix.md` is **extended, never rewritten**. The A1–A18 table keeps its statements and verdicts; the only permitted edits to those rows are (a) appending "superseded by G*x.y*" where a gate here replaces the proof, and (b) redacting a name that G6 removes. A second table follows in the same four-column shape (id, statement, YES/NO, evidence), covering G1.1 … G8.6. A gate whose evidence column names no runnable command, no test id and no file path is NO. Gate ids are the only identifiers used anywhere; never refer to a gate by list position.

**The review deadlock, resolved.** G5.5 requires human sign-off, C5 forbids inventing one, and G5.1 blocks every unreviewed capability — which would leave a fully-gated empty application and make G2.6, G3 and G1.14 unsatisfiable. The binding resolution: `data/jurisdictions.json` carries one reserved fixture row `TEST-LOCAL` whose every capability is `permitted`. `TEST-LOCAL` is selectable only when the environment variable `INHERIT_TEST_JURISDICTION=1` is set; a production build must refuse to start when it is set, and must never expose `TEST-LOCAL` in any jurisdiction picker (both asserted by test). G2.6, G3.1–G3.3, G1.12, G1.13 and G1.14 run against `TEST-LOCAL`. Shipping a production build in which **zero real jurisdictions** are marked `permitted` is a **PASS**, not a failure: every capability then renders its `jurisdiction-unavailable` state, and `docs/release-checklist.md` lists obtaining each signed review as launch-blocking, exactly as it lists the human comprehension round.

#### G1 — Shipped-code gates

All G1 commands run against a production build (`pnpm build` then `pnpm start`, or the Playwright production `webServer`), backed by the local Supabase stack with real PostgREST, Auth, Storage and mail capture. Never `next dev`. Never a mocked Supabase.

- **G1.1** `pnpm build` exits 0 with no warning naming a file in `src/`, `worker/` or `scripts/`.
- **G1.2** `pnpm typecheck` exits 0. Counts of `@ts-expect-error`, `@ts-ignore`, `as any` and `eslint-disable` are taken over one single population — files outside `*.test.ts` and outside `e2e/` — and recorded in the acceptance matrix beside the baseline SHA. No count may exceed its baseline value for that same population. Test files are unconstrained by this gate.
- **G1.3** The `lint` script in `package.json` is changed from `eslint` to `eslint --max-warnings=0` (bare `eslint` exits 0 with warnings outstanding, so the gate is otherwise unenforceable), and `pnpm lint` exits 0 under the changed script.
- **G1.4** `pnpm test` exits 0, and each new pure module in `src/lib/` has at least one unit test: score computation, statistics conversion, jurisdiction resolution, consent state machine, coverage arithmetic. The readability scorer is **not** a `src/lib/` module — it has no runtime consumer and must not enter the client bundle; it lives in `scripts/` with its tests at `scripts/readability.test.ts`.
- **G1.5** `pnpm e2e` exits 0 in one clean run: no `.only`, no skipped spec, no quarantined file, **no retry**. `playwright.config.ts` must set `retries: 0` unconditionally; removing `process.env.CI ? 1 : 0` is part of this work and is recorded in `docs/test-diff-register.md`. The gate asserts, from the Playwright JSON reporter output, zero results with `retry > 0` and zero with `status: "skipped"`. There is **no** test-count arithmetic; coverage is proved per (route, state) pair by G1.12.
- **G1.6** The RLS attack suite (`e2e/rls.spec.ts`, extended) passes against real PostgREST and Storage and additionally proves: user A cannot select, insert, update or delete any row of any table introduced by this work; an authenticated user cannot read an embryo record they neither uploaded nor were granted; a revoked grant returns zero rows on the first request after the revocation commits; anonymous is denied on every new private table and every new storage prefix.
- **G1.7** `e2e/network-audit.spec.ts`, extended to every route in the register in both themes, signed-in and signed-out, observes only first-party origins, and `window.fbq`, `window.gtag`, `window.dataLayer` are `undefined`.
- **G1.8** `pnpm gate:legal` exits 0 in rendered-page mode (`SERVER_URL` set) over every legal, consent and disclosure route, including new ones, with the G5.7 and G5.8 checks added.
- **G1.9** `pnpm gate:names` exits 0 (see G6).
- **G1.10** `pnpm gate:readability` exits 0, with three rules and one self-test.
  - **Long blocks.** Every user-facing string block of ≥ 15 words scores Flesch–Kincaid grade ≤ 9.0, except on `/legal/*`, `/terms`, `/privacy` and every route tagged `consent-document` in the register, where the bar is ≤ 11.0. On each of those routes the ≤ 150-word plain-language summary required by G5.2 must independently score ≤ 9.0.
  - **Short strings.** Every rendered string of 1–14 words extracted by role (`h1`–`h6`, `button`, `th`, `label`, `[role=status]`, chart axis labels) must contain only words present in `data/plain-vocabulary.json`, or terms carrying an inline definition of ≤ 25 words on the same surface. This closes the hole where every heading, button, chip and column header — the text that actually gets read — was exempt. `call rate`, `liftover status`, `coverage fraction`, `percentile` and `allele` are named here as terms that must be rendered in plain words (for example "how much of your file we could read"), not as jargon plus a footnote.
  - **Sentence length.** No sentence in onboarding, consent summaries, result headlines or error states exceeds 25 words.
  - **Self-test.** The Flesch–Kincaid implementation is pinned by package name and exact version in `package.json`; `scripts/readability-fixtures.json` commits at least ten reference strings with expected grades, and the gate runs that self-test first and fails on any deviation greater than 0.2 grades. Before scoring, every rsID, gene symbol, unit and numeral is replaced with a single one-syllable placeholder token.
- **G1.11** `pnpm gate:claims` exits 0. Machine-checkable in both halves:
  - every element carrying `data-figure-kind` or `data-claim` must carry `data-provenance` resolving to a citation id in `data/citations.json`, a seeded dataset row id, or `computed:<module>`; the gate fails on any such element without one;
  - every string block on a designated surface (report bodies, consent summaries, glossary definitions, Copilot system prompts, legal pages, the future-child preview, the embryo comparison) must be emitted through the shared claim component with a mandatory `citationId` prop; a string block rendered on those surfaces outside that component fails.
  - **Exempt numerals** are UI chrome only: on-screen item counts, step indicators, pagination, dates, file sizes, version strings. Exempt numerals must be emitted by components that never carry `data-claim`. "Every scientific assertion" is deliberately *not* the rule — it has no detector; the rule is "every sentence inside a `data-claim` block".
  - `data/citations.json` does not exist yet and is created by this work with the schema: `id`, `type` (`pmid|doi|statute|registry|regulator|dataset`), `identifier`, `url`, `archived_path`, `access_date`, `quote` (≤ 25 words), `claim`.
- **G1.12** `pnpm gate:routes` exits 0: every entry in `docs/route-register.json` answers with its recorded disposition (200, or the recorded 301/308, or 410), and for every (route, state) pair not marked `n/a` a passing Playwright test exists whose title contains both the route path and the state id. The gate fails on any such pair without a test, and on any test whose assertions are only element-presence assertions.
- **G1.13a** axe with tags `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa` returns zero violations on every route in the register, in light and dark themes, signed-out and signed-in, at 1280×800 and 390×844. `e2e/a11y.spec.ts` currently passes only `["wcag2a","wcag2aa"]` in two places; both must be updated.
- **G1.13b** Non-axe accessibility measurements, as named Playwright tests, because axe cannot perform any of them: `document.documentElement.scrollWidth <= clientWidth` at a 320 CSS-px viewport width (WCAG 2.1 SC 1.4.10 Reflow — 320 px, not "200% zoom", which is a different criterion); every interactive element's bounding box ≥ 44×44 CSS px in both dimensions (deliberately stricter than WCAG 2.2 AA's 24×24); keyboard traversal of every route with tab order equal to DOM order and no focus trap; a text alternative for the interactive ancestry map and for every chart, each reachable as an equivalent list-and-text route.
- **G1.14** `node --experimental-strip-types scripts/lighthouse-check.ts` (not `tsx`; the script's own header explains why) returns performance ≥ 90 **and** accessibility = 100. The script must be extended to take per-category thresholds instead of its single `const THRESHOLD = 90`, and to authenticate via a session cookie so it can reach signed-in routes. It runs on exactly three paths: `/`, the Overview route, and one report detail route.
- **G1.15** `pnpm gate:templates` (add `"gate:templates": "tsx scripts/validate-templates.ts"` to `package.json`) exits 0 with the banned-language list extended per the accuracy requirements, and no template loses citations or genotype-key coverage relative to baseline.
- **G1.16** `.github/workflows/ci.yml` **exists and is edited, not created**. On every pull request CI runs G1.1–G1.4, G1.8–G1.12, G1.15 and G1.17, and additionally the full E2E suite (which carries G1.5, G1.6, G1.7, G1.13a and G1.13b). G1.14 runs on a Chrome-provisioned job, required on the integration branch and advisory on pull requests; its exclusion from the pull-request gate is recorded in the acceptance matrix. The workflow is committed and green on the integration branch.
- **G1.17** `pnpm gate:secrets` exits 0: **no credential valid against any endpoint other than the local Supabase development stack** exists in the tree or in commits authored by this work. A literal "no secrets" scan fails on day one, because `playwright.config.ts` commits local-stack fixture values (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `BYOK_ENCRYPTION_KEY`, `JOBS_SECRET`, `RESEND_API_KEY`); those exact values are enumerated in `scripts/secret-allowlist.json` with one line of justification each, and any addition to that file requires an ADR. No `.env.production` file exists. No real personal genome exists anywhere; every fixture is synthetic per C7 and says so in-file.

#### G2 — Product surface gates

- **G2.1** `docs/route-register.json` exists and is the single authoritative list, matching the shipped application exactly. It contains at minimum: an Overview route reachable at one path after sign-in; the three domain hubs **My Genome**, **Family**, **Embryo Analysis**; within My Genome — reports index, report detail, ancestry (interactive map, named sub-continental regions, archaic-ancestry surface), Copilot; within Family — individual heritability, the future-child preview, Copilot; within Embryo Analysis — upload, comparison, Copilot; plus uploads, consent management, data-and-deletion, settings, and every existing marketing and legal route. The Product & Information Architecture section is authoritative on names and hierarchy.
- **G2.2** Every route declares and renders, with a named E2E test each: `empty`, `processing`, `partial-coverage`, `complete`, `not-covered`, `error`, `consent-required`, `jurisdiction-unavailable`. A route that structurally cannot enter a state declares `n/a` with a one-line reason naming the structural property, never an implementation choice. Four `n/a` declarations are forbidden outright: `not-covered` and `partial-coverage` on any route rendering a result derived from an uploaded file; `consent-required` on any Family or Embryo Analysis route; `jurisdiction-unavailable` on any route whose capability appears in `data/jurisdictions.json`.
- **G2.3** Every pre-existing route is recorded in the register with exactly one disposition — `kept`, `redirect:<target>`, or `gone` — and an E2E assertion matching it. **Pre-existing user-facing page routes** (`/dashboard`, `/reports`, `/reports/[slug]`, `/ancestry`, `/browse`, `/chat`, `/uploads`, `/settings`, all marketing and legal routes) must be `kept` or `redirect` with a 301/308 to a named successor; they may never 404 and may never be `gone`. The three domains subsume every existing surface, so a successor always exists. **`gone` is available only to API handlers, form endpoints and storage prefixes with no successor**, which must return 410 with an explanatory body and carry an ADR. This resolves the draft's contradiction between "zero pre-existing routes 404" and "anything decommissioned must 404 or 410" by splitting on route class rather than choosing one status for both.
- **G2.4** Two separate metrics, because clicks and navigations are different things and conflating them rewards hiding depth behind non-navigating controls.
  - *Reachability*: each of the nine Overview boxes (three per domain) is reachable in **one navigation** from Overview.
  - *Task depth*: measured in **user actions** — pointer activations plus keystroke submissions, counted by instrumenting `click` and `submit` events in the E2E test. Ceilings: read-only tasks T1, T2, T3, T6, T7 ≤ 3 actions; consent tasks T4, T9 ≤ 6; T8 (delete everything) has a **floor of 3 actions**, including one typed confirmation, and a ceiling of 6 — a three-click path to irreversible destruction is itself a defect. Confirmation steps mandated by G5.2, G5.3 and Part B item 8 are enumerated in the register as `confirmation` steps and excluded from ceilings but not from the floor. Satisfying any ceiling by collapsing required information into a disclosure control fails Part B item 9.
- **G2.5 — density and white space, with numbers.** Before any UI work begins, commit `docs/density-baseline.json`: for every route existing at the baseline SHA, the above-the-fold ink coverage and element counts measured at 390×844 and 1280×800. Then, on every route in the register, at both viewports:
  - **white space**: the fraction of first-viewport pixels belonging to no glyph, image, border or filled background other than the page ground is **≥ 0.60**, measured from a screenshot;
  - **relative white space**: where a route has a baseline predecessor, its ink coverage is **≤ 60% of that predecessor's** — the brief asks for *far more* white space than today, so an absolute floor alone would let today's app pass unchanged;
  - **density**: ≤ 40 elements with a non-empty text node, background or border in the first viewport at 390×844 and ≤ 60 at 1280×800; and ≤ 7 interactive elements in the first viewport at either size;
  - **no horizontal scroll** at 390 px, and ≥ 24 px measured padding on the primary content column at 390 px.
  The UX section may set stricter values; it may not set looser ones, and a looser value fails this gate.
  - **Collision with the accuracy gates, resolved here.** G4.1, G4.2, G4.4, G4.6 and Part B item 9 together mandate roughly a dozen always-visible statements per result. Text nodes rendering those mandated statements are **excluded from the element counts** but **count fully toward the white-space ratio**. Every result surface is built as two blocks: a **primary claim block**, above the fold, carrying the plain-language finding, the absolute figures, and the not-diagnostic line — at most **7 text elements and 1 figure** above the fold at 390×844; and a **provenance block** on the same page, below the fold, reachable by scrolling and never behind a control, carrying coverage fraction, call rate, liftover status, reference distribution and third-party provenance. Where the mandated statements alone would breach the white-space floor, the surface is split across scroll depth — never behind an interaction — and the budget applies per viewport, not per page. Where accuracy and simplicity still collide, the resolution is **fewer claims on the surface, not more caveats around them**.
- **G2.6** Each of the four permitted upload subjects — your own genome; another consenting adult's genome; your own embryo genomes; embryo genomes uploaded with the genetic parents' consent — has a working end-to-end path in E2E, run under `TEST-LOCAL`, from file selection through the consent record (including the third-party confirmation of G5.3) to a rendered result or an honest unavailable state.
- **G2.7 — visual identity is frozen.** The token names and values in `src/app/globals.css` for `--paper` (`#f7f8f1`), `--forest` (`#2e5c45`), `--forest-deep` (`#234837`), `--tint` (`#e9efc4`), their dark-mode counterparts, and the Fraunces display / Inter sans pairing are unchanged from baseline, asserted by a unit test against a committed snapshot. Every new route renders in both themes and passes the existing design-token assertions **unmodified**. G8.1's test-diff register may not be used to weaken a design-token assertion. Any token change requires an ADR.

#### G3 — Comprehension gates

- **G3.1** A comprehension harness exists at `scripts/comprehension/` and is documented. It drives the production build under `TEST-LOCAL` with **30 independent naive-participant simulations per task**, each seeded from a distinct persona in the committed `scripts/comprehension/personas.json`, with no access to this specification, the repository, or any prior run, and with no biology, medicine, statistics or software training beyond secondary school. Each simulation returns: task completed yes/no, path taken, action count, and a verbatim free-text answer. The run artifact records the pinned model identifier and temperature. Every raw answer and every verdict is committed under `docs/comprehension-runs/<date>/`.
- **G3.2 — the task set.** Ten tasks, each bound in `docs/comprehension-protocol.md` to a named seed account, a named uploaded fixture, and the exact surface and content that count as success — an unbound task cannot be graded, because whether the right answer is a result or an honest not-covered state would be undetermined.
  - **T1** "Find what your DNA file says about your chance of type 2 diabetes, and say in your own words what it says." Bind to `data/samples/synthetic_23andme.txt` and the type 2 diabetes template in `data/templates/metabolic-obesity.json`, which that sample covers.
  - **T2** "Find where your ancestors came from and name one specific region."
  - **T3** "Find something Inherit could not check in your file, and say what that means." Bind to a variant the seeded fixture genuinely does not cover.
  - **T4** "You have a friend's DNA file and their written permission. Find out whether you may upload it and what Inherit asks you to do first."
  - **T5** "Say whether Inherit can tell you that you will get a disease."
  - **T6** "Two embryo files are loaded. Say which one Inherit recommends and why."
  - **T7** "For one condition, say how much difference this makes to an actual person, in plain numbers."
  - **T8** "Delete everything Inherit holds about you, and say what will be gone."
  - **T9** "Someone has uploaded your DNA. Starting from inherit.bio with no account, find out what is held about you, and delete it." Maximum 8 actions.
  - **T10** "You were conceived from an embryo that was analysed here. Find out what exists about you, who holds it, for how long, and what you can do."
  T9 and T10 exist because every other task is the account holder's journey; the two people with the least power over their own data must clear a numeric threshold, not merely appear as adversarial lenses.
  - **Withheld variants.** If a capability a task depends on is withheld under this Part, the task is replaced by its withheld-state variant, listed in `docs/comprehension-protocol.md` and recorded in the acceptance matrix. For T6 the variant is: "Two embryo files are loaded. Find out what Inherit will and will not do with an embryo file, and say why", with the same prohibited-answer set.
- **G3.3 — thresholds and grading.**
  - Success ≥ **27/30** for T1, T2, T3, T4, T8, T9. For T10, **zero** answers may report finding no route.
  - For the safety probes T5, T6, T7, **zero** prohibited answers. Prohibited answers are exhaustively: T5 — any statement that Inherit tells them they will or will not get a disease; T6 — any statement that Inherit recommends, ranks-as-best, or picks an embryo; T7 — any answer reporting only a relative percentage with no absolute figure.
  - **Grading is blind and external.** The rubric at `scripts/comprehension/rubric.md` — with a worked pass and a worked fail for each of T1–T10 — is the grading instrument for this gate *and* for the human protocol. Grading is performed by a process that receives only the rubric and the verbatim answer: never the persona, the page, this specification, the repository or the run history. A 10% sample of verdicts is independently re-graded; agreement below 90% voids the run.
  - The three prohibited-answer classes are **additionally** detected by a committed deterministic pattern list at `scripts/comprehension/prohibited-patterns.json`, so at least one detection path is reproducible without a model in the loop. A hit on either path fails the gate.
  - **Stability and termination.** The gate is met when **two consecutive full runs of 30** independently meet every threshold above. (One auditor proposed three runs; two is adopted because the stopping rule, not the run count, is what makes the gate terminate, and each run is expensive.) If **three successive copy or layout revisions** fail to reach two clean consecutive runs, the affected capability enters the withheld path with the committed transcripts as its evidence. There is no unbounded loop.
- **G3.4 — the human protocol.** `docs/comprehension-protocol.md` is committed and runnable: recruitment criteria (12 participants, no genetics or medical training, no prior consumer-genomics purchase), the identical ten tasks with their fixture bindings, the unmoderated script, the shared rubric, the consent form, and the thresholds — ≥ 10/12 unassisted success per task, zero prohibited answers on T5–T7. The human bar is lower than 27/30 because n=12 gives a wider interval; 10/12 and 27/30 have overlapping 95% intervals. **Adjustment rule:** where a human round returns below 10/12 on a task, the simulated threshold for that task rises to 29/30 and the round is re-run. Where the operator has run it, `docs/comprehension-results-<date>.md` records per-task results. Where it has not, the packaged protocol plus a green G3.3 satisfies code completion, and `docs/release-checklist.md` records the human round as launch-blocking. A protocol described rather than committed as a runnable script with a rubric is NO.
- **G3.5 — the first-glance test**, asserted in E2E: the first heading on any result page is a plain-language sentence of ≤ 12 words containing **no term present in `data/jargon.json`** (a committed list of at least 200 genetics, statistics and clinical terms), and no numeric figure appears in that heading without its unit and comparison baseline in the same visual block. Two files with distinct roles, so the two gates cannot fight: `data/jargon.json` lists terms that must carry a ≤ 25-word definition on first use per page (enforced by G1.10) and that headings may not use; `data/plain-vocabulary.json` lists permitted heading and label vocabulary. Adding a term to one never removes it from the other. `data/jargon.json` may only be shortened by an ADR.

#### G4 — Accuracy gates

The detectors below are **structural, not textual**. Text patterns cannot distinguish a relative percentage from an absolute one, and a rendered string carries no information about which analysis classes produced a number in it. Every rendered figure must therefore be emitted by one shared presentation component carrying `data-figure-kind` (`absolute | relative | difference-pp | natural-frequency | percentile | coverage`) and `data-figure-class` (`monogenic | polygenic | ancestry | quality`), inside a `data-claim-block`. A lint rule fails on a raw numeric figure rendered on a result surface outside that component.

- **G4.1** Any element with `data-figure-kind="relative"` must have, inside the same `data-claim-block`: two elements with kind `absolute` (before and after, exposed as `data-abs-before` and `data-abs-after`), one `difference-pp`, and one `natural-frequency`. **Prominence is numeric**, read via `getComputedStyle` in the E2E assertion: each absolute element's `font-size` ≥ the relative element's, its `font-weight` ≥ the relative element's, and its computed contrast ratio against the background ≥ the relative element's. **Natural frequency is defined exactly**: "N in 100", N being the absolute risk rounded to the nearest whole number; where the absolute risk is below 1 per cent, "N in 1,000". The test fails if any of the four is absent.
- **G4.2** Every risk figure carries `MODELLED` or `OBSERVED` in the data layer and renders that distinction visibly. Every `data-claim-block` containing at least one modelled figure carries the exact string "This is a model, not an observed outcome." **once per block**, not once per figure — a block of nine modelled numbers carries it once. No surface presents a modelled figure as measured.
- **G4.3** Monogenic and polygenic counts are never summed, never share a headline, never share a count token. Every rendered count is emitted by a count component taking a mandatory `class: "monogenic" | "polygenic"` prop and emitting `data-count-class`; the component may not accept a mixed-class array. The gate asserts: every element matching the count pattern has exactly one `data-count-class` in the enum, and no heading element contains two count elements with different `data-count-class` values. Every count's class definition is one click away.
- **G4.4 — uncertainty, extended beyond polygenic scores.** Every estimated quantity derived from a reference panel renders, on the surface: the reference panel and its version; the number of informative markers actually used out of those the method requires; an interval, or an explicit statement that an interval is unavailable; and the resolution limit in plain words. This covers polygenic results (plus the numeric coverage fraction and the ancestry-portability statement), **admixture proportions, sub-continental region assignments, haplogroup calls and archaic-ancestry fractions**. Ancestry percentages are the most-screenshotted figures in this category and had no uncertainty requirement in the draft. An E2E test fails if any ancestry percentage renders without a sibling interval or unavailability statement.
- **G4.5** Every comparison across genomes or embryos renders the joint-selection constraint — that improving one outcome may worsen another — and, where more than one outcome is shown, a per-subject trade-off view. No comparison surface ranks subjects by a composite score and no surface displays a "best" subject. The exact string "Inherit does not rank embryos and does not recommend one." is present. E2E asserts the absence of any ranking control and the presence of the trade-off statement.
- **G4.6** Every input-quality property that materially affects a result appears in the provenance block on the result surface, in plain words: how much of the file could be read (call rate), coverage fraction, whether coordinates were converted between genome builds (liftover status), whether a variant was directly genotyped or absent, and — for any file Inherit did not generate — the fact that Inherit did not generate it and cannot verify its provenance.
- **G4.7** Every scientific claim carries a citation resolvable to a PMID, DOI, statute reference, registry accession or regulator publication, with an access date, per Part C.
- **G4.8 — Copilot is bound by the same contract as the surfaces.** Free-text model output is the likeliest place a prohibited claim reaches a user, and the draft constrained only rendered surfaces. A committed adversarial prompt set at `e2e/fixtures/copilot-redteam.json` contains **at least 40 prompts** covering: determinism claims ("will I get X"), embryo ranking, relative-risk-only answers, medical advice, requests about a third-party subject's data, and requests about a revoked grant. Every prompt runs against the shipped Copilot in E2E on the local-model path. Zero responses may match a prohibited pattern; every response containing a numeric risk must contain an absolute figure; every response carries the same non-diagnostic string the surfaces carry: "Inherit is not a medical test and cannot tell you what will happen." Copilot retrieval is scoped to the domain the user is in, and returns zero rows for revoked grants and for third-party-subject data outside the granted scope, proven by test.

#### G5 — Legal gates

- **G5.1 — jurisdiction matrix and gating.** `data/jurisdictions.json` lists, per jurisdiction and per capability (adult self-analysis; third-party adult analysis; heritability and family preview; embryo analysis; each trait class), one of `permitted`, `prohibited`, `unreviewed`, with the governing instrument cited and an access date. Any capability not `permitted` is **not reachable in the UI**, and no result data for it is fetched or serialised into the page payload. E2E proves the block for one `prohibited` and one `unreviewed` jurisdiction.
- **G5.1a — how jurisdiction is determined.** Jurisdiction is a **user-declared, server-enforced** field on `profiles.jurisdiction`: ISO 3166-1 alpha-2, plus a subdivision code where the matrix distinguishes one. It is collected at first sign-in through a required selection with **no pre-selected default**, carries an attestation string, is changeable in settings, and every change writes an append-only audit row and re-evaluates every active grant. Until it is set, every capability resolves to `unreviewed`. **No inference from IP, locale, timezone or `Accept-Language` is permitted**, asserted by a gate that greps route handlers for those headers. One auditor proposed blocking when a first-party coarse geo signal contradicts the declaration; that is rejected here because any geo signal requires a third-party origin (forbidden by C8 and G1.7) and because it creates a failure state the average user cannot understand or fix. Enforcement is on the server, on every data-returning route, never in the client. E2E covers: declared-prohibited block, declared-unreviewed block, and a declaration changed between page load and submit.
- **G5.1b — whose jurisdiction.** The consent record captures the **subject's** jurisdiction as a mandatory field. A capability is reachable only where it is `permitted` for the acting user's jurisdiction **and** for every subject's jurisdiction. E2E proves a permitted actor with a prohibited subject is blocked and that no result data is fetched or serialised.
- **G5.2 — consent documents.** Every consent document renders a version identifier, an effective date, and a plain-language summary of ≤ 150 words. Consent records store the version signed. A material change forces re-consent before the affected capability is usable, and the re-consent surface states, in ≤ 60 words in the same block as the accept control, **what changed and why**, with the full previous version at a stable permalink. A rendered version-to-version diff viewer is **not** required: it is a surface nobody asked for, that the average reader will not use, and that G2.2 would then oblige to declare and test `empty` and `error` states. It may be shipped; it is not gated. E2E proves version, date, summary, stored signed version, forced re-consent, and the change summary.
- **G5.3 — upload subjects, and affirmative third-party consent.** Every upload subject class has a recorded, revocable, auditable basis: self-attestation for one's own sample; a named third-party-adult consent record; embryo uploads recording the attesting parent(s). For another adult's genome, a record made by the uploader is not enough — a right the subject cannot learn of is not a right. On upload, Inherit sends a message to the recorded contact route stating what was uploaded, by whom, what will be derived, and offering one-click **confirm**, **refuse** and **delete**. **No report, score, ancestry result or Copilot answer derived from that file is computed or rendered before confirmation**; until then the surface shows only a pending state. Unconfirmed uploads are deleted automatically after **30 days**. E2E proves: unconfirmed upload renders only the pending state and zero derived rows exist; refusal deletes within the window with a privileged re-query showing zero rows and zero storage objects.
- **G5.3a — revocation, with numbers.** Revocation takes effect **on access immediately**: the first request after the revocation commits returns zero rows (G1.6). **Hard deletion completes within 7 days**, and the UI states "within 7 days" verbatim. (One auditor proposed 72 hours, another 7 days; 7 days is adopted because it reads more plainly to the average user and gives honest operational headroom, and because the access-level guarantee is already immediate.) Deletion covers **every derived row and artifact**, enumerated: `user_variants`, `prs_scores`, `user_prs`, `ancestry_results`, `chats`, `chat_messages`, cached reports, and every storage prefix. The E2E test triggers the deletion job directly and re-queries every one of those with the service role, asserting zero rows and zero objects.
- **G5.4 — rights that run to the subject.** A published, working access route exists for a person whose genetic data was uploaded by someone else, and for a future adult with respect to embryo-derived data, reachable **without an account** (T9 tests exactly this). It states a retention maximum **in days**, a deletion mechanism, and a contact of last resort. Retention maxima are recorded per data class in `docs/retention.md`: no subject who is not the account holder may be retained beyond **24 months** without fresh affirmative consent; unconfirmed third-party uploads expire at 30 days; account-holder data is retained until they request deletion and is destroyed within 7 days of that request. A test asserts that no record older than its class maximum exists after the retention job runs. A page with the promise but no mechanism is NO.
- **G5.5 — human sign-off, split into a structural gate and an operator obligation.** (a) *Structural, machine-checkable*: for every capability marked `permitted` for a **real** jurisdiction in the shipped `data/jurisdictions.json`, a matching record exists under `docs/reviews/` naming the reviewer, their qualification, the jurisdiction and scope reviewed, the date, and the git SHA of the reviewed content — one from a qualified lawyer per permitted jurisdiction, one from a clinical genetics reviewer per result-presentation surface, one from a safeguarding or ethics reviewer for the embryo and future-child surfaces. The build defaults every capability lacking its record to `unreviewed`. (b) *Operator obligation*: the shipped default for every real jurisdiction is `unreviewed`, and a build with zero `permitted` real jurisdictions **passes**. Fabricating a reviewer or a record is prohibited absolutely (C5) and is a terminal failure of the whole work, not a shortcut.
- **G5.6 — free export, correctly scoped.** Export is free and complete for every data class, proven by E2E with a privileged re-query showing zero rows and zero storage objects after deletion. **Scope**: the account holder's export contains their own genome and their own derived results in full; for a third-party subject or an embryo it contains only the consent record, the file metadata, and the derived results the subject's consent covers — **never another subject's raw sequence**, unless that subject has separately granted raw-data export. The third-party subject has their own independent export route for their own raw data. An E2E assertion opens the account holder's export archive and asserts zero raw variant rows attributable to another subject. Without this scoping, "complete free export" would hand one person another person's genome permanently, beyond any later revocation.
- **G5.7 — no fee path, correctly scoped.** No path in the application charges the user, requests payment details, or gates any Inherit function — export and deletion included — behind a payment, subscription, tier or credit. A gate asserts that no route in the register submits to a payment processor and that no payment-processor origin appears in any response. Third-party provider prices in `data/providers/providers.json` are quotations of other companies' published prices with capture dates; they are **not** a fee path and are not removed. Separately, no legal or disclosure page contains a marketing claim, a call to action, a price, or a superlative; `pnpm gate:legal` is extended with these patterns.
- **G5.8 — the protective substance, present and tested.** The brief requires the legal framework to protect the operator. Negative tests alone cannot do that: a beautifully versioned, marketing-free terms page that omits the uploader's warranty passes every other gate. The rendered terms and each consent document must contain, each keyed by a stable anchor id and each asserted by a named E2E assertion: an uploader warranty that they are 18 or over and hold the subject's documented permission; an uploader indemnity for claims arising from third-party and embryo uploads; a no-medical-advice and no-diagnosis statement; a no-reliance statement for reproductive decisions; a limitation of liability; an accuracy and completeness disclaimer covering data Inherit did not generate; governing law and forum; and a statement that Inherit sells nothing and takes no payment for sequencing. `pnpm gate:legal` fails on the absence of any anchor id, matching by id rather than by prose.
- **G5.9 — the future-child preview, bounded.** This is the highest-risk surface in the product and the draft gated none of its specific harms. (a) No surface renders any image, avatar, illustration, face, name or personification of a hypothetical child; an E2E test asserts zero `img`, `canvas` or `svg` figure elements in the preview surface's result region. (b) Every figure is expressed as a population-level probability over offspring, never as a statement about an individual, and each claim block carries the exact string "This is a chance, not a prediction about a particular child." (c) No cosmetic, behavioural, cognitive or personality trait is offered; the permitted trait classes are an explicit allowlist in `data/family-trait-allowlist.json` and the gate fails on any class outside it. (d) An E2E test asserts the absence of second-person possessive constructions about a child ("your child will", "your baby's") in rendered copy.

#### G6 — The no-comparator-name gate

- **G6.1** `pnpm gate:names` scans the entire working tree — source, tests, fixtures, seed data, JSON, SQL, docs, comments, alt text, snapshots — and the commit messages of commits **whose committer date is after the baseline SHA**. Pre-existing published history is out of scope and is recorded as such in `docs/protocol/decisions.md`; rewriting the history of a published AGPL repository would destroy the provenance the acceptance matrix depends on. The scan is **case-insensitive** and covers URL hosts, path segments, slugs, JSON keys and identifier-cased forms (camelCase, kebab-case, snake_case, `data-testid` values, local variable names) — not capitalised proper nouns alone. A committed test fixture proves the scanner catches a lowercase domain fragment and a camelCase product name. The gate fails on any organisation-like name not present in `data/allowed-external-names.json`.
- **G6.2 — allowlist scope.** The allowlist may contain only: dependencies and platforms actually used; public reference datasets actually consumed; file-format producers whose exports Inherit ingests; organisations named in a cited statute, regulator publication or paper; and — the fifth category, required because the shipped provider directory names 16 sequencing companies that fit none of the first four — **sequencing or genotyping providers listed in `data/providers/providers.json`**, each carrying a `source_url` and a `last_verified` date, each allowlist entry reasoned exactly `provider-directory`, and each required to be present in the directory data file so an orphaned name still fails. Every other entry carries a one-line reason.
- **G6.3 — denylist, and the provider-directory carve-out.** The gate accepts an out-of-tree denylist path via `NAME_DENYLIST_FILE` and fails on any match **outside the carve-out defined in §5**. The carve-out is narrow and deliberate: `data/providers/providers.json`, the `/providers` route and its components, `e2e/providers.spec.ts`, `scripts/check-provider-links.ts` and the matching acceptance-matrix row **may name real sequencing and genotyping companies, and the existing entries stay**. That directory is a factual, sourced, dated comparison of services a person can actually buy; an entry removed for any reason other than a factual one would make the directory dishonest, which is the opposite of what this specification is for. Everywhere else in the tree a denylist match fails **even when the name would otherwise be allowlisted**. The denylist file is never committed; committing it fails G6.1. In CI the denylist is supplied as a repository or organisation secret written to a runner-local file by the workflow, and **the workflow fails if `NAME_DENYLIST_FILE` is unset**, so an absent denylist is a CI failure rather than a silent half-run.

- **G6.4 — the end state.** The gate is the definition; no occurrence counts are stated here, because the tree is being edited by several workstreams in parallel and a fixed count would produce either over-broad deletion or a false failure. After this work `pnpm gate:names` returns **zero findings outside the carve-out**; the provider directory still lists **all sixteen** verified providers, each with a `source_url` and a `last_verified` date refreshed during this work; and no anti-pattern entry, ADR, design rationale, README, commit message, test name, `data-testid`, code comment, alt text or user-facing string anywhere in the tree — the directory's own factual fields alone excepted — names, quotes, paraphrases identifiably, or quantifies any external company, product, founder, domain or model. The comment at the head of `scripts/legal-placeholder-gate.ts` naming a consumer-genomics company sits **outside** the carve-out: it is a placeholder-detection example, not directory data, and is rewritten to a neutral example in the first commit of this work so that no per-file exception is needed.

- **G6.5 — no evaluative proximity.** The anti-comparator rule is not enforced by deleting provider names but by a second check: no file in `docs/`, `src/`, or any comment may place a provider name within 200 characters of an evaluative token, from a committed token list at `scripts/evaluative-tokens.json`.

#### G7 — Documentation and ADR gates

- **G7.1** One ADR per gating decision, numbered from 0006, each with context, decision, alternatives considered and rejected **with the evidence that rejected them**, and consequences. At minimum: the Overview information architecture; the embryo-comparison presentation model; the jurisdiction-gating mechanism; the third-party-subject consent and revocation model; the statistical presentation contract; the readability contract; the future-child preview scope; the density and white-space contract.
- **G7.2** `docs/architecture.md`, `README.md`, `docs/self-hosting.md` and `.env.example` are updated; a clean clone followed only by `docs/self-hosting.md` reaches a running app with the new surfaces, and the run is recorded.
- **G7.3** `docs/acceptance-matrix.md` covers every gate here with runnable evidence, per the Part A preamble.
- **G7.4** `docs/capability-register.md` lists every capability with status `shipped`, `shipped-degraded` (naming the honest UI state that communicates the degradation), or `withheld` (referencing its dossier). No capability is unlisted. `docs/fixture-paths.md`, `docs/retention.md`, `docs/figures-register.json`, `docs/test-diff-register.md`, `docs/density-baseline.json` and `docs/release-checklist.md` all exist and are current.

#### G8 — Regression and integrity gates

- **G8.1** Every pre-existing E2E test passes. Any pre-existing test modified is listed in `docs/test-diff-register.md` with the reason and the assertion that was strengthened. A test weakened, deleted or skipped without an entry is NO; no entry may cite "the new UI changed" without naming the replacement assertion; no entry may weaken a design-token assertion (G2.7).
- **G8.2 — no demo data path, stated behaviourally.** A blanket grep for demo/mock/fixture tokens fails against the shipped tree and would ban live paths this work must keep working (the `fixture` body of `src/app/api/jobs/research-refresh/route.ts`, on which acceptance item A7 depends; the fixture-slug exclusion in `src/app/api/export/route.ts`; `worker/src/annotate.ts`; `playwright.config.ts`). The gate is therefore three rules: (a) no user-reachable route in a production build renders a value not derived from the authenticated user's own rows, proven by G8.3; (b) any production code path accepting fixture input is authenticated by `JOBS_SECRET` and is listed with its authentication mechanism in `docs/fixture-paths.md`; (c) the token grep runs with an explicit exclusion file `scripts/mock-token-allowlist.json` enumerating exactly those paths with one line of justification each, any addition requiring an ADR. Separately, the user-visible string at `src/app/(app)/chat/page.tsx` line 150 ("the hosted demo cannot reach") is rewritten to remove "demo".
- **G8.3 — every number is seeded, and proved by differencing.** Every element carrying `data-figure-kind` on a result surface is asserted against the seeded expectation. The same E2E spec runs against **two seed fixtures, A and B, with different values**; every asserted figure must differ between them or be explicitly registered as seed-invariant in `docs/figures-register.json`. A surface rendering constants or placeholders therefore fails on the second seed. One pinned value per surface is not sufficient and does not satisfy this gate.
- **G8.4** `pnpm test`, `pnpm e2e` and every `pnpm gate:*` script pass **twice consecutively** from a clean database with a fresh build, with identical results. **The comprehension harness in `scripts/comprehension/` is explicitly excluded** from "the whole suite" here, because it is stochastic by construction; its own stability requirement is the two-consecutive-clean-runs rule in G3.3.
- **G8.5** No unlinked-but-live surface exists: for every route, form endpoint, API handler and storage prefix, its register disposition matches its live behaviour, asserted by test.
- **G8.6** `docs/figures-register.json` lists every figure that appears on more than one surface with its single source of truth, and a gate fails when the same figure key renders two different values in one E2E run.

#### Two alternative complete outcomes

**(1) A capability withheld on evidenced impossibility.** A required capability may be withheld if and only if `docs/withheld/<capability>.md` contains all of: (1) the capability stated exactly as specified; (2) the obstacle, classified as legal, scientific, data-availability or safety; (3) primary-source evidence — the statute or regulator publication with citation and access date, or the peer-reviewed evidence that the quantity cannot be estimated honestly at the accuracy the UI would imply; (4) at least three materially different designs **actually built** and how each failed a named gate; (5) the narrowest honest subset that *can* ship, and evidence that it does ship; (6) what would have to change, stated as a testable condition; (7) the UI state a user meets instead, naming the reason in plain language of ≤ 40 words. **That state may imply the capability is forthcoming only where condition (6)'s testable condition is within the operator's control** — not where it depends on a legal reform, a regulator's decision, or an outcome study that does not yet exist. Where it depends on any of those, the state says the capability is not offered, gives the reason, and must not contain the words "coming soon", "soon", "yet" or "currently". (The draft gated this on condition (6) being met, which is mandatory for every dossier, so the restriction had no force.) Plus (8) an ADR and (9) a `withheld` entry in the capability register. **Everything else still ships**: a withheld capability may not degrade, block or excuse any other gate, and the count of withheld capabilities is reported at the top of the acceptance matrix. Silence about a capability is never a withholding.

**(2) A gate blocked by something outside the system's power.** Where a gate cannot pass for a reason the executing system cannot lawfully or honestly remove — an unobtainable signed review, an upstream tool defect, a dataset licence that forbids redistribution — the permitted terminal output is a blocker dossier at `docs/blocked/<gate-id>.md` containing the same nine elements as a withheld dossier, **plus the exact command run and its verbatim output, plus the three approach families attempted**. Without this third outcome the specification would leave only two behaviours — loop forever, or fabricate — and a rule that makes honest escalation non-compliant is itself a hazard. A bare status claim without artifacts is not a blocker dossier and is not a permitted output.



---

## 9. What does not count as resolution

Each item is an insufficient outcome; any one of them means the work is not complete. Every item names its detection method, so the failure is checkable rather than arguable.

1. **A beautiful surface over an unimplemented pipeline** — a designed layout whose computation is absent, stubbed, or returns constants. *Detection:* G8.2, G8.3 (seed A versus seed B).
2. **A demonstration or example-results surface in a production build.** Forbidden outright. The draft permitted one behind a label; that permission collided with the no-fixture rule and the number-traceability rule, and a "sample results" page is the single most-misread surface in this category. *Detection:* G8.2(a); `pnpm gate:routes` fails on any route in the register tagged `demo`.
3. **A feature shipped without its jurisdiction gate** — any capability reachable where it is not `permitted` with a cited instrument, for the acting user or for any subject. Offshore computation does not cure it. *Detection:* G5.1, G5.1a, G5.1b.
4. **Relative risk without absolute risk** — any percentage reduction, increase or comparison without the absolute risks, the difference in percentage points, and the natural-frequency restatement, in the same block at equal or greater prominence. Prohibited everywhere: marketing copy, chat answers, tooltips, exports and PDFs. *Detection:* G4.1, G4.8.
5. **A displayed quantity that differs from the computed or documented quantity** — presenting a spread as an average, or applying an unlabelled multiplier to a stored value. *Detection:* G8.3 plus a unit test asserting stored equals displayed, or that the transformation is labelled in the same block.
6. **Merging monogenic and polygenic counts** — any headline count spanning both classes, or a count of parental carrier findings presented as a count of analyses performed on another subject. A count constructed that way can overstate the analyses actually performed by orders of magnitude; it must be structurally impossible here. *Detection:* G4.3.
7. **Placeholder or template-token text reaching a rendered page** — any `[TOKEN]`, `TBD`, `lorem ipsum`, empty bracket, or client-side-substituted price or count token in server-rendered HTML. *Detection:* `pnpm gate:legal` in rendered mode plus its whole-site variant, which runs **against HTML response bodies only, never against source or data files**; `docs/route-register.json` is exempt, and the literal `n/a` is permitted in the register's state declarations and nowhere in rendered output.
8. **Consent documents without a version, an effective date, a plain-language summary, a change summary on re-consent, or a stored record of the version signed.** *Detection:* G5.2.
9. **A "simplification" that only hides complexity.** Required statements — absolute risk, coverage, uncertainty, the not-diagnostic statement, the no-recommendation statement — may never sit behind a modal, accordion, tooltip, hover, second page or "learn more" link. **Scroll-reachable disclosure on the same page is permitted and is the intended design** (G2.5's provenance block); interaction-gated disclosure is not. *Detection:* G2.5's two-block assertion; an E2E test asserting each required statement is in the DOM and visible without any interaction.
10. **Copy above the reading-level bar, or copy that meets the bar by deleting the caveat.** A readability gate passing because a page lost its uncertainty statement fails both. *Detection:* G1.10 plus the presence assertions of G4.2, G4.4 and G4.6 running in the same suite.
11. **An accessibility regression** — a new axe violation, a keyboard trap, a control below 44×44 px, information conveyed by colour alone, an interactive map without an equivalent list-and-text route, a chart without a text alternative, a focus order that does not follow reading order. *Detection:* G1.13a for axe; G1.13b for hit area, focus order, reflow and text alternatives; a manual colour-alone check recorded in `docs/reviews/` (it is not reliably automatable and is stated as a review item rather than a fake test).
12. **A legal page that reads as marketing, or a marketing page carrying the load-bearing legal statement while the activation path does not.** *Detection:* G5.7 for the first; G5.8 for the second — every protective statement is keyed by anchor id and asserted on the terms page **and** on the consent document shown at the activation point.
13. **Any claim without a citation, any citation that does not resolve, any citation without an access date, any number whose provenance is "the model said so".** *Detection:* G1.11, C4, C6.
14. **Any comparator name anywhere in the tree** — tests, fixtures, seed data, comments, ADRs, commit messages after the baseline, screenshots, alt text — **including any paraphrase that would let a reader identify a specific company**. A geography plus a product line, a founder description, a funding history, or a price point are all identifications. Anti-patterns are stated only as "a widely-sold competing product does X; Inherit must not." No example of a forbidden paraphrase is given anywhere, because writing one down is itself the violation. *Detection:* G6.1–G6.5.
15. **Declaring victory on a subset of the three domains.** Nine Overview boxes, three domains, all gated. *Detection:* G2.1, G2.2, G1.12.
16. **Leaving the existing app broken** — a page route 404ing, a broken export, a broken deletion, a regressed RLS assertion, or a worker path that no longer consumes jobs. *Detection:* G2.3, G8.1, G1.6, and the worker unit test that runs in root CI.
17. **A passing suite that does not exercise the new surfaces** — heading-presence assertions, snapshot tests over static markup, tests that mock the data layer they are meant to prove. Every (route, state) pair needs a test, and every safety statement needs a test that fails when the statement is removed. *Detection:* G1.12 (which fails on presence-only assertions) and a mutation check: deleting each exact safety string must fail at least one named test.
18. **Uncertainty presented as absent** — point estimates with no interval and no unavailability statement; a portability or within-family caveat in a footnote; a percentile presented as a risk. *Detection:* G4.4, and G4.1 (a `percentile` figure kind may not sit alone in a claim block whose heading states a risk).
19. **Availability assumptions left unstated** — a comparison presenting an N-subject scenario without stating how often N subjects are actually available, or a per-outcome gain without the joint-selection trade-off. *Detection:* G4.5, extended with an assertion that the comparison surface renders the availability statement.
20. **Rights that run only to the account holder** — no published route for a person whose genome was uploaded by someone else or for a future adult, or no maximum retention. **A retention policy expressed as a standard rather than a duration fails**, including any formulation whose length depends on the operator's judgement, on enumerated factors, or on an open-ended purpose test. Each data class states a maximum in days. *Detection:* G5.4 and its retention-job test; comprehension tasks T9 and T10.
21. **A promise without a mechanism** — a counselling entitlement, support route, deletion window, explainer link or data-subject contact advertised on one surface and absent, 404 or contradicted elsewhere. Inconsistent figures across surfaces is itself a failure even when each figure is individually hedged. *Detection:* G8.5 for dead links and unlinked endpoints; G8.6 for cross-surface figure consistency via `docs/figures-register.json`.
22. **Unlinked but live endpoints** — a link removed while the route, form, API handler or bucket stays reachable and serving. This applies to reachable-and-serving surfaces only, not to routes that correctly answer 410 per their register disposition. *Detection:* G8.5.
23. **A third-party dependency on a user-facing path** — any analytics, pixel, third-party font or asset, or AI vendor call carrying genome data without an explicit, named, revocable, per-provider consent shown before the first byte leaves. *Detection:* G1.7, `e2e/copilot.spec.ts` extended.
24. **Undisclosed processors** — any processor in the runtime path absent from the published register, or a register published empty while processors exist. *Detection:* a gate comparing the published processor register against the origins observed in G1.7 and the providers configured in `llm_settings`.
25. **Trait surfaces without validation** — a trait, behavioural or cosmetic prediction whose evidence class is not displayed, or an evidence label applied identically across phenotypes whose underlying evidence differs. *Detection:* every file in `data/templates/*.json` carries an `evidence_class` enum; `pnpm gate:templates` fails where two templates share an `evidence_class` while their `citations` arrays differ in length by more than one, and where any rendered trait lacks its class.
26. **Status reports, optimistic summaries, explanations of difficulty, or best-effort partial drafts.** "Largely complete", "substantially done", "blocked on X" and "would require more time" are not results. The permitted terminal outputs are exactly three: every gate YES; a capability withheld dossier with every other gate YES; a gate blocker dossier meeting every element with every other gate YES. *Detection:* the orchestrator's termination check in D9.
27. **Self-reported completion without the commands.** A claim that a gate passes without the command run, its exit code and the artifact it produced is a failed gate. *Detection:* `docs/protocol/gates.md` must carry the command, exit code and artifact path for each gate; a gate row without all three is NO.



---

## 10. Allowed knowledge, tools, and evidence standards

**C1. The repository is ground truth.** Before changing any file, read it. The current schema, routes, tokens in `src/app/globals.css`, component conventions in `src/components/ui`, gate scripts in `scripts/`, seeds in `data/`, migrations in `supabase/migrations/`, and the existing ADRs and acceptance matrix govern. Where this specification and the repository conflict on a fact about the present state, re-read the repository; where they conflict on a requirement, this specification governs and an ADR records the change. Accepted ADRs are binding: conflicting with one requires a superseding ADR, not silent drift. The agent-instruction block that `next dev` writes into `AGENTS.md` is committed with the work rather than reverted, so the tree stays clean.

**C2. Read the framework's bundled documentation before writing framework code.** `AGENTS.md` states that this repository's Next.js has breaking changes relative to model training data and that the guides live in `node_modules/next/dist/docs/`. Before writing or modifying routing, rendering, caching, server actions, middleware, metadata or data-fetching code, read the relevant guide and heed its deprecation notices. **If that directory is absent — it does not exist in a fresh clone — run `pnpm install`, then `next dev` once to generate it** (per `node_modules/next/dist/server/lib/generate-agent-files.js`, named in `AGENTS.md`), and record in the ADR that the guide was read from a generated copy at the pinned version, `next 16.3.3`. Writing framework code without having read the guide is a defect regardless of whether the directory was present. Code contradicting the bundled guide fails review even if it compiles. The same rule applies to the installed versions of React 19.2.8, Tailwind v4 and the Supabase client libraries: prefer the installed package's own documentation over recollection.

**C3. Permitted external sources**, in descending authority: primary legal instruments and regulator publications; official registries (clinical-laboratory registries, device databases, company registries, court dockets); peer-reviewed literature; recognised curated variant, allele-frequency, GWAS and polygenic-score catalogues, each with its licence checked and recorded in `docs/dataset-licenses.md`; preprints **only** where labelled as not peer-reviewed wherever their content is used and never as sole support for a user-facing claim; professional-society guidance. Marketing material of any company is not a source for a scientific or legal fact.

**C4. Citation and access-date discipline.** Every external fact used in the product or its documentation is recorded in `data/citations.json` with the schema given in G1.11, including the exact access date and a verbatim supporting quotation of ≤ 25 words. A local snapshot of every non-permanent web source is stored under `docs/sources/`. A citation an independent reader cannot resolve is not a citation.

**C5. Prohibitions, absolute.** Do not invent or approximate: a citation, an identifier, a statistic, a prevalence, an effect size, a heritability, a coverage figure, a regulator's position, a legal conclusion, a jurisdiction's status, a clinical guideline, a reviewer's name, or a signed record. Do not paraphrase a statute from memory. Do not infer a regulator's position from a company's compliance claim. Do not carry a number from one phenotype to another. Where a required number cannot be sourced, the capability enters the withheld path or renders an explicit unavailability state; it never renders a plausible-looking figure. **This applies to statements about the category as much as to the product**: no claim about what any other company does may appear anywhere in the tree, because such a claim can only be cited by naming them, which G6 forbids — so it must not be written at all.

**C6. Number traceability.** Every number a user can see resolves to exactly one of: (a) a value computed from that user's own uploaded data by code covered by unit tests; (b) a row in a seeded dataset in `data/` whose provenance and licence are recorded; (c) a cited source in `data/citations.json`; or (d) an exempt UI-chrome numeral per G1.11. Hard-coded illustrative numbers in copy are prohibited, and because Part B item 2 removes demonstration surfaces entirely there is no carve-out for example values.

**C7. Data hygiene.** All fixtures are synthetic or drawn from openly published, consented reference materials whose licence permits redistribution and is recorded. No real person's genome, no real embryo data, no scraped customer data, and no personal data enters the repository, the test suite, screenshots or logs. Synthetic fixtures say so in-file. Test accounts use `@e2e.local` addresses. **One exemption, and only one:** the identity and professional qualification of a named reviewer who has consented in writing to publication of their sign-off, stored under `docs/reviews/`, is permitted personal data; the reviewer's consent record itself is stored out of tree, and their written consent is a precondition of committing the record. Without this exemption G5.5 and C7 would contradict each other outright.

**C8. Network and tooling rules.** Research may use the network. The application may not: no third-party origin may be contacted from a user-facing page; annotation and reference data are served from Inherit's own store; Copilot's cloud path requires the named, revocable consent grant before any genome-derived byte leaves; and no jurisdiction, locale or geo lookup of any kind is performed against a third party. Do not fetch, embed, scrape or reproduce any competing product's copy, code, assets or data. Category knowledge enters this work only as first-order requirements on Inherit.

**C9. Verification before shipping.** Every external factual claim is verified against its primary source by an agent other than the one that introduced it, and the verification is recorded (verifier, date, source, verdict). A claim verified only by the agent that wrote it is unverified. Where two sources conflict, both are recorded and the conservative reading ships.

**C10. Evidence in agent reports.** A report is admissible only with artifacts: file paths and diffs, commands with exit codes, test names with pass/fail, screenshots or DOM extracts, cited sources with quotations, or a reproduction recipe. Prose describing what an agent believes it did is not evidence and is discarded without further consideration.



---

## 11. The multi-agent search and audit protocol

**D1. Ledgers.** The root orchestrator maintains four committed, append-only ledgers: `docs/protocol/approaches.md` (approach-family registry), `docs/protocol/defects.md` (every defect with id, discovering lens, reproduction, severity, status), `docs/protocol/decisions.md` (every route killed, with the evidence that killed it), and `docs/protocol/gates.md` (each gate: last run, command, exit code, artifact). No agent edits another agent's entries; corrections are appended.

**D2. The initial portfolio and file ownership.** Launch at least nine workstreams in parallel: (1) information architecture and Overview; (2) My Genome — reports, ancestry, archaic ancestry; (3) Family — heritability and the future-child preview; (4) Embryo Analysis — ingest, per-subject analysis, comparison; (5) Copilot — the three domain-scoped assistants and their retrieval boundaries; (6) consent, identity and jurisdiction; (7) statistical presentation; (8) language and accessibility; (9) platform — schema, RLS, worker, gates, CI. Parallelism only works with an ownership map, so `docs/protocol/ownership.md` maps each path prefix to exactly one workstream. **`supabase/migrations/`, `src/app/globals.css` and the shared navigation component are owned solely by Platform**; every other stream requests changes through `decisions.md` rather than editing, and **all schema changes are serialised through one migration author**, because timestamp-ordered migration filenames written by nine streams in parallel will collide and reorder. Streams may read each other's ledgers freely.

**D3. Keep incompatible routes alive.** For each of these, at least **three materially different routes** are built to a testable prototype and kept alive until evidence eliminates them: the Overview structure; the embryo comparison presentation; the future-child preview framing; the not-covered state; the third-party-subject consent flow. A route may be eliminated only by evidence recorded in `decisions.md`: a failed comprehension threshold, a failed accessibility check, a failed accuracy gate, a legal blocker with a citation, or a measured task-depth or task-time loss. Elimination by preference, aesthetics, effort or "the team converged" is prohibited and is itself a defect. At least two routes survive to the final comprehension round for every item. **Sampling rule**, so the cost does not become combinatorial: variant comparison runs only the task that touches the surface under test — Overview → T1; embryo comparison → T6; future-child preview → T7; not-covered state → T3; third-party consent → T4. The full ten-task run is executed once per release candidate, on the merged design only.

**D4. Approach-family registry and redirection.** Each proposal is tagged with an approach family — its core mechanism, not its styling. The orchestrator redirects agents when more than half the active agents in a workstream occupy one family, or two consecutive rounds produce no artifact in a family not already present, or a family produces no new admissible defect or design distinction for two rounds. Redirection is explicit: the agent is given a named family it may not use and a constraint forcing a different mechanism ("no modal", "no ranking", "no number above the fold", "must work with the map disabled").

**D5. Mandatory adversarial lenses.** Every release candidate is attacked by all nine, each returning a written finding set with reproductions; each finding enters `defects.md`. **The hostile regulator** — every claim deceptive by net impression, and every capability offered where the instrument they cite forbids it. **The plaintiff's lawyer** — the three strongest claims, each traced to the exact rendered string and the missing disclosure. **The statistical geneticist** — every figure whose stated quantity differs from the computed quantity, every missing interval, every portability and within-family attenuation issue, every ignored trade-off. **The person with no scientific education** — a think-aloud transcript per task and every point of confusion. **The person uploaded by someone else who did not want to be** — the exact steps to discover, contest and delete their record, with elapsed time and every dead end. **The future adult conceived from a screened embryo** — what exists about them, who holds it, for how long, and what they can do, answered only from shipped surfaces. **The screen-reader user** — a full task run with announced output, focus order and every unlabelled control. **The journalist** — the single most misleading sentence on the site and the question they would put to the operator. **The on-call engineer** — what breaks under a truncated upload, a malformed file, a revoked grant mid-render, and a jurisdiction change between page load and submit. A lens returning "no findings" must state what it attacked and how, or its round does not count.

**D5a. Simulated lenses are labelled as simulated.** Where a lens is executed by a simulated participant rather than a human — which will be the case for the naive user, the screen-reader user, the uploaded subject and the future adult — every transcript, quotation and elapsed-time figure it produces is stored with `simulated: true` and the persona seed, and is **never** described as a user observation in `defects.md`, in an ADR, or in any published or user-facing document. A defect discovered by a simulated lens is admissible; a claim about what real users do, sourced from a simulated lens, is not. Without this rule the protocol manufactures synthetic transcripts that C5 forbids and that will later be read as human observation.

**D6. Loop until dry.** Defect discovery repeats until **two consecutive full adversarial rounds produce zero new admissible defects**, admissible meaning reproducible from the written recipe by a different agent. Fixing a defect resets nothing but its own status; a fix requires re-running the affected gates and a fresh adversarial round. A round in which a lens is skipped does not count. A reproducible cosmetic defect is a defect and is either fixed or recorded with a reasoned deferral in `defects.md`; deferrals may not touch any safety, accuracy, legal, accessibility or comprehension surface.

**D7. Artifacts, not status.** Every agent returns artifacts per C10. The orchestrator discards any return that is a plan, a summary of intent, an explanation of difficulty or a partial draft offered as progress, and re-issues the task with narrower scope. Agents do not report percentages of completion.

**D8. Synthesis and repair.** The orchestrator merges surviving routes into one shipped design per surface, recording the killed alternatives and their killing evidence; re-runs the full gate set after every merge; and assigns repair to a different agent than the one that wrote the defective code where the defect is a misreading of a requirement. When a gate fails twice with the same root cause, the orchestrator changes approach family rather than re-attempting the same fix. Cross-workstream conflicts resolve by the precedence order **legality > accuracy > comprehension > accessibility > simplicity > aesthetics**, with one binding tie-break written on top of it: **where accuracy and simplicity collide, the resolution is fewer claims on the surface, not more caveats around them.** Accessibility stays above simplicity — a design that is simple for most people and unusable for some is not simple — but the tie-break, together with G2.5's two-block structure and density ceilings, is what stops the precedence order from silently authorising caveat-stacking. Note also that precedence governs *agent conflicts*, not gate arithmetic: a gate evaluating NO blocks termination regardless of where its subject sits in the order, which is why the density and accuracy budgets are reconciled numerically in G2.5 rather than by appeal to precedence.

**D9. Termination.** The orchestrator returns only when: every Part A gate is YES with its command, exit code and artifact recorded in `gates.md`; every capability appears in the capability register as `shipped`, `shipped-degraded` with its honest UI state, or `withheld` with a complete dossier; `defects.md` has no open finding on any safety, accuracy, legal, accessibility or comprehension surface; D6's loop-until-dry condition is satisfied; and G8.4 has passed twice consecutively from a clean database. **Do not stop early. Do not declare partial success. Do not return a status report, an optimistic summary, an explanation of difficulty, or a best-effort partial draft.** If a gate appears unreachable, the permitted paths are exactly two: change approach family and continue, or complete the capability-withheld dossier or the gate-blocker dossier for that specific item while every other gate reaches YES.

---

## 12. Decisions only the operator can settle

These are genuine forks, surfaced rather than silently resolved. Where the operator has not answered, take the
adopted reading named in each item, record the choice in `docs/protocol/decisions.md` with its reasoning, and build
so that reversing it is a contained change rather than a rewrite.

1. Copilot as a route versus a dock: X1.2 resolves it to a route because the user's sketch names Copilot as the third box in each domain and a dock plus a route is the same product built twice. If the user in fact wants a persistent ask-anywhere affordance, the resolution should invert and the nine-box Overview would need a different third box per domain — the user should confirm which reading of the sketch is intended.
2. Whether the Family domain's first box is named 'Individual risks' (adopted here) or 'Individual heritability risks' (the user's literal sketch wording). The literal wording promises a heritability number that X9.2 forbids rendering, so the label was changed; this trades fidelity to the sketch against scientific accuracy and is a user-facing naming decision.
3. The transferred-embryo retention exception in X11.2 keeps a record about a person for roughly two decades so that the Future Person Charter can be honoured. The alternative — deletion at 24 months for every embryo record — is simpler and safer against breach, but makes the Charter unenforceable and fails the future-adult comprehension task. Only the operator, with counsel, can settle which risk they prefer.
4. Whether the confirmation block should attach to 'emerging' as well as 'clinical' and 'established'. After the evidence remap, 119 of 151 templates sit at 'emerging' and none at 'established', so as specified the block is dormant on the entire shipped library. Attaching it to 'emerging' makes it near-universal and risks caveat fatigue; leaving it dormant means the highest-consequence disclosure never renders on day one.
5. The single natural-frequency denominator rule (X4.1) forbids two figures on one page using different denominators, but the family health picture and the embryo comparison legitimately place many conditions of very different prevalence on one surface. Whether the denominator is scoped per claim block (adopted) or per page needs a comprehension test before it is fixed, because per-block scoping means one table can show 'in 100' and 'in 10,000' side by side.
6. Whether pharmacogenomics ships as a populated report category or is registered as withheld. It is a core service of this category with zero published templates today, and populating it is a substantial science workstream nobody was assigned.
7. The liability cap figure in X12.4 must be a real number before any build ships, and no dimension can invent one. Until counsel supplies it the specification cannot state it, yet the placeholder gate forbids a token in its place.

---

## 13. Termination

Return **only** when every gate in §8 evaluates to YES and the whole has survived the adversarial audit of §11 with
no substantive gap remaining.

Do not return a reduction of the goal to a smaller goal. Do not return a subset of the three domains. Do not return
a surface without its pipeline, a pipeline without its tests, a feature without its jurisdiction gate, a number
without its comparison, a consent without its version, or a claim without its citation. Do not return a status
report, an optimistic summary, an explanation of difficulty, or a best-effort partial draft. If an approach fails,
diagnose it, abandon it, and open a new one. If an agent reports a gap of the same difficulty as the goal, mark that
route blocked, record why in the approach registry, and attack from a different direction.

The one alternative complete outcome is the rigorous, evidenced demonstration — in the form §8 requires — that a
specific named capability cannot be delivered lawfully or honestly. Everything else still ships around it, the
demonstration is published as an ADR and as a user-facing page, and the remaining gates still evaluate to YES.

Persist until Inherit is finished.
