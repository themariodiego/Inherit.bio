/** Synthetic parser fixtures, independent of any biological person.
 * Generate all168 AIM calls first, sort by chrom/pos, then omit rows where
 * dropEvery >0 and zeroBasedIndex%dropEvery===dropOffset. Add the extra call after
 * taking that subset, then sort again. Extra REF is invented parser data,
 * not a biological reference or functional-neutrality assertion. */
export const FIGURE_EXTRA_CALL = { chrom:20, pos:1000003, rsid:null, ref:"A", alt:"C", gt:"0/1" } as const;
export const REGIONAL_FIGURE_PAIRS = [
  {
    "id": "merged-shown",
    "merged": true,
    "shown": true,
    "a": {
      "name": "aims-figures-merged-shown-a-grch38.vcf",
      "seed": 1,
      "weights": {
        "AFR": 0.22,
        "AMR": 0.1,
        "CSA": 0.11,
        "EAS": 0.06,
        "EUR": 0.29,
        "MID": 0.21,
        "OCE": 0.01
      },
      "dropEvery": 0,
      "dropOffset": 1,
      "extraCall": false,
      "markers": 168,
      "called": 168
    },
    "b": {
      "name": "aims-figures-merged-shown-b-grch38.vcf",
      "seed": 2,
      "weights": {
        "AFR": 0.22,
        "AMR": 0.1,
        "CSA": 0.11,
        "EAS": 0.06,
        "EUR": 0.29,
        "MID": 0.21,
        "OCE": 0.01
      },
      "dropEvery": 0,
      "dropOffset": 1,
      "extraCall": true,
      "markers": 168,
      "called": 169
    }
  },
  {
    "id": "separate-shown",
    "merged": false,
    "shown": true,
    "a": {
      "name": "aims-figures-separate-shown-a-grch38.vcf",
      "seed": 1,
      "weights": {
        "AFR": 0.39,
        "AMR": 0.17,
        "CSA": 0.07,
        "EAS": 0.3,
        "EUR": 0.03,
        "MID": 0.03,
        "OCE": 0.01
      },
      "dropEvery": 0,
      "dropOffset": 1,
      "extraCall": false,
      "markers": 168,
      "called": 168
    },
    "b": {
      "name": "aims-figures-separate-shown-b-grch38.vcf",
      "seed": 3,
      "weights": {
        "AFR": 0.34,
        "AMR": 0.18,
        "CSA": 0.03,
        "EAS": 0.35,
        "EUR": 0.04,
        "MID": 0.05,
        "OCE": 0.01
      },
      "dropEvery": 0,
      "dropOffset": 1,
      "extraCall": true,
      "markers": 168,
      "called": 169
    }
  },
  {
    "id": "merged-partial",
    "merged": true,
    "shown": false,
    "a": {
      "name": "aims-figures-merged-partial-a-grch38.vcf",
      "seed": 2,
      "weights": {
        "AFR": 0.22,
        "AMR": 0.1,
        "CSA": 0.11,
        "EAS": 0.06,
        "EUR": 0.29,
        "MID": 0.21,
        "OCE": 0.01
      },
      "dropEvery": 8,
      "dropOffset": 1,
      "extraCall": false,
      "markers": 147,
      "called": 147
    },
    "b": {
      "name": "aims-figures-merged-partial-b-grch38.vcf",
      "seed": 6,
      "weights": {
        "AFR": 0.22,
        "AMR": 0.1,
        "CSA": 0.11,
        "EAS": 0.06,
        "EUR": 0.29,
        "MID": 0.21,
        "OCE": 0.01
      },
      "dropEvery": 4,
      "dropOffset": 1,
      "extraCall": true,
      "markers": 126,
      "called": 127
    }
  },
  {
    "id": "separate-partial",
    "merged": false,
    "shown": false,
    "a": {
      "name": "aims-figures-separate-partial-a-grch38.vcf",
      "seed": 1,
      "weights": {
        "AFR": 0.21,
        "AMR": 0.26,
        "CSA": 0.02,
        "EAS": 0.39,
        "EUR": 0.07,
        "MID": 0.04,
        "OCE": 0.01
      },
      "dropEvery": 8,
      "dropOffset": 1,
      "extraCall": false,
      "markers": 147,
      "called": 147
    },
    "b": {
      "name": "aims-figures-separate-partial-b-grch38.vcf",
      "seed": 2,
      "weights": {
        "AFR": 0.34,
        "AMR": 0.18,
        "CSA": 0.03,
        "EAS": 0.35,
        "EUR": 0.04,
        "MID": 0.05,
        "OCE": 0.01
      },
      "dropEvery": 4,
      "dropOffset": 1,
      "extraCall": true,
      "markers": 126,
      "called": 127
    }
  }
] as const;
