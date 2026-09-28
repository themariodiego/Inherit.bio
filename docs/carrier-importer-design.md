# Carrier importer: design for owner approval

Status: proposal, 28 September 2026. The owner chose "design first" that day
(`docs/protocol/decisions.md`). Nothing is imported until the owner approves
this design, and carrier results stay withheld until then. Family stays closed
in production (decision of 27 September).

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
2. **Starter conditions.**
   - Recommended: a short list of autosomal recessive conditions whose common
     pathogenic alleles are single-letter or small changes that arrays and
     VCFs can read. Each one is drawn from the ACMG carrier-screening practice
     resource and has a Definitive or Strong ClinGen rating.
   - Excluded: conditions that need copy-number or repeat testing, such as
     spinal muscular atrophy and fragile X. X-linked conditions come only
     after ADR 0034's serious-condition review.
   - Alternative: wait for US counsel before choosing any.
3. **The live CF report.**
   - Recommended: reword it now. Drop "carrier status" and the per-pregnancy
     sentence. Keep the finding, the caveats and the laboratory line. Apply it
     through the guarded catalogue refresh, with a receipt.
   - Alternative: leave it as it is until US counsel advises.
   - Alternative: withhold the report.
