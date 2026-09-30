# Carrier importer: design for owner approval

Status: built, awaiting the owner's final nod on the starter list, 28
September 2026. The owner chose "design first" that day and then answered the
three questions below (`docs/protocol/decisions.md`). The importer, the rule
and both readers are built ("As built", below). Nothing is imported into
production until the owner approves the starter list, and no condition counts
until a named reviewer activates it, so carrier results stay unavailable until
then. Family stays closed in production (decision of 27 September).

The section "Why an importer is needed" describes the code before this work,
and its line numbers are that code's.

## Why an importer is needed

Carrier-pair results render nowhere today, by construction:

- **The production reader returns nothing.**
  - `readClassifiedVariants` (`src/lib/family/carrier-pair.ts:540-550`) ignores
    the database and returns an empty list "until the reviewed clinical
    assertion importer exists"; `carrier-pair.test.ts` pins it.
  - So the health picture and Portrait say the check is unavailable.
  - The carrier warnings shipped on 27 September (`carrier-panel.tsx`) never
    render.
- **The tables cannot hold a reviewed assertion.**
  - `ref_variants` is keyed by rsID, with one ALT per rsID. It has no
    condition, assertion, review-date or release column, and nothing fills
    its two ClinVar columns.
  - `condition_registry` has no rows outside tests.
  - `inheritance_mode` may be null. The brief's X16.3 requires not-null with
    a check.
  - There is no penetrance class and no severity, and ADR 0034 needs severity
    to say a sex-linked condition is serious.
- **Modern uploads would stay dark even with labels.** The carrier reads use
  legacy file IDs only, and the register marks canonical clinical outputs
  unavailable (`docs/route-register.json:15045`). A reader over prepared
  sources is needed too.

It blocks:
- G5.9;
- the two unproven `/family/portrait/[pairId]` states, `complete` and
  `partial-coverage`, which are 2 of the 11 unproven route states behind
  G1.7, G1.12 and G2.2;
- the capability register's "Carrier status" and "Carrier-pair arithmetic"
  rows.

## What is already decided

The design must meet these rules and changes none of them.

- **What counts as clinical evidence** (brief lines 1193 and 1452). All three
  must hold:
  - pathogenic or likely pathogenic under ACMG/AMP;
  - a ClinVar review status of two stars or more, with no conflicting
    interpretation;
  - a gene–disease link rated Definitive or Strong.
- **What every variant card shows** (brief 1329-1335):
  - penetrance as a cited range, or "not established";
  - "checked at {n} of the {N} positions";
  - a laboratory-confirmation line on every pathogenic finding;
  - the ClinVar review status and classification date as text.
- **The arithmetic** (ADR 0017; `carrier-pair.ts`):
  - autosomal recessive gives 1 in 4 per pregnancy;
  - X-linked needs both people's declared sex;
  - dominant or unknown inheritance is refused by name;
  - the two-copies, not-covered and runs-of-homozygosity refusals stay.
- **Sex-linked conditions** (ADR 0034): only a registered *serious*
  condition, with its own signed review.
- **Sources of reference data** (ADR 0005): fetched by the platform's own
  catalogue, never keyed by user data.
- **Citations**: every citation carries an access date. The claims and
  template gates already enforce this.
- **Jurisdiction**: `carrier_match` is unreviewed everywhere except under the
  test jurisdiction.

## Proposed design

1. **Source: ClinVar, pinned by release.**
   - Use ClinVar's monthly release, which `docs/dataset-licenses.md` records
     as usable with attribution.
   - A manifest records the release date, source URL, SHA-256, record count
     and retrieval time.
   - The script has `--fetch` and `--check` modes, the pattern of
     `scripts/build-discriminating-sites.ts`.
2. **Gene–disease validity: ClinGen.** A condition is eligible only if ClinGen
   rates its gene–disease link Definitive or Strong. ClinGen's licence is to
   be confirmed before the first import.
3. **Alleles are keyed exactly, never by rsID.**
   - The key is build, chromosome, position, REF and ALT, left-aligned and
     parsimonious.
   - GRCh37 and GRCh38 are both stored, with the liftover evidence.
   - A label never applies to every allele at an rsID. This is exactly the
     legacy behaviour the reader refuses today.
4. **New tables, versioned like the ancestry region releases.**
   - `clinical_assertion_releases` holds the release id, source SHA-256,
     published date and retired date.
   - `clinical_assertions` holds one row per assertion:
     - the allele key;
     - the condition (a MONDO id);
     - the ClinVar variation id and version;
     - the classification, star count and conflict flag;
     - the date last evaluated;
     - the release id.
5. **Condition registry rows**, written inactive:
   - a MONDO id and name;
   - an inheritance mode (not null, checked);
   - a penetrance class with a citation;
   - a severity class;
   - citation ids with access dates.
6. **The acceptance rule in the production reader.** A position counts only
   when all of these hold:
   - an exact allele match;
   - pathogenic or likely pathogenic;
   - two stars or more;
   - no conflict;
   - a Definitive or Strong gene–disease link;
   - a release that is not retired;
   - an active condition row.

   Anything else is "not covered", never "not a carrier".
7. **Activation needs a person.**
   - The importer writes inactive rows only.
   - A named reviewer activates each condition, and that review is recorded.
   - The starter list itself needs the owner's approval (question 2).
8. **Prepared sources.** Add a carrier reader over the canonical prepared
   records, so a person's current upload is read, not only legacy files.
9. **Verification before any production write.**
   - pgTAP proves the reader refuses rsID-wide labels, one-star labels,
     conflicting labels, variants of uncertain significance and inactive
     conditions.
   - Vitest runs the importer against a small pinned extract.
   - A browser test proves `/family/portrait/[pairId]` in `complete` and
     `partial-coverage` under the test jurisdiction, using the existing
     synthetic carrier-pair fixtures.
   - The imported rows are reference data, not anyone's genome. They reach
     production only through a guarded apply that the owner approves, like
     the catalogue refresh.

Engineering estimate: five pull requests. They are the schema, the importer,
the reader, the prepared-source reader, and the browser proofs. The first
import happens only after question 2 is answered.

## As built, 28 September 2026

The proposal above, point by point, with every difference named.

1. **ClinVar, pinned.** `scripts/build-carrier-assertions.ts` reads ClinVar's
   `variant_summary` archive for 2026-09 from NCBI's FTP. It has `--fetch`,
   `--check` and `--emit-sql` modes. `data/ref/carrier/manifest.json` records
   each source's URL, release, retrieval time, bytes and SHA-256;
   `data/ref/carrier/PROVENANCE.md` states the licences and counts.
   `--check` rebuilds every pinned file from the cached sources and fails on
   any difference.
2. **ClinGen.** The gene–disease validity download is CC0 1.0
   (`docs/dataset-licenses.md`). A condition is kept only when ClinGen rates
   its link Definitive or Strong for autosomal recessive inheritance, and
   ClinVar names the same MONDO disease on the gene's classified changes.
3. **Exact keys.** GRCh38 chromosome, position, REF and ALT, for single-letter
   changes and simple left-aligned insertions or deletions. An insertion or
   deletion inside a repeat also lists its other spellings, read from NCBI
   reference windows (`src/lib/family/allele-key.ts`). ClinVar's own GRCh37
   placement is stored as evidence; no liftover evidence is stored, because
   ClinVar places the allele on both builds itself. Complex changes are left
   out, and the manifest counts each exclusion reason.
4. **Tables.** Migration `20260929130000_carrier_assertions.sql` adds
   `clinical_assertion_releases`, `carrier_conditions`,
   `carrier_condition_reviews` (append-only) and `clinical_assertions`. The
   service role reads them; every write goes through one of three doors.
5. **Condition rows** are written inactive, each with its MONDO id, a checked
   not-null inheritance mode, the ClinGen classification, date and URL, a
   penetrance class and a severity class. Every penetrance class is
   `unestablished` for now, so each finding carries the brief's exact
   "not been established" label. Citation ids are not stored yet; the
   ClinGen URL and date stand in for them.
6. **The rule.** `private.carrier_assertion_rule_v1` is the only reader of the
   tables. Legacy rsID-wide labels in `ref_variants` and `condition_registry`
   are never read for a carrier result.
7. **Activation.** `review_carrier_condition_v1` records a named reviewer's
   decision, and a trigger refuses any other way to activate a condition. An
   X-linked condition needs the reviewer to judge it serious (ADR 0034).
8. **Readers.**
   - Legacy files: `readClassifiedVariants` reads `carrier_assertions_v1`, and
     each file is read by exact allele at the rule's loci
     (`getSubjectCallsAtLoci`, `exactGenotypes`).
   - Prepared sources, on Portrait: `family_portrait_carrier_calls_v1` proves
     the page's readiness receipt again and reads each person's current
     prepared source at the rule's loci only
     (`src/lib/family/carrier-canonical.ts`). The health picture and Overview
     still read legacy files only.
   - Runs of homozygosity for a prepared source are measured as the verified
     bytes stream past and stored once through
     `record_own_normalization_runs_v1`. A file without a measure is "not
     checked", and the rule refuses the arithmetic for it.
   - Every reviewed finding names the ClinVar variant, the classification, the
     review status and the date as text, with the brief's laboratory line and
     the ClinVar and ClinGen attribution
     (`src/components/family/assertion-notes.tsx`).
9. **Verification.**
   - pgTAP: `supabase/tests/carrier_assertions.sql` (51) and
     `supabase/tests/carrier_portrait_reader.sql` (23).
   - Vitest: the importer against a pinned extract of real ClinVar lines, the
     exact-allele reader, the Portrait reader and the evidence copy.
   - Browser: `e2e/portrait-reviewed-carrier.spec.ts` proves
     `/family/portrait/[pairId]` `complete` and `partial-coverage` with a
     synthetic release imported and reviewed through the same doors. It needs
     the unmerged migration, so its first run is CI's.

**The production path**, in this order:

1. apply the migration;
2. the owner approves the starter list;
3. apply the import through the guarded SQL that `--emit-sql` writes, whose
   dry run rolls back;
4. a named reviewer activates each condition.

Until step 4, the rule holds nothing, and every surface still says the check
is unavailable.

## A finding for the owner: a live report already names carrier status

`cystic-fibrosis-cftr-f508del-informational`
(`data/templates/reproductive-family.json`) is published in production; this
was checked read-only on 28 September. For one copy of F508del it says the
result is "consistent with CF carrier status". It adds that if both partners
carry a CF-causing variant, "each pregnancy has a 1-in-4 chance of CF".

Its caveats are good: it checks one variant, it is not carrier screening, and
a laboratory should confirm the result. But it contradicts the capability
register, which says no template names carrier status. It also shows no
ClinVar review status or classification date, which the brief requires.

It is an own-genome report, not a partner result. Still, it is the kind of
consumer carrier statement FDA's rule for carrier tests addresses. On
27 September the owner left that rule's conflict with the brief to US counsel.
The capability register row is corrected in the same change as this document.
Changing the published text is a production content change, so it waits for
question 3.

**Answered, 2026-09-28:** the owner chose to reword it now. The template drops
"carrier status" and the per-pregnancy sentence and keeps the finding, the
caveats and the laboratory line; `gate:templates` now refuses both phrases in
any template. Production takes the text through the guarded catalogue refresh.

## Questions for the owner

1. **Evidence threshold.**
   - Recommended: the brief's own rule, which is two stars or more, no
     conflict, pathogenic or likely pathogenic, and a Definitive or Strong
     gene–disease link.
   - Alternative: expert-panel review (three stars) only. That is fewer
     conditions, each more certain.

   **Answered, 2026-09-28:** the brief's own rule. It is the rule in the
   migration and in the importer.
2. **Starter conditions.**
   - Recommended: a short list of autosomal recessive conditions whose common
     pathogenic alleles are single-letter or small changes that arrays and
     VCFs can read. Each one is drawn from the ACMG carrier-screening practice
     resource and has a Definitive or Strong ClinGen rating.
   - Excluded: conditions that need copy-number or repeat testing, such as
     spinal muscular atrophy and fragile X. X-linked conditions come only
     after ADR 0034's serious-condition review.
   - Alternative: wait for US counsel before choosing any.

   **Answered, 2026-09-28:** a short autosomal recessive list from the ACMG
   practice resource, each Definitive or Strong in ClinGen, with no
   copy-number, repeat or X-linked condition. Engineering proposes eight
   (`data/ref/carrier/conditions.json`): cystic fibrosis (CFTR), Tay-Sachs
   disease (HEXA), phenylketonuria (PAH), MCAD deficiency (ACADM), Canavan
   disease (ASPA), Wilson disease (ATP7B), Smith-Lemli-Opitz syndrome (DHCR7)
   and Pompe disease (GAA). The list waits for the owner's final nod.
3. **The live CF report.**
   - Recommended: reword it now. Drop "carrier status" and the per-pregnancy
     sentence. Keep the finding, the caveats and the laboratory line. Apply it
     through the guarded catalogue refresh, with a receipt.
   - Alternative: leave it as it is until US counsel advises.
   - Alternative: withhold the report.
