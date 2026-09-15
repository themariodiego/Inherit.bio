# Why the ancestry estimate has two rows, and what it would take to have more

Measured 2026-09-14, after the owner compared Inherit against another service
on the same file. That service resolved eleven genetic groups — Spanish,
Portuguese, Balkan, Southern Central American, Peruvian and Bolivian, Chilean,
Northern Central American, and sub-regions including Peru (Lima) and "Spain
(Andalusia and Murcia), France and Algeria". Inherit showed two: Central
America, the Caribbean and the Andes 73.7%, Europe 26.3%.

**Nothing here is a proposal.** It is what the measurements returned. The
design decision at the end is the one they point at, and it has not been made.

## Two ceilings, and the smaller one is the model's labels

1. **The estimator has five labels.** `src/lib/genome/admixture.ts` runs over
   the five 1000 Genomes *super*populations. Two of them land in a result like
   the owner's, which is why it has two rows.
   `data/ref/regions/regions.json` already carries the 26 *individual*
   populations — PEL is "Lima, Peru" and IBS is "Spain" in that file today —
   but only as the "sampled in" line on the map. The estimator never sees them.
2. **The panel is 168 markers.** A consumer array carries hundreds of
   thousands of positions; ancestry reads 168 of them.

## What is available, and under what terms

| set | populations | world regions | gap |
| --- | --- | --- | --- |
| 1000 Genomes phase 3 | 26 | 5 | **no Middle East, North Africa, Central Asia or Oceania at all** |
| gnomAD HGDP + 1kGP | 80 (4,094 genomes) | 7: AFR, AMR, CSA, EAS, EUR, **MID**, **OCE** | small samples in many populations |

1000 Genomes fails the owner's equal-granularity requirement on its face: it
would give a European five groups and a person of Moroccan or Lebanese
ancestry none. The other service's own output named Algeria, which 1000
Genomes cannot supply.

The gnomAD harmonised callset states "All data from this study are freely
available", and is built on projects chosen for "open data sharing policies
with consent to release unrestricted individual-level data" — no
non-commercial term, which is the trap `docs/dataset-licenses.md` exists to
catch (D-022). **No marker enters `data/ref/` on the strength of this
paragraph**; a licence-audit row comes first.

It is also reachable without a bulk download: gnomAD's public GraphQL API
returns the named populations per variant, with `ac` and `an` — the allele
count *and the number of people sampled*. Measured on one variant:

| region | populations returned | people per population |
| --- | --- | --- |
| Europe | 13 (Basque, Sardinian, French, Italian, Tuscan, Orcadian, Russian, Adygei, IBS, TSI, GBR, FIN, CEU) | 8–119 |
| Central / South Asia | 14 (Hazara, Uygur, Kalash, Balochi, Brahui, Makrani, Sindhi, Pathan, Burusho, PJL, GIH, BEB, ITU, STU) | 8–102 |
| Americas | 9 (Karitiana, Surui, Maya, Pima, Colombian, PEL, CLM, MXL, PUR) | 1–99 |
| Middle East / North Africa | 4 (Bedouin, Palestinian, Druze, Mozabite) | 26–46 |

73 populations appear at every one of the shipped panel's 168 markers. **22 of
them carry fewer than ten people**, and this measurement drops those, leaving
51. That floor is the equal-granularity question in its concrete form: every
population dropped is someone whose ancestry the result cannot name.

## How well the current panel does, at face value

`scripts/ancestry-resolution/measure-accuracy.py`. A simulated person drawn
from one population's frequencies, estimated over all 51.

| drawn from | named correctly, 168 markers | 672 markers |
| --- | --- | --- |
| hgdp:french | **100%** | 100% |
| hgdp:mozabite | **100%** | 100% |
| hgdp:bedouin | **100%** | 100% |
| 1kg:ibs | 62% | **100%** |

Against the 26 1000 Genomes populations the same measurement needed about a
thousand markers to reach 100% for the hardest cases (IBS 60% → 100%, CLM 53%
→ 100%, PJL 60% → 100% across 133 → 1,064). The gnomAD set does better at the
same marker count, most likely because HGDP sampled regionally-rooted
populations while 1000 Genomes sampled cosmopolitan ones, so its groups sit
further apart despite there being more of them.

**These rates are an upper bound and should not be quoted without that.** The
person is a draw from the reference frequencies themselves — the friendliest
test the method can be given.

## What happens to someone the reference set does not contain

`scripts/ancestry-resolution/measure-leave-one-out.py`, and this is the
finding that matters. Draw a person from a population, then remove that
population from the reference set — the situation almost every real person is
in, because no panel contains everyone.

| drawn from | three separate draws of the same person |
| --- | --- |
| Spain (IBS) | Basque 0.79 · Sardinian 0.27 + Basque 0.23 · CEU 0.51 + Tuscan 0.18 |
| French | Italian 0.43 · GBR 0.31 + CEU 0.28 · **Finnish 0.41 + Adygei 0.29** |
| Mozabite (Algeria) | Italian 0.37 + **Yoruba 0.32** · Italian + Druze · Mandenka 0.34 + Sardinian 0.33 |
| Bedouin | Balochi 0.32 · Druze 0.44 + Palestinian 0.43 · **Sardinian 0.48** |
| Peru (PEL) | Maya 0.70 + MXL · MXL 0.50 + Maya · Maya 0.80 |
| Han | **Japanese 0.81** · CHS 0.69 · CHB 0.60 + CHS |

The model does not degrade gracefully. It returns a **confident, specific and
unstable** answer: the same Spanish person is Basque, then Sardinian, then
CEU, depending only on the draw. A French person is 41% Finnish.

Peru and Han degrade sensibly — Maya and MXL, Japanese and CHS are the right
neighbourhood. **North Africa and the Middle East scatter across continents.**
So the harm does not fall evenly: it falls on the people the reference set
represents least, which is where the owner's constraint said to look.

## What the measurements point at

Not "more markers". The panel is less of a limit than it looked, and the
labels are already there. What is missing is a rule for when a specific
population name may be printed at all:

- A name only when its interval supports it; otherwise the region, and the
  reason. The intervals exist as of 2026-09-14 (`docs/ancestry-interval.md`)
  and the instability above is exactly what they measure — a person the set
  does not represent produces replicate estimates that move, which is a wide
  interval, not a confident label.
- The populations dropped by a sample-size floor are part of the product's
  honesty, not a filter to apply quietly.
- An equal-granularity check has to compare what a person in each region can
  be told, and fail when one region is systematically better served.

## Correction, 2026-09-14: the route proposed above reaches six regions, not seven

The table above says gnomAD's HGDP+1kGP set carries "80 (4,094 genomes)" over
"7: AFR, AMR, CSA, EAS, EUR, **MID**, **OCE**", and that sentence was used to
rule out 1000 Genomes on the equal-granularity requirement. It is true of the
**callset**. It is not true of the **public API** this document proposed
reaching it through, and the difference matters because OCE was half the
argument.

Measured over all 168 panel markers: the API returns **73** named populations,
47 from HGDP and 26 from 1kGP. **No Oceanian population appears at any marker** —
no Papuan, no Bougainville, no Melanesian — and neither do San, Mbuti or Biaka.
Not sparse: absent.

So the set actually reachable this way gives a person of Papuan ancestry
nothing at all, which is the same failure this document used to disqualify 1000
Genomes. Reaching OCE means the bulk callset from gnomAD's downloads page,
which is exactly the cost the API route was chosen to avoid.

## And the sample-size floor falls on almost the same people

Of the 73, **22 carry fewer than ten people** and were dropped by the floor the
earlier measurement used. Checked rather than assumed: for almost all of them
the median count across markers equals the minimum, so this is their size, not
one badly-covered marker.

| people | populations |
| --- | --- |
| 1 | Bantu South Africa, Surui |
| 2 | Karitiana |
| 4 | Colombian |
| 5 | Bantu Kenya, Pima |
| 6–7 | Uygur, Dai, Lahu, Naxi, Oroqen, Tujia, Tuscan |
| 8 | Cambodian, Daur, Hezhen, Mongola, She, Xibo, Yizu |
| 9 | Miaozu, Tu |

Read against the 51 that survive: a European has roughly twelve candidate
labels with 10 to 119 people behind each. Someone of Indigenous-American
ancestry has **one** (Maya, 20 people). Someone of Papuan ancestry has none at
any floor. The inequality is in the reference set, so no panel size and no
model fixes it.

*(The regional grouping of those names is the author's reading rather than a
sourced mapping: the paper names its seven regions — "AFR=African, AMR=admixed
American, CSA=Central/South Asian, EAS=East Asian, EUR=European, MID=Middle
Eastern, OCE=Oceanian" — but puts the per-population assignment in supplementary
tables. An equal-granularity gate needs that mapping from its source first.)*

## The naming rule does not work. Measured 2026-09-14, and this is the finding

The section above proposes: "A name only when its interval supports it;
otherwise the region, and the reason", and asserts that the instability it
measured "is exactly what they measure". **That assertion was wrong, and it was
worth testing before anything was built on it.** The instability in that table
is across simulated *people*; the interval resamples *markers* within one
person. A bootstrap over markers cannot see that the reference set is missing
the person's own population, because the misfit is in the set, not in the
sample.

`scripts/ancestry-resolution/measure-naming-rule.mts` draws a person from each
of eight populations spanning the regions that behaved differently, estimates
them twice — once with their own population in the reference set, once without —
and asks of three candidate signals whether either case can be told from the
other. 51 populations, 168 markers, 6 seeds, 100 resamples per estimate.

| candidate | best separation | at that threshold |
| --- | --- | --- |
| interval's low bound ≥ t | +0.29 at t = 0.60 | names **45.8%** of represented people correctly, and still names **16.7%** of unrepresented ones |
| log-likelihood per marker ≥ t | **negative almost everywhere** | the fit of an unrepresented person is indistinguishable from a represented one (medians −0.678 and −0.693) |
| label agreement ≥ t | +0.27 at t = 0.60 | names **62.5%** correctly, and still names **35.4%** of unrepresented ones |

**None of them separates the two cases.** And the reason is not that the signals
are weak; it is that confidence runs the wrong way in exactly the cases that
matter:

| person | reference set | answer | interval | resamples agreeing |
| --- | --- | --- | --- | --- |
| Peru (PEL) | **without Peru** | Maya 0.80 | 0.720–1.000 | **100 of 100** |
| French | **without France** | GBR 0.98 | 0.968–1.000 | 91 of 100 |
| Han | **without Han** | CHS 0.93 | 0.861–1.000 | 85 of 100 |
| Gujarati (GIH) | **with Gujarat** | GIH 0.32 | 0.000–0.638 | 26 of 100 |

A Peruvian whose population the model does not contain is called Maya, and
every single resample agrees. A Gujarati the model *does* contain is correctly
called Gujarati, and three quarters of the resamples disagree. There is no
threshold on any of these three measures that admits the fourth row and refuses
the first.

Worth recording alongside it: even when the population **is** in the reference
set the top name is right only **41 of 48 times**, and one target (Han) came
back *more* confident with its own population removed — share 0.633 → 0.831,
interval low 0.317 → 0.692.

### What this rules out, and what it leaves

It rules out the design this document proposed: a single specific population
name, gated on a confidence measure. The gate does not exist.

It does not rule out showing the **distribution** rather than deciding from it.
"In 100 resamples of your markers the closest match was Basque 43 times,
Sardinian 27, CEU 18" is honest by construction — it shows the noise and the
confidence together, which is what was asked for — and it never asserts a name
the measurement cannot support. Whether that is a product worth building, next
to a competitor that simply prints eleven confident labels, is a decision rather
than a measurement, and it needs the reference-set inequality above stated on
the surface beside it.

## The full callset, and the answer the measurements actually support

The operator's ruling was: get the bulk callset first, then re-measure. Done,
and it changes two of the three findings above.

**The callset is readable without downloading it.** Each chromosome's VCF is 50
to 270 GB, but the release ships a tabix index, so a marker costs one HTTP range
request over the ~16 kb of genome its smallest index bin covers.
`scripts/ancestry-resolution/fetch-callset-frequencies.py` implements the index
format directly — this container has no `tabix` or `bcftools` — and pulled all
168 panel markers at about a second each, with no misses and no multi-allelic
ambiguity. Every record carries all **78** populations.

**Oceania is there, and so is everyone else the API omitted.** The sourced
region mapping comes from the release's own sample metadata
(`hgdp_tgp_meta.genetic_region`), not from a reading of population names. At a
floor of ten people:

| region | populations kept | dropped |
| --- | --- | --- |
| AFR | 11 | 3 |
| AMR | 7 | 2 |
| CSA | 13 | 0 |
| EAS | 8 | **15** |
| EUR | 12 | 1 |
| MID | 4 | 0 |
| OCE | **2** | 0 |

Every region has at least two populations. The API route had none for Oceania at
any floor. The one severe loss is East Asia, where fifteen HGDP populations sit
at 6–10 people each. And the floor is load-bearing: at fifteen people Oceania
falls to zero, because Papuan is 17 samples and Melanesian 13.

**The naming gate still does not exist at 78 populations.** Best separation
improves from +0.29 to +0.33, and that is all: at the threshold where the
interval's low bound refuses two thirds of unrepresented people it also refuses
a third of the correct names, and the log-likelihood is still flat.

**But the region is right, and that is the finding.** Same 144 estimates, scored
on the region of the top population rather than its name:

| | population right | region right |
| --- | --- | --- |
| the person's population IS in the set | 59 of 72 (82%) | **71 of 72 (99%)** |
| the person's population is NOT in the set | 0 of 72 | **62 of 72 (86%)** |

And the ten region failures are not spread out. **Mozabite fails 6 of 6** —
an Algerian whose population is absent is called Sardinian, French or Finnish,
MID read as EUR. Bedouin fails 2 of 6. Every other target is 5 or 6 of 6,
including both Oceanian populations.

### What that supports, and it is not nothing

Today the estimator reports five 1000 Genomes superpopulations: AFR, AMR, EAS,
EUR, SAS. There is **no Middle East and no Oceania in it at all**, so a Bedouin
or Papuan reader is currently told a mixture of regions none of which is theirs.
The callset's seven regions include both.

So the honest upgrade the measurements support is a change of *reference set*,
not a change of resolution: seven regions instead of five, measured at 99%
when the person is represented and 86% when they are not, with the specific
limitation that this panel reads North African ancestry as European and must
say so. The sub-continental names can be shown as what they are — the closest
matches and how often each won across resamples — without being asserted.

**Read the two sections below before acting on that paragraph.** Both the 99%
and the 86% are argmax rates, and a later measurement shows the mixture behind
them carries wrong-region shares above 0.20 for 8 of 69 cohorts — including
people the reference set contains. North Africa is not the only boundary that
fails.

## How a region's frequency is built from its populations. Measured, 2026-09-14

The callset publishes counts per POPULATION. A region-level model needs one
frequency per region per marker, and the choice is not cosmetic: 1kGP cohorts
carry roughly 100 people each and HGDP populations roughly 20, so pooling lets
the 1kGP cohorts speak for their whole region — Europe pooled is mostly CEU,
IBS, TSI, FIN and GBR, with Basque, Sardinian, Orcadian and Adygei barely
audible. Three rules were measured over 168 markers, 7 regions, 78 populations,
20 simulated people each (1,560 fits per rule):

| rule | how | top region right | mean share on the right region |
| --- | --- | --- | --- |
| pooled | Σac / Σan — every sampled PERSON counts once | 1464/1560 (93.8%) | 0.843 |
| unweighted | mean of the population frequencies — every POPULATION counts once | 1480/1560 (94.9%) | 0.866 |
| **capped** | weight by sampled people, capped at 30 | **1485/1560 (95.2%)** | 0.864 |

The headline margin is thin, and per region they diverge much further than the
total suggests — Central and South Asia is 81% pooled against 90% unweighted,
while the admixed-American cohorts run the other way, 86% pooled against 79%.
The capped rule is not a compromise for its own sake: it keeps a 13-person
Melanesian sample audible without pretending it is measured as well as a
176-person CEU one, and it wins on the second measurement below, which matters
more than this one.

**These rates are the ceiling, not the expectation.** Every simulated person
here is drawn from a population the reference set contains, so the model is
being asked the easiest version of the question.

## The number the reader sees is not the number that was scored (D-122)

"Top region right" asks whether the largest share lands in the right place. No
reader is shown an argmax; they are shown a mixture, and the wrong entries in
it are large. The same simulation, reporting the whole vector under the capped
rule:

| cohort | own region | largest share on a region that is not its own |
| --- | --- | --- |
| Hazara | CSA 0.396 | **EAS 0.326** |
| Druze | MID 0.671 | **EUR 0.282** |
| Balochi | CSA 0.546 | EUR 0.237 |
| Makrani | CSA 0.561 | MID 0.233 |
| Sardinian | EUR 0.734 | **MID 0.228** |
| Brahui | CSA 0.621 | EUR 0.225 |
| Uygur | EAS 0.455 | CSA 0.215 |
| Mozabite | MID 0.677 | AFR 0.210 |
| Kalash | CSA 0.615 | MID 0.180 |
| Pathan | CSA 0.578 | EUR 0.178 |
| Adygei | EUR 0.627 | CSA 0.175 |
| Tuscan | EUR 0.811 | MID 0.160 |
| Palestinian | MID 0.742 | EUR 0.154 |

**16 of the 69 non-AMR cohorts put at least 0.10 on a region that is not their
own; 8 put at least 0.20.** The Europe/Middle East confusion runs in both
directions — a Sardinian is told 22.8% Middle East, a Druze 28.2% Europe — and
it is a stronger claim than D-120, which found the same boundary failing only
for people the set omits. This fails for people the set contains.

Northern and western Europe is clean by comparison: CEU 0.004 MID, FIN 0.000,
GBR 0.012, Russian 0.000, Basque 0.017, Orcadian 0.015. The confusion is
concentrated on the Mediterranean, the Levant, North Africa and the Iranian
plateau — which is to say, on precisely the readers the five-superpopulation
model already serves worst.

The admixed-American cohorts are excluded from that count on purpose. "Admixed
American" denotes admixture rather than a place, so a mixture answer is not
necessarily wrong for CLM or PUR, and the "top region right" metric is not a
fair question for them at all — PUR scoring 0% there is partly the metric's
fault. Their numbers are still the largest in the table (CLM 0.397 EUR against
0.379 its own; PUR 0.373 EUR against 0.209), and PUR's 0.246 on the Middle East
is the same Mediterranean/Levant confusion leaking through a third region.

This is also where the weighting choice is settled. Counting cohorts by how far
the worst wrong share reaches, excluding AMR:

| rule | ≥0.10 | ≥0.20 | ≥0.30 |
| --- | --- | --- | --- |
| pooled | 19 of 69 | 11 | 1 |
| unweighted | 16 of 69 | 8 | 2 |
| **capped** | **16 of 69** | **8** | **1** |

Capped is at least as good as unweighted everywhere and better at the tail, and
better than pooled throughout. It is the rule, on the evidence.

### Is it removable? Two candidate fixes, both measured, both dead

A limitation more markers or a better model would lift is a build task, not a
disclosure. Both were tried before anything was written down.

**Candidate 1: more markers.** Subsample the 168 and watch the confusion shrink
(`measure-marker-scaling.mts`), with each person's own population held out of
the reference set — the real-world case, and the one the numbers above do not
cover. Counting the 69 non-AMR cohorts by max-of-mean:

| markers | ≥0.10 | ≥0.20 | ≥0.30 | mean worst | Druze |
| --- | --- | --- | --- | --- | --- |
| 21 | 32 | 21 | 9 | 0.141 | 0.484 |
| 42 | 30 | 14 | 9 | 0.126 | 0.488 |
| 84 | 22 | 11 | 4 | 0.099 | 0.485 |
| 126 | 21 | 10 | 6 | 0.093 | 0.508 |
| 168 | 21 | 11 | 5 | 0.090 | 0.482 |

**Flat from 84 markers on.** Quadrupling 21 to 84 buys a great deal; doubling 84
to 168 buys 0.009 of mean worst share and nothing at all in the counts. Druze
does not move at any panel size: 0.48 at 21 markers and 0.48 at 168. Whatever
separates the Levant from southern Europe, these markers do not carry more of it
per marker. Two caveats travel with this: the 168 were *chosen* to be
ancestry-informative, so a random subsample of them is not the same thing as a
smaller panel someone would have designed; and each size is a single draw, so the
per-cohort columns are noisy — Sardinian reads 0.196, 0.444, 0.463, 0.404, 0.330
down the column, which is the draw talking, not the panel. The aggregate is the
trustworthy part, and the aggregate is flat.

**Candidate 2: fit fine, report coarse.** A seven-component mixture over region
*averages* cannot represent a population that sits inside a region but far from
its average — Europe's average is dominated by CEU, GBR, FIN, IBS and TSI, and a
Sardinian is genuinely distant from it — so the fit may be explaining a real
within-region distance by borrowing from a neighbour. Fitting all 78 populations
and adding each population's share into its own region should remove that. It
does, spectacularly, and the result is an artefact:

| model | ≥0.10 | ≥0.20 | ≥0.30 |
| --- | --- | --- | --- |
| region fit, own population present | 16 of 69 | 8 | 1 |
| **roll-up, own population present** | **10 of 69** | **2** | **0** |
| region fit, own population held out | 20 of 69 | 11 | 2 |
| **roll-up, own population held out** | 20 of 69 | **14** | **5** |

With the person's own population in the table the roll-up looks like a free win:
Sardinian's Middle East share falls from 0.228 to below 0.083 and its own region
rises to 0.898, Tuscan's from 0.160 to 0.020. **Held out, it is worse than the
model it was meant to replace** — 14 cohorts above 0.20 against 11, and 5 above
0.30 against 2. A Druze without Druze in the set becomes 0.525 Europe against
0.297 Middle East.

The mechanism is plain once seen. Removing one population barely moves a
regional average, so the region fit degrades gently. Removing it from a
78-component table deletes the only component that could have represented that
person, so the fit reaches for neighbours — and neighbours cross region borders.
The roll-up's advantage *was* the person's own population, which is exactly the
thing a real reader does not have.

This is worth naming as a method point, not just a result: **a model evaluated
only on people its reference set contains will prefer whichever variant
memorises them best.** The held-out measurement was not a refinement of the
first one. It reversed it.

So the capped region fit stands, D-122 stands, and neither of the cheap fixes is
available.

### What this forbids

Printing "Middle East 22.9%" to a Sardinian reader is an invented magnitude.
The project's own rule — no imputation, no invented numbers, keep limitations
visible — does not have an exception for numbers a model produced confidently.
So a region surface built on this panel ships only with one of:

1. **a disclosure carrying these figures**, at the point of reading rather than
   in a footnote — naming which regions this panel cannot separate and by how
   much, for the specific regions in that reader's own result;
2. **merged regions**, reporting the boundaries the panel can actually hold
   rather than seven it cannot — measured below, because it is not free and
   the obvious merge is not the right one; or
3. **merging per reader** rather than per product, which the measurements below
   say buys the whole of option 2's honesty at roughly a fifth of its cost, and
   is the one this document ends up pointing at.

None is chosen here. Both are honest; option 2 is a smaller claim and option
1 is the owner's stated preference — "give what the data supports, disclose the
gap loudly" — and the two are compatible if the merge is offered as the default
with the finer split available behind the disclosure. **The decision is the
owner's and has not been made.**

### What a merge actually buys, and the one that backfires

Option 2 was a hand-wave until it was measured. Held out, over the non-AMR
cohorts, counting by the largest wrong-GROUP share:

| grouping | groups | ≥0.10 | ≥0.20 | ≥0.30 | mean worst | worst cohort |
| --- | --- | --- | --- | --- | --- | --- |
| seven regions, as measured | 7 | 20 | 11 | 2 | 0.084 | Druze → EUR 0.457 |
| EUR+MID | 6 | 14 | **10** | **7** | 0.077 | Balochi → EUR+MID 0.402 |
| **EUR+MID+CSA** | 5 | **9** | **5** | 2 | **0.055** | Uygur → EUR+MID+CSA 0.437 |
| EAS+OCE | 6 | 21 | 13 | 3 | 0.087 | Druze → EUR 0.456 |
| EUR+MID, EAS+OCE | 5 | 16 | 11 | 8 | 0.080 | Balochi → EUR+MID 0.381 |
| EUR+MID+CSA, EAS+OCE | 4 | 13 | 7 | 3 | 0.060 | Uygur → EUR+MID+CSA 0.438 |

**Merging Europe with the Middle East — the obvious move, the one D-122 points
straight at — makes the tail worse.** Cohorts above 0.30 go from 2 to 7. The
reason is visible in the worst-cohort column: Balochi, Brahui, Pathan, Makrani
and Kalash were previously splitting their error between EUR and MID, and
merging the two collects it into one bucket. A merge does not only hide a
confusion, it also **concentrates errors that were previously spread**, and
whether that helps depends on who was confused with whom.

Merging Europe, the Middle East and Central/South Asia together does work:
9 cohorts above 0.10 against 20, 5 above 0.20 against 11, mean worst share
0.055 against 0.084. Its remaining worst case is Uygur at 0.437, and Uygur is a
population with genuinely mixed eastern and western Eurasian ancestry, so some
of that is signal rather than confusion — this simulation cannot tell the two
apart, and should not be read as though it could.

But look at the cost column. Five groups — AFR, AMR, EAS, OCE and one western
Eurasian bucket — is not a smaller version of seven, it is a **different trade
against the five the estimator ships today** (AFR, AMR, EAS, EUR, SAS). It
gains Oceania and an honest Middle East, and it loses the Europe/South Asia
split that a great many readers currently get. That is a product decision, not
a measurement, and it is not made here.

Merging Oceania into East Asia is not worth discussing: it removes nothing
(21/13/3) and costs a whole region.

### Merging per reader instead of per product

Both options above are global: either everyone sees seven regions with a
disclosure, or everyone loses the Europe/South Asia split. But the confusion is
not evenly distributed — a Finnish result is clean and a Sardinian one is not —
so the choice does not have to be made once for everybody.

The adaptive rule fits the seven regions as usual, then asks, **of this
reader's own result**, whether two or more of the regions this panel is known to
confuse carry a non-trivial share. If they do, those regions are reported as one
combined row for this reader only. A clean result never triggers it.

Measured held out, by mean-of-max — the stricter statistic, the average over
people of that person's largest wrong reported row, where a reported row counts
as right if it contains their own region:

| trigger threshold | ≥0.10 | ≥0.20 | ≥0.30 | mean worst | readers merged | mean rows |
| --- | --- | --- | --- | --- | --- | --- |
| never (seven regions today) | 27 | 14 | 11 | 0.115 | 0% | 2.3 |
| 0.30 | 24 | 8 | 3 | 0.091 | 7% | 2.2 |
| 0.20 | 16 | 4 | 2 | 0.074 | 14% | 2.2 |
| 0.15 | 11 | 4 | 2 | 0.068 | 18% | 2.1 |
| **0.10** | **10** | **4** | **2** | **0.063** | **21%** | **2.1** |
| always (global EUR+MID+CSA merge) | 10 | 4 | 2 | 0.061 | 100% | 1.9 |

**At a 0.10 trigger the adaptive rule matches the global merge** — 10/4/2 against
10/4/2, mean worst 0.063 against 0.061 — **while merging for 21% of readers
instead of all of them.** The other 79% keep the full seven regions. Cohorts with
a wrong row above 0.10 fall from 27 to 10, and above 0.30 from 11 to 2.

This is not free and the cost should be stated plainly: **the rule cannot tell
genuine two-region ancestry from confusion, and merges both.** A reader with
real European and South Asian parentage triggers it and is shown one combined
figure where two would have been true. The panel cannot distinguish those cases,
so the rule declines to guess — which is the correct behaviour under "no
invented numbers", but it is a loss, not a free lunch, and the people it costs
are disproportionately the people of mixed ancestry.

The remaining worst case at 0.10 is Uygur reaching 0.417 on Central/South Asia,
outside the confusable set. Uygur has genuinely mixed eastern and western
Eurasian ancestry, so part of that is signal; this simulation cannot separate
signal from confusion and must not be read as though it could.

What is settled is that waiting does not help. The two obvious routes out — a
bigger panel and a finer model — were measured rather than assumed, and neither
is one. Whatever ships, ships with this limitation in it.

## Reproducing

```
python3 scripts/ancestry-resolution/fetch-reference.py      # writes gnomad-pops.json
SEEDS=8 python3 scripts/ancestry-resolution/measure-accuracy.py
SEEDS=6 python3 scripts/ancestry-resolution/measure-leave-one-out.py
python3 scripts/ancestry-resolution/fetch-callset-frequencies.py  # the full callset, through its tabix index
SOURCE=api node --import tsx scripts/ancestry-resolution/measure-naming-rule.mts
node --import tsx scripts/ancestry-resolution/measure-naming-rule.mts   # SOURCE=callset is the default
node --import tsx scripts/ancestry-resolution/measure-region-weighting.mts
node --import tsx scripts/ancestry-resolution/measure-region-confusion.mts  # RULE=..., MODEL=region|rollup, HOLD_OUT=1
node --import tsx scripts/ancestry-resolution/measure-marker-scaling.mts
node --import tsx scripts/ancestry-resolution/measure-region-merges.mts  # MERGES="EUR+MID,EAS+OCE"
node --import tsx scripts/ancestry-resolution/measure-adaptive-merge.mts  # CONFUSABLE="EUR,MID,CSA"
```

The naming-rule run takes about 45 minutes and writes its rows to
`naming-rule-rows.jsonl` as it goes, so a killed run keeps what it measured. It
uses 100 resamples rather than the shipped estimator's 200 and says so in its
own header: it asks whether two distributions separate, not what one person's
published interval is. Any threshold it suggested would have to be re-measured
at 200 before becoming a rule — none did.

`measure-region-confusion.mts` caps the EM at 2000 iterations. The figures first
published from it used 1000; every number moved by at most 0.003 and no count
changed, and the tables here are the 2000-iteration run.

The fetched frequencies are not committed: they are reference data, and
reference data enters this repository through a licence audit, not through a
research script.


## 15 September 2026 — Accepted rule and versioned production fit

The earlier adaptive experiment used `>= 0.10` and combined only the components
meeting that trigger. The owner-selected rule uses unrounded shares strictly
`> 0.10`; when two of EUR/MID/CSA qualify, all three are combined. The disclosure
shows uncertain components and repeats the mixed-ancestry limitation. Earlier
references to “21% of readers” describe an equally sampled synthetic reference
simulation, not prevalence among actual readers.

The fresh comparison imports the production fitter from
`src/lib/genome/regional-admixture.ts`; its bound is 50,000 iterations with early
stopping. The old 2,000-step experiment above remains historical. The committed
`accepted-adaptive-measurement.json` records paired 42/84/126/168-marker hold-out,
a separately labelled population-present ceiling and iteration sensitivity.
See `data/ref/AIMS_SEVEN_REGION_PROVENANCE.md` for the final table, exact
denominators, subgroup limits and reproduction commands. The accepted rule
and earlier hot-only rule merge the same 329 of 1,560 full-panel held-out draws,
but 265 displayed results differ. Neither measurement calibrates component
confidence ranges or establishes specific population identities.

The full 168-marker normal-display requirement is a conservative release policy,
not a measured reliability cutoff. Partial raw estimates remain available under
a warning. The adaptive rule cannot tell real mixed ancestry from reference
confusion and combines both; people with mixed ancestry lose separate region
detail more often. D-122's scientific limitation survives this reporting change.
