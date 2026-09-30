# Carrier condition review: Wilson disease (ATP7B)

This note is the `review_reference` for activating `MONDO:0010200` through
`review_carrier_condition_v1`, at registry revision 1, from release
`clinvar-2026-09`. It was prepared on 28 September 2026 for the owner, who is the named reviewer.

- The condition is imported inactive. Nobody sees a result for it until the owner signs the
  checklist at the end and the activation runs with this file as its reference.
- If a later import changes what ClinGen or ClinVar says about the condition, it becomes a new
  revision and goes inactive again. It then needs a new review.
- Everything above the sign-off section is built from the pinned data and the product's own
  components (`scripts/carrier-condition-review.ts`). `scripts/carrier-condition-review.test.ts`
  builds it again and fails if a count, a source or a word has changed.

## The condition

| Field | Value |
| --- | --- |
| Condition | Wilson disease |
| MONDO id | MONDO:0010200 |
| Gene | ATP7B |
| Inheritance | Autosomal recessive |
| ClinGen classification | Definitive, for autosomal recessive inheritance |
| ClinGen disease label | Wilson disease |
| ClinGen date | 2019-03-27 |
| ClinGen panel | General Gene Curation Expert Panel |
| ClinGen record | https://search.clinicalgenome.org/kb/gene-validity/CGGV:assertion_f0ac0a41-d7d5-4377-a622-1ee9bc4ed9f3-2019-03-27T160000.000Z |
| ACMG practice resource | Table 1 |
| Penetrance | Not established: no range is cited, so every finding carries the brief's label |

Sources, all pinned in `data/ref/carrier/manifest.json`:

- ClinGen's gene–disease validity download, file dated 2026-09-28, SHA-256 `2851dedb7bae1cbee71fb8e6589f2e1ffb99e44e2244a7785af744c562263dff`.
- Gregg AR et al. Screening for autosomal recessive and X-linked conditions during pregnancy and
  preconception: a practice resource of the ACMG. Genet Med 2021;23(10):1793-1806. PMID 34285390,
  read 28 September 2026.
- ClinVar's `variant_summary` for 2026-09, SHA-256 `186ad2838a138f0bc7a79b1b7b6dde5533b105175d293e1131652889529804c9`.

## What the release holds

The release holds 386 assertions for Wilson disease. Each one is pathogenic or likely pathogenic, has two review
stars or more, has no conflict, and names this condition.

| Assertions | Count |
| --- | ---: |
| All | 386 |
| Four stars: practice guideline | 0 |
| Three stars: reviewed by expert panel | 0 |
| Two stars: criteria provided, multiple submitters, no conflicts | 386 |
| Classified pathogenic | 129 |
| Classified likely pathogenic | 38 |
| Classified pathogenic/likely pathogenic | 219 |
| Single-letter changes | 239 |
| Insertions | 46 |
| Deletions | 101 |
| Insertions or deletions with other spellings listed | 116 |

### What the release leaves out

ClinVar's 2026-09 release has 3,692 GRCh38 records for ATP7B. 386 meet the bar and
3,306 do not. Each record left out is counted once, under the first test it fails:

| Left out because | Records |
| --- | ---: |
| Not classified pathogenic or likely pathogenic | 2,852 |
| Not a germline (inherited) classification | 99 |
| Fewer than two review stars | 349 |
| The record does not name this condition | 1 |
| Not a single-letter change or a simple insertion or deletion | 5 |

## The ten most-reported changes

The pinned sources give no population frequency. So the changes are ranked by how many
laboratories have submitted a classification to ClinVar (`NumberSubmitters` in the pinned
release), then by review stars. This shows how often laboratories meet a change. It is not how
common the change is.

| Rank | ClinVar name | VariationID | Classification | Stars | Submitters | Last evaluated |
| ---: | --- | ---: | --- | ---: | ---: | --- |
| 1 | NM_000053.4(ATP7B):c.3207C>A (p.His1069Gln) | [3848](https://www.ncbi.nlm.nih.gov/clinvar/variation/3848/) | Pathogenic | 2 | 46 | 2026-06-01 |
| 2 | NM_000053.4(ATP7B):c.2605G>A (p.Gly869Arg) | [157939](https://www.ncbi.nlm.nih.gov/clinvar/variation/157939/) | Pathogenic/Likely pathogenic | 2 | 30 | 2026-06-01 |
| 3 | NM_000053.4(ATP7B):c.2304dup (p.Met769fs) | [456552](https://www.ncbi.nlm.nih.gov/clinvar/variation/456552/) | Pathogenic/Likely pathogenic | 2 | 30 | 2026-04-01 |
| 4 | NM_000053.4(ATP7B):c.3402del (p.Ala1135fs) | [88958](https://www.ncbi.nlm.nih.gov/clinvar/variation/88958/) | Pathogenic | 2 | 25 | 2026-04-01 |
| 5 | NM_000053.4(ATP7B):c.122A>G (p.Asn41Ser) | [157928](https://www.ncbi.nlm.nih.gov/clinvar/variation/157928/) | Pathogenic/Likely pathogenic | 2 | 25 | 2026-06-01 |
| 6 | NM_000053.4(ATP7B):c.813C>A (p.Cys271Ter) | [188930](https://www.ncbi.nlm.nih.gov/clinvar/variation/188930/) | Pathogenic/Likely pathogenic | 2 | 25 | 2026-01-20 |
| 7 | NM_000053.4(ATP7B):c.1934T>G (p.Met645Arg) | [3862](https://www.ncbi.nlm.nih.gov/clinvar/variation/3862/) | Pathogenic/Likely pathogenic | 2 | 24 | 2026-02-18 |
| 8 | NM_000053.4(ATP7B):c.2930C>T (p.Thr977Met) | [35710](https://www.ncbi.nlm.nih.gov/clinvar/variation/35710/) | Pathogenic | 2 | 23 | 2026-01-26 |
| 9 | NM_000053.4(ATP7B):c.3955C>T (p.Arg1319Ter) | [35728](https://www.ncbi.nlm.nih.gov/clinvar/variation/35728/) | Pathogenic | 2 | 23 | 2026-01-24 |
| 10 | NM_000053.4(ATP7B):c.2128G>A (p.Gly710Ser) | [156281](https://www.ncbi.nlm.nih.gov/clinvar/variation/156281/) | Pathogenic/Likely pathogenic | 2 | 23 | 2026-04-21 |

## What a person sees

Where carrier results appear:

- Only on the Family pages, and only between two adults who have both agreed to share. No page
  shows one person their own carrier status on its own.
- Portrait (`/family/portrait/[pairId]`) reads both adults' current prepared files. The health
  picture (`/family/health-picture`) reads only older files, prepared before prepared uploads
  existed. The Overview shows only a count of findings, linked to the health picture.
- Partner results stay off in production, and Family stays closed everywhere (owner decision,
  27 September 2026, `docs/protocol/decisions.md`). Until that changes, activating this
  condition changes what the rule holds, not what anyone sees.

The words below are rendered from the product's own components. They use the most-reported change,
VariationID 3848, as the example. The reader is "You", and the other adult is
"Another adult", the label used when they have no name of their own.

- `{…}` marks a number that differs from pair to pair.
- `[…]` is a small tag beside a name.
- `(read aloud only: …)` is text only a screen reader reads.
- The lines after "See these numbers as a table" show only when the person opens the table.

### Portrait: both adults carry one copy of a change

Shown when both files show one copy of a reviewed change in ATP7B, both files' runs of matching
letters were measured below the limit, and nothing else refuses the arithmetic.

```text
A change in ATP7B
You [You] one copy
Another adult [Shared with you] one copy
You: NM_000053.4(ATP7B):c.3207C>A (p.His1069Gln) in ATP7B. ClinVar classifies it as pathogenic (review status: criteria provided, multiple submitters, no conflicts; last evaluated 1 June 2026).
Another adult: NM_000053.4(ATP7B):c.3207C>A (p.His1069Gln) in ATP7B. ClinVar classifies it as pathogenic (review status: criteria provided, multiple submitters, no conflicts; last evaluated 1 June 2026).
Before anyone acts on this, it needs confirming in an accredited laboratory. Consumer files are not a clinical test.
Penetrance for this variant has not been established.
Classifications from ClinVar (NCBI), release 2026-09. Gene links from ClinGen, read 28 September 2026.
1 in 4 (25%) affected · 2 in 4 (50%) carriers · 1 in 4 (25%) neither
Two copies of the change about 25 in 100 Out of 100 possible children, about 25 would have the condition.
One copy of the change about 50 in 100 Out of 100 possible children, about 50 would carry one copy of the change.
No copy of the change about 25 in 100 Out of 100 possible children, about 25 would have no copy of the change.
100 possible children, one dot each. No dot is a real child; together they show the spread of chances.
See these numbers as a table
What a child could inherit | Out of 100
Two copies of the change | 25
One copy of the change | 50
No copy of the change | 25
Both files cover {how many of these changes both files cover} of the 386 changes known to cause this condition.
How sure we are
The pattern
A change that only shows when a child gets a copy of it from both parents.
What we do not check
Which copy a child gets is decided at random, one position at a time.
No new change appears in a child that neither parent carries.
It makes no difference which parent a copy came from, because this gene is not registered as one where it does.
What we checked
Both files were measured for long runs of matching letters, and each sits below Inherit’s limit.
What both files covered
Both files cover the positions this uses.
What would change this
A different classification of this change by outside reviewers, or a file that covers positions these two do not.
Which half of each parent’s DNA a child gets is decided at random. Two children of the same parents can differ as much as any two brothers or sisters do.
This is a chance, not a prediction about a particular child.
We don’t have a counsellor to point you to where you are. Your doctor can refer you.
This is exact arithmetic, not an estimate.
```

### Portrait: one adult carries, and the other's file shows no copy

Shown when one file shows one copy, and the other file reads at least one of ATP7B's reviewed
positions and shows no change there.

```text
A change in ATP7B
You [You] one copy
Another adult [Shared with you] no copy found at the positions covered
You: NM_000053.4(ATP7B):c.3207C>A (p.His1069Gln) in ATP7B. ClinVar classifies it as pathogenic (review status: criteria provided, multiple submitters, no conflicts; last evaluated 1 June 2026).
Before anyone acts on this, it needs confirming in an accredited laboratory. Consumer files are not a clinical test.
Penetrance for this variant has not been established.
Classifications from ClinVar (NCBI), release 2026-09. Gene links from ClinGen, read 28 September 2026.
Based on the variants your files cover, we found no second copy in Another adult. This is not zero risk: your files do not cover every variant known to cause this condition.
Both files cover {how many of these changes both files cover} of the 386 changes known to cause this condition.
How sure we are
The pattern
A change that only shows when a child gets a copy of it from both parents.
What we do not check
No arithmetic was done here, so nothing rests on an assumption.
What both files covered
Both files cover {how many of these changes both files cover} of the 386 changes known to cause this condition.
What would change this
A file for Another adult that covers more of the changes known to cause this condition.
Which half of each parent’s DNA a child gets is decided at random. Two children of the same parents can differ as much as any two brothers or sisters do.
This is a chance, not a prediction about a particular child.
We don’t have a counsellor to point you to where you are. Your doctor can refer you.
```

### Portrait: one adult carries, and the other's file does not cover the gene

Shown when one file shows one copy, and the other file reads none of ATP7B's reviewed positions.

```text
A change in ATP7B
You [You] one copy
Another adult [Shared with you] none of the known positions covered
You: NM_000053.4(ATP7B):c.3207C>A (p.His1069Gln) in ATP7B. ClinVar classifies it as pathogenic (review status: criteria provided, multiple submitters, no conflicts; last evaluated 1 June 2026).
Before anyone acts on this, it needs confirming in an accredited laboratory. Consumer files are not a clinical test.
Penetrance for this variant has not been established.
Classifications from ClinVar (NCBI), release 2026-09. Gene links from ClinGen, read 28 September 2026.
We cannot do this calculation. Another adult’s file does not cover NM_000053.4(ATP7B):c.3207C>A (p.His1069Gln).
How sure we are
The pattern
A change that only shows when a child gets a copy of it from both parents.
What we do not check
No arithmetic was done here, so nothing rests on an assumption.
What both files covered
We cannot do this calculation. Another adult’s file does not cover NM_000053.4(ATP7B):c.3207C>A (p.His1069Gln).
What would change this
A file for Another adult that covers more of the changes known to cause this condition.
Which half of each parent’s DNA a child gets is decided at random. Two children of the same parents can differ as much as any two brothers or sisters do.
This is a chance, not a prediction about a particular child.
We don’t have a counsellor to point you to where you are. Your doctor can refer you.
```

### Portrait: a carrier finding the arithmetic refuses

Each of these replaces the chance with a named reason. None shows a number.

#### When one file shows two copies

One file shows two copies of a reviewed change and the other shows one.

```text
A change in ATP7B
You [You] two copies
Another adult [Shared with you] one copy
You: NM_000053.4(ATP7B):c.3207C>A (p.His1069Gln) in ATP7B. ClinVar classifies it as pathogenic (review status: criteria provided, multiple submitters, no conflicts; last evaluated 1 June 2026).
Another adult: NM_000053.4(ATP7B):c.3207C>A (p.His1069Gln) in ATP7B. ClinVar classifies it as pathogenic (review status: criteria provided, multiple submitters, no conflicts; last evaluated 1 June 2026).
Before anyone acts on this, it needs confirming in an accredited laboratory. Consumer files are not a clinical test.
Penetrance for this variant has not been established.
Classifications from ClinVar (NCBI), release 2026-09. Gene links from ClinGen, read 28 September 2026.
Both of you have a change in ATP7B, but Inherit cannot turn that into a chance for a pregnancy. Reason: one file shows two changed copies, not one.
How sure we are
The pattern
A change that only shows when a child gets a copy of it from both parents.
What we do not check
No arithmetic was done here, so nothing rests on an assumption.
What both files covered
Both files cover the positions this uses.
What would change this
A change in what outside reviewers say about this change, or in what Inherit records about this gene.
Which half of each parent’s DNA a child gets is decided at random. Two children of the same parents can differ as much as any two brothers or sisters do.
This is a chance, not a prediction about a particular child.
We don’t have a counsellor to point you to where you are. Your doctor can refer you.
```

#### When one file cannot show how many copies

One file reads the change but cannot show how many copies, such as a single-letter reading or a no-call.

```text
A change in ATP7B
You [You] copies not shown
Another adult [Shared with you] one copy
You: NM_000053.4(ATP7B):c.3207C>A (p.His1069Gln) in ATP7B. ClinVar classifies it as pathogenic (review status: criteria provided, multiple submitters, no conflicts; last evaluated 1 June 2026).
Another adult: NM_000053.4(ATP7B):c.3207C>A (p.His1069Gln) in ATP7B. ClinVar classifies it as pathogenic (review status: criteria provided, multiple submitters, no conflicts; last evaluated 1 June 2026).
Before anyone acts on this, it needs confirming in an accredited laboratory. Consumer files are not a clinical test.
Penetrance for this variant has not been established.
Classifications from ClinVar (NCBI), release 2026-09. Gene links from ClinGen, read 28 September 2026.
Both of you have a change in ATP7B, but Inherit cannot turn that into a chance for a pregnancy. Reason: one file does not show how many copies were read.
How sure we are
The pattern
A change that only shows when a child gets a copy of it from both parents.
What we do not check
No arithmetic was done here, so nothing rests on an assumption.
What both files covered
Both files cover the positions this uses.
What would change this
A change in what outside reviewers say about this change, or in what Inherit records about this gene.
Which half of each parent’s DNA a child gets is decided at random. Two children of the same parents can differ as much as any two brothers or sisters do.
This is a chance, not a prediction about a particular child.
We don’t have a counsellor to point you to where you are. Your doctor can refer you.
```

#### When one file is above the runs limit

Both carry one copy, and one file has more long runs of matching letters than Inherit's limit.

```text
A change in ATP7B
You [You] one copy
Another adult [Shared with you] one copy
You: NM_000053.4(ATP7B):c.3207C>A (p.His1069Gln) in ATP7B. ClinVar classifies it as pathogenic (review status: criteria provided, multiple submitters, no conflicts; last evaluated 1 June 2026).
Another adult: NM_000053.4(ATP7B):c.3207C>A (p.His1069Gln) in ATP7B. ClinVar classifies it as pathogenic (review status: criteria provided, multiple submitters, no conflicts; last evaluated 1 June 2026).
Before anyone acts on this, it needs confirming in an accredited laboratory. Consumer files are not a clinical test.
Penetrance for this variant has not been established.
Classifications from ClinVar (NCBI), release 2026-09. Gene links from ClinGen, read 28 September 2026.
These two files look more genetically similar than usual. That changes the maths in ways we cannot show you honestly here. Please talk to a genetic counsellor.
How sure we are
The pattern
A change that only shows when a child gets a copy of it from both parents.
What we do not check
The arithmetic needs both files below Inherit’s limit for long runs of matching letters. One file is above it.
What both files covered
Both files cover the positions this uses.
What would change this
A file for each person that Inherit can measure and that sits below that limit.
Which half of each parent’s DNA a child gets is decided at random. Two children of the same parents can differ as much as any two brothers or sisters do.
This is a chance, not a prediction about a particular child.
We don’t have a counsellor to point you to where you are. Your doctor can refer you.
```

#### When one file's runs could not be measured

Both carry one copy, and one file's runs of matching letters were never measured.

```text
A change in ATP7B
You [You] one copy
Another adult [Shared with you] one copy
You: NM_000053.4(ATP7B):c.3207C>A (p.His1069Gln) in ATP7B. ClinVar classifies it as pathogenic (review status: criteria provided, multiple submitters, no conflicts; last evaluated 1 June 2026).
Another adult: NM_000053.4(ATP7B):c.3207C>A (p.His1069Gln) in ATP7B. ClinVar classifies it as pathogenic (review status: criteria provided, multiple submitters, no conflicts; last evaluated 1 June 2026).
Before anyone acts on this, it needs confirming in an accredited laboratory. Consumer files are not a clinical test.
Penetrance for this variant has not been established.
Classifications from ClinVar (NCBI), release 2026-09. Gene links from ClinGen, read 28 September 2026.
Both of you have a change in ATP7B, but Inherit cannot turn that into a chance for a pregnancy. Reason: Inherit could not check how much of one file is made of long identical stretches.
How sure we are
The pattern
A change that only shows when a child gets a copy of it from both parents.
What we do not check
The arithmetic needs both files below Inherit’s limit for long runs of matching letters. One file could not be measured.
What both files covered
Both files cover the positions this uses.
What would change this
A file for each person that Inherit can measure and that sits below that limit.
Which half of each parent’s DNA a child gets is decided at random. Two children of the same parents can differ as much as any two brothers or sisters do.
This is a chance, not a prediction about a particular child.
We don’t have a counsellor to point you to where you are. Your doctor can refer you.
```

#### When one file does not cover the other's change

Each file shows one copy of a different reviewed change in the gene, and one file does not report the other's position. The example uses the second most-reported change for the other adult.

```text
A change in ATP7B
You [You] one copy
Another adult [Shared with you] one copy
You: NM_000053.4(ATP7B):c.3207C>A (p.His1069Gln) in ATP7B. ClinVar classifies it as pathogenic (review status: criteria provided, multiple submitters, no conflicts; last evaluated 1 June 2026).
Another adult: NM_000053.4(ATP7B):c.2605G>A (p.Gly869Arg) in ATP7B. ClinVar classifies it as pathogenic/likely pathogenic (review status: criteria provided, multiple submitters, no conflicts; last evaluated 1 June 2026).
Before anyone acts on this, it needs confirming in an accredited laboratory. Consumer files are not a clinical test.
Penetrance for this variant has not been established.
Classifications from ClinVar (NCBI), release 2026-09. Gene links from ClinGen, read 28 September 2026.
We cannot do this calculation. Another adult’s file does not cover NM_000053.4(ATP7B):c.3207C>A (p.His1069Gln).
How sure we are
The pattern
A change that only shows when a child gets a copy of it from both parents.
What we do not check
No arithmetic was done here, so nothing rests on an assumption.
What both files covered
We cannot do this calculation. Another adult’s file does not cover NM_000053.4(ATP7B):c.3207C>A (p.His1069Gln).
What would change this
A file for that person that covers the position.
Which half of each parent’s DNA a child gets is decided at random. Two children of the same parents can differ as much as any two brothers or sisters do.
This is a chance, not a prediction about a particular child.
We don’t have a counsellor to point you to where you are. Your doctor can refer you.
```

### Health picture: both adults carry one copy of a change

The carrier panel above the health picture's table. The "What this check cannot tell you" list
and the runs source close the panel once, whatever it holds.

```text
A change you both carry
You [You] (read aloud only: You:) one copy
Another adult [Shared with you] (read aloud only: Another adult:) one copy
For each pregnancy, about 25 in 100 — a 1 in 4 chance — that a child inherits both copies. Each pregnancy is independent; this is not 1 in 4 of your children.
You: NM_000053.4(ATP7B):c.3207C>A (p.His1069Gln) in ATP7B. ClinVar classifies it as pathogenic (review status: criteria provided, multiple submitters, no conflicts; last evaluated 1 June 2026).
Another adult: NM_000053.4(ATP7B):c.3207C>A (p.His1069Gln) in ATP7B. ClinVar classifies it as pathogenic (review status: criteria provided, multiple submitters, no conflicts; last evaluated 1 June 2026).
Before anyone acts on this, it needs confirming in an accredited laboratory. Consumer files are not a clinical test.
Penetrance for this variant has not been established.
Classifications from ClinVar (NCBI), release 2026-09. Gene links from ClinGen, read 28 September 2026.
We don’t have a counsellor to point you to where you are. Your doctor can refer you.
This is exact arithmetic, not an estimate.
What this check cannot tell you
It is not a diagnosis, and it cannot test a pregnancy.
It reads only some positions in each gene. No shared change does not rule out that a child could be affected.
It can show a change that a clinical test would not find. Confirm any result with a clinical laboratory before you act on it.
Your ancestry can affect how well it works.
It does not replace a visit to your doctor.
Inherit measured long runs of matching letters in each file. It did so the way McQuillan and colleagues did in 2008. 10.1016/j.ajhg.2008.08.007
```

A refused finding on the health picture shows the same block with no chance, no "1 in 4" and no
exactness line. This sentence stands in place of the chance, one per reason:

- When one file shows two copies:

```text
Both of you have a change in ATP7B, but Inherit cannot turn that into a chance for a pregnancy. Reason: one file shows two changed copies, not one.
```

- When one file cannot show how many copies:

```text
Both of you have a change in ATP7B, but Inherit cannot turn that into a chance for a pregnancy. Reason: one file does not show how many copies were read.
```

- When one file is above the runs limit:

```text
Both of you have a change in ATP7B, but Inherit cannot turn that into a chance for a pregnancy. Reason: one file has more long identical stretches than Inherit’s limit allows.
```

- When one file's runs could not be measured:

```text
Both of you have a change in ATP7B, but Inherit cannot turn that into a chance for a pregnancy. Reason: Inherit could not check how much of one file is made of long identical stretches.
```

- When one file does not cover the other's change:

```text
Both of you have a change in ATP7B, but Inherit cannot turn that into a chance for a pregnancy. Reason: one file does not cover the position the other person’s change is at.
```

### No finding

A gene with no finding is not named at all when another gene has one: the pages list only genes
with a card. When nothing is found for either adult, the pages say:

Health picture, when the two files share reviewed positions and neither card applies:

```text
A change you both carry
No change to show that you both carry. Inherit checked the {how many reviewed positions both files cover} positions both files cover.
What this check cannot tell you
It is not a diagnosis, and it cannot test a pregnancy.
It reads only some positions in each gene. No shared change does not rule out that a child could be affected.
It can show a change that a clinical test would not find. Confirm any result with a clinical laboratory before you act on it.
Your ancestry can affect how well it works.
It does not replace a visit to your doctor.
```

Portrait, one sentence in place of every card:

- When the rule holds nothing, or the database cannot answer:

```text
This check is unavailable. Inherit cannot yet verify the evidence for each gene change. This is not a negative carrier screen.
```

- When the two files share no reviewed position:

```text
The two files cover none of the same classified positions, so there is nothing to work out.
```

- When they share positions and no card applies:

```text
No change to show that you both carry. Inherit checked the {how many reviewed positions both files cover} positions both files cover.
```

Overview, only when a pair has at least one finding (with the count of findings):

```text
1 carrier match to look at Two people carry a change in the same gene.
```

## Known limits

- **Arrays read single-letter changes only, and not all of them.** An array file is read only at a
  single-letter change whose two letters are not complements: 192 of the 386.
  Inherit holds no list of the positions each array tests, so it cannot say how many of those a
  given array covers. A position an array does not test counts as not covered, never as no copy.
- **Strand-ambiguous changes are never read from an array.** 47 of the single-letter changes swap A
  and T, or C and G. An array cannot show which strand it read, so these are read only from a VCF.
- **Insertions and deletions need a GRCh38 VCF that shows the change.** 147 of the 386 are
  insertions or deletions.
  - Arrays never read them.
  - A GRCh37 VCF's insertions and deletions are not carried over to GRCh38, so they are not read.
  - A GRCh38 VCF counts only when it writes the same change, or one of the other spellings
    listed for 116 of them.
  - A file that does not show the change never counts as covering it. So for these changes the
    other adult's file reads as "does not cover", never as "no second copy".
- **Long deletions.** No deletion here removes more than 50 letters; the longest removes 35.
- **A VCF rarely shows "no copy".** Most VCFs list only the positions where a person differs
  from the reference. Inherit counts a VCF as covering a single-letter position only when the file
  writes a row there: a change, or a reference call that carries an rsID. So when the other adult's
  file is a VCF, Portrait most often says it cannot do the calculation, rather than that it found
  no second copy.
- **Only changes that meet the bar.** 3,306 of ClinVar's 3,692 GRCh38 records for ATP7B are left
  out (table above). A person can carry a disease-causing change that no row here holds. So no
  finding never means not a carrier, and no page says it does.
- **Two copies, and runs of matching letters.** A file that shows two copies gets no chance, and
  neither does a pair where a file's runs are above the limit or were never measured. Each card
  names its reason (above).
- **The per-pregnancy sentence is the brief's.** The health picture says "For each pregnancy, about
  25 in 100", as the brief requires. FDA's rule for consumer carrier tests (21 CFR 866.5940)
  requires a warning that the test says nothing about a newborn child's risk, and no wording can
  satisfy both. The owner left that conflict to US counsel on 27 September 2026.

## Owner sign-off

The owner ticks every box, then records the review through the activation. The activation's
reference is this file, `docs/carrier-condition-reviews/ATP7B.md`.

- [ ] I opened the ClinGen record above. It rates ATP7B and Wilson disease Definitive
      for autosomal recessive inheritance, dated 2019-03-27.
- [ ] The ACMG practice resource lists this condition in Table 1.
- [ ] The counts and the ten most-reported changes look right. I checked at least three of the
      ten on ClinVar through the links above.
- [ ] I accept the words above for a carrier finding and for no finding, including the
      laboratory, penetrance and attribution lines.
- [ ] I accept the known limits above for this condition.
- [ ] Severity to record (ADR 0034 asks for this judgement; for a recessive condition it gates
      nothing): `serious` or `not_serious`: ____________
- [ ] I activate Wilson disease (MONDO:0010200) at registry revision 1, from release
      `clinvar-2026-09`.

Reviewer: <OWNER NAME> · Role: <ROLE> · Date: ____________
