# Region set provenance (`regions.json`, `label-denylist.json`)

Release `ancestry-regions-v1`, assembled 2026-09-03 for the shipped panel
`aims-kidd-seldin-168`, version `2026-08-28` (168 autosomal markers;
`data/ref/AIMS_PROVENANCE.md`). The geometry that draws these regions has its
own record, `public/geo/GEOMETRY_PROVENANCE.md`.

## What this is

Five regions, one per 1000 Genomes phase 3 superpopulation, at one tier
(`continental`). The estimator in `src/lib/genome/admixture.ts` attributes
every allele copy to one of the five superpopulations, so a region set for
this panel can have exactly five entries and nothing finer. Every name is a
place, never a people (brief §4.6); the label denylist beside this file
enforces that.

## Sources

| Source | Retrieved | Used for |
| --- | --- | --- |
| 1000 Genomes phase 3 sample panel, `integrated_call_samples_v3.20130502.ALL.panel` — https://ftp.1000genomes.ebi.ac.uk/vol1/ftp/release/20130502/integrated_call_samples_v3.20130502.ALL.panel — 55,156 bytes, SHA-256 `b4023dc6ee2d62ee89c8d4d347db4d348e65518d66d346574cdae7a4bbd76858`, 2,504 sample rows | 2026-09-03 | Every `n`: the number of rows per `pop` code. |
| Ensembl REST populations endpoint — https://rest.ensembl.org/info/variation/populations/homo_sapiens?filter=LD (JSON) | 2026-09-03 | The 26 `1000GENOMES:phase_3:*` descriptions, from which each `sampled_in` place is taken. Its `size` values equal the panel counts exactly. |
| The 1000 Genomes Project Consortium. A global reference for human genetic variation. *Nature* 526, 68–74 (2015). doi:10.1038/nature15393 | — | `citation_ids` on every region. |

Both files were retrieved by the implementation on the date shown, not copied
from the design note.

## Population → region

`Description` is Ensembl's text verbatim (including its spelling of Beijing).
`Sampled in` is the place that text names; it is what the page shows, and it
names no people. `Diaspora` marks a population sampled away from the region
its superpopulation is named for.

| Code | Description (Ensembl) | n | Superpop | Region code | Sampled in | Diaspora |
| --- | --- | --- | --- | --- | --- | --- |
| YRI | Yoruba in Ibadan, Nigeria | 108 | AFR | `africa-south-of-sahara` | Ibadan, Nigeria | no |
| ESN | Esan in Nigeria | 99 | AFR | `africa-south-of-sahara` | Nigeria | no |
| GWD | Gambian in Western Division, The Gambia | 113 | AFR | `africa-south-of-sahara` | Western Division, The Gambia | no |
| MSL | Mende in Sierra Leone | 85 | AFR | `africa-south-of-sahara` | Sierra Leone | no |
| LWK | Luhya in Webuye, Kenya | 99 | AFR | `africa-south-of-sahara` | Webuye, Kenya | no |
| ASW | African Ancestry in Southwest US | 61 | AFR | `africa-south-of-sahara` | the southwest United States | yes |
| ACB | African Caribbean in Barbados | 96 | AFR | `africa-south-of-sahara` | Barbados | yes |
| PUR | Puerto Rican in Puerto Rico | 104 | AMR | `central-america-caribbean-andes` | Puerto Rico | no |
| CLM | Colombian in Medellin, Colombia | 94 | AMR | `central-america-caribbean-andes` | Medellín, Colombia | no |
| PEL | Peruvian in Lima, Peru | 85 | AMR | `central-america-caribbean-andes` | Lima, Peru | no |
| MXL | Mexican Ancestry in Los Angeles, California | 64 | AMR | `central-america-caribbean-andes` | Los Angeles, California | yes |
| CHB | Han Chinese in Bejing, China | 103 | EAS | `east-and-southeast-asia` | Beijing, China | no |
| CHS | Southern Han Chinese, China | 105 | EAS | `east-and-southeast-asia` | southern China | no |
| CDX | Chinese Dai in Xishuangbanna, China | 93 | EAS | `east-and-southeast-asia` | Xishuangbanna, Yunnan, China | no |
| JPT | Japanese in Tokyo, Japan | 104 | EAS | `east-and-southeast-asia` | Tokyo, Japan | no |
| KHV | Kinh in Ho Chi Minh City, Vietnam | 99 | EAS | `east-and-southeast-asia` | Ho Chi Minh City, Vietnam | no |
| GBR | British in England and Scotland | 91 | EUR | `europe` | England and Scotland | no |
| FIN | Finnish in Finland | 99 | EUR | `europe` | Finland | no |
| IBS | Iberian populations in Spain | 107 | EUR | `europe` | Spain | no |
| TSI | Toscani in Italy | 107 | EUR | `europe` | Tuscany, Italy | no |
| CEU | Utah residents with Northern and Western European ancestry | 99 | EUR | `europe` | Utah, United States | yes |
| PJL | Punjabi in Lahore, Pakistan | 96 | SAS | `south-asia` | Lahore, Pakistan | no |
| BEB | Bengali in Bangladesh | 86 | SAS | `south-asia` | Bangladesh | no |
| GIH | Gujarati Indian in Houston, TX | 103 | SAS | `south-asia` | Houston, Texas | yes |
| ITU | Indian Telugu in the UK | 102 | SAS | `south-asia` | the United Kingdom | yes |
| STU | Sri Lankan Tamil in the UK | 102 | SAS | `south-asia` | the United Kingdom | yes |

Totals counted from the panel: AFR 661, AMR 347, EAS 504, EUR 503, SAS 489;
2,504 in all. `n_total` per region equals the sum of its rows.

## Mapping decisions

Each of the following is a decision made here, not a fact the sources state.

1. **Superpopulation → region is one-to-one.** The estimator returns one
   proportion per superpopulation and no finer split, so each region carries
   exactly the populations of its superpopulation, diaspora samples included.
   A diaspora population (ASW, ACB, MXL, CEU, GIH, ITU, STU) contributes to
   the frequencies of its superpopulation but was not sampled in the region
   the name points to; the `diaspora` flag lets the page say so.
2. **Names are places.** `Africa south of the Sahara`, `Europe`,
   `South Asia`, `East and Southeast Asia`, `Central America, the Caribbean
   and the Andes`. `Indian subcontinent` was rejected because `Indian` is a
   denylisted word; `South Asia` follows the brief's direction + landmass
   rule. `Latin America and the Caribbean` was rejected because it would
   shade the Mexican plateau, where no population was sampled.
3. **Africa south of the Sahara** is the AFRICA feature cut at the parallel
   17°N with Madagascar excluded. The parallel is a stated line through the
   Sahel: the continental samples lie between 0.6°N (Webuye) and 13.4°N (The
   Gambia) and the SAHARA feature's southern edge is at 9.3°N. It is not the
   desert's edge and not a border. Madagascar is excluded because no
   population was sampled there.
4. **Europe** is the whole EUROPE feature (British Isles and Scandinavia
   included, bounded east by Natural Earth's Urals/Caucasus line, a
   cartographic convention) with Iceland excluded (no sample). Samples cover
   only the north-west (GBR, CEU), north (FIN), south-west (IBS) and south
   (TSI); the whole feature is shaded because the panel cannot tell parts of
   Europe apart.
5. **South Asia** is the INDIA peninsula feature (covers Lahore at 74.3°E
   31.5°N and Bangladesh at 90°E) plus the land polygon whose centre falls
   near 80.7°E 7.9°N (Sri Lanka, outside the feature's 8.1°N floor). Sri
   Lanka is added because STU are Sri Lankan Tamil, sampled in the United
   Kingdom.
6. **East and Southeast Asia** is the ASIA feature inside the box 97°E–146°E
   × 8°N–46°N, minus the PLATEAU OF TIBET feature, plus the JAPAN feature.
   The box is a stated cut: 97°E excludes the plateau and the subcontinent,
   46°N excludes the Gobi and Siberia, 8°N keeps Ho Chi Minh City (10.8°N)
   and Xishuangbanna (22°N). A union of named features alone (NORTH CHINA
   PLAIN + INDOCHINA PENINSULA + JAPAN) was rejected because it leaves the
   CHS sampling area (southern China, about 26–28°N) unshaded. The
   Philippines and Borneo are not part of Natural Earth's ASIA continent
   feature and so are not shaded.
7. **Central America, the Caribbean and the Andes** is the union of the
   CENTRAL AMERICA isthmus, the WEST INDIES island group and the ANDES range,
   with no clipping. It shades only where populations were sampled (Puerto
   Rico in the West Indies; Medellín and Lima in the Andes). MXL were sampled
   in Los Angeles; the Mexican plateau is not shaded because no population
   was sampled there and no named natural feature covers it. AMR is an
   admixed reference group: "where DNA like yours is common today" is
   exactly the claim, and no claim about origin is made.
8. **Geometry tolerances.** The named features are drawn finer than the 110m
   land, so each selecting feature is simplified and dilated by 0.4° before
   the land is cut (the exact parameters and their effect are in
   `public/geo/GEOMETRY_PROVENANCE.md`). Interior edges of dilated features
   therefore sit up to 0.4° outside the named feature; the continental
   divisions and the plateau's edge are kept exact.
9. **Sort order** follows the estimator's superpopulation order (AFR, AMR,
   EAS, EUR, SAS → 0…4). It is a stable tie-break for display, not a rank.
10. **Label anchors** (`centroid_lon`, `centroid_lat`) are the centre of each
    region's projected bounding box, written by the geometry build; they
    place a label, they do not summarise where samples came from.

## `min_markers`

`min_markers` is 42 for every region: `Math.ceil(RELIABLE_FRACTION × AIMS.length)`
= ceil(0.25 × 168), with both constants imported from
`src/lib/genome/admixture.ts` by `src/lib/ancestry/panel.ts` and checked
against this file at load and in `src/lib/ancestry/regions.test.ts`. Below
it the estimate is noise and the map renders grey. The threshold applies to
the shipped panel only (X16.5); a new panel means a new release id, a new
value here, and a regenerated geometry file.

## The label denylist

`label-denylist.json` is a public list of forbidden label words —
nationalities, demonyms and ethnonyms the 1000 Genomes population names
would otherwise import, plus the continental demonyms the previous page
used. It contains no company or product name and is unrelated to the private
comparator list of ADR 0007. Matching is whole-word, case-insensitive, after
NFKD folding. It is enforced on region display names, every region path's
accessible name, the map caption, the two chips, the table headers and the
export label — not on the reference-population lines, which name sampling
places and counts. `Iberian` is deliberately absent so the brief's own
example, "Iberian Peninsula and southwest France", stays legal.
