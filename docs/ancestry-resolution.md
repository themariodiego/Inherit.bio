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

## Reproducing

```
python3 scripts/ancestry-resolution/fetch-reference.py      # writes gnomad-pops.json
SEEDS=8 python3 scripts/ancestry-resolution/measure-accuracy.py
SEEDS=6 python3 scripts/ancestry-resolution/measure-leave-one-out.py
```

The fetched frequencies are not committed: they are reference data, and
reference data enters this repository through a licence audit, not through a
research script.
