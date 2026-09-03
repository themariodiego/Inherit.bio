import { describe, expect, it } from "vitest";
import { jargonMatches, nakedRelativeFindings, titleFindings } from "./template-prose";

describe("nakedRelativeFindings", () => {
  it("flags a %, x, × or -fold token near a comparison word", () => {
    expect(nakedRelativeFindings("roughly 1.4x the odds of prostate cancer, higher than GG").map((f) => f.rule)).toEqual(["naked-relative", "worded-ratio"]);
    expect(nakedRelativeFindings("about 20-30% higher odds of coronary artery disease").map((f) => f.rule)).toEqual(["naked-relative"]);
    expect(nakedRelativeFindings("a 1.7-fold increase in odds").map((f) => f.rule)).toEqual(["naked-relative", "worded-ratio"]);
    expect(nakedRelativeFindings("2× more likely to report the taste").map((f) => f.rule)).toEqual(["naked-relative", "worded-ratio"]);
  });

  it("flags a numeral before times as a worded ratio", () => {
    expect(nakedRelativeFindings("linked to about 1.4 times the odds of type 2 diabetes").map((f) => f.rule)).toEqual(["worded-ratio"]);
    expect(nakedRelativeFindings("about 5 to 7 times the usual risk of a vein clot").map((f) => f.rule)).toEqual(["worded-ratio"]);
    expect(nakedRelativeFindings("roughly 1.2-1.3x the odds of prostate cancer compared with TT").map((f) => f.rule)).toEqual(["worded-ratio"]);
  });

  it("ignores tokens with no comparison word nearby and identifiers", () => {
    expect(nakedRelativeFindings("carried by roughly 15% of people of European ancestry")).toEqual([]);
    expect(nakedRelativeFindings("the X chromosome and the x-linked pattern are lower on the list")).toEqual([]);
    expect(nakedRelativeFindings("the odds were higher in that study, and this result is carried by about 15% of people")).toEqual([]);
    expect(nakedRelativeFindings("Studies link this result to higher odds on average.")).toEqual([]);
  });
});

describe("titleFindings", () => {
  const jargon = ["cancer", "gene", "genes", "disease", "allele"];

  it("accepts a plain title of at most twelve words with identifiers", () => {
    expect(titleFindings("Iron overload and your HFE C282Y result", jargon)).toEqual([]);
    expect(titleFindings("Breast tumours and FGFR2 rs2981582", jargon)).toEqual([]);
    expect(titleFindings("Type 1 diabetes and your HLA tags", jargon)).toEqual([]);
    expect(titleFindings("TP53 codon 72 (Pro72Arg)", jargon)).toEqual([]);
    expect(titleFindings("Omega-3 and omega-6 conversion", jargon)).toEqual([]);
  });

  it("rejects jargon, bare figures and long titles", () => {
    expect(titleFindings("Breast cancer · FGFR2", jargon).map((f) => f.rule)).toEqual(["title-jargon"]);
    expect(titleFindings("Alzheimer's disease · APOE", jargon)[0].detail).toContain("disease");
    expect(titleFindings("A 2x higher chance of hair loss", jargon).map((f) => f.rule)).toEqual(["title-figure"]);
    expect(titleFindings("About 1.5 times the usual chance", jargon).map((f) => f.rule)).toEqual(["title-figure"]);
    expect(titleFindings("Found in 15% of people", jargon).map((f) => f.rule)).toEqual(["title-figure"]);
    expect(titleFindings("Two copies means 3 in 100", jargon).map((f) => f.rule)).toEqual(["title-figure"]);
    expect(titleFindings("one two three four five six seven eight nine ten eleven twelve thirteen", jargon).map((f) => f.rule)).toEqual(["title-words"]);
  });

  it("matches jargon on word boundaries only", () => {
    expect(jargonMatches("Cancer-free", ["cancer"])).toEqual(["cancer"]);
    expect(jargonMatches("Genesis of a habit", ["gene", "genes"])).toEqual([]);
  });
});
