import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CarrierLibraryCoverage } from "./carrier-library-coverage";
import { CARRIER_LIBRARY_CONFIRMATION, CARRIER_LIBRARY_HELD, CARRIER_LIBRARY_SCOPE } from "@/copy/embryos/carrier-library";
import type { CarrierLibraryCoverageRow } from "@/lib/embryos/carrier-library-read";

const subjectId = "71000000-0000-4000-8000-000000000001";
const conditionNames = new Map([["SYNTHETIC:1", "Synthetic condition"]]);
function row(checkedPositions = 1): CarrierLibraryCoverageRow {
  return { embryoId: "71000000-0000-4000-8000-000000000002", conditionId: "SYNTHETIC:1", qualityReason: null,
    coverage: { version: "embryo-carrier-library-coverage-v1", basis: "distinct-grch38-reviewed-loci-v1",
      conditionId: "SYNTHETIC:1", conditionName: "Synthetic condition", referenceReleaseId: "synthetic-coverage",
      checkedPositions, requiredPositions: 2, coverageState: checkedPositions === 0 ? "not_covered" : checkedPositions === 2 ? "covered" : "partial",
      unresolved: checkedPositions === 2 ? [] : [{ reasons: ["not_covered"], positions: 2 - checkedPositions }],
      interpretationStatus: "held", holdReason: "scientific_disclosures_pending" } };
}
function render(rows: CarrierLibraryCoverageRow[]) {
  return renderToStaticMarkup(h(CarrierLibraryCoverage, { rows, subjectId, conditionNames }));
}
const text = (html: string) => html.replace(/<[^>]*>/g, "");
describe("held current reviewed-library coverage disclosure", () => {
  it("shows nothing when no current publication is admitted", () => { expect(render([])).toBe(""); });
  it.each([0, 1, 2])("shows exact %i of 2 positions without a clinical result", count => {
    const html = render([row(count)]), words = text(html);
    expect(words).toContain(`This is not a negative result. Your file was checked at ${count} of the 2 positions known for Synthetic condition.`);
    expect(words).toContain(CARRIER_LIBRARY_SCOPE);expect(words).toContain(CARRIER_LIBRARY_HELD);
    expect(words).toContain(CARRIER_LIBRARY_CONFIRMATION);
    expect(html).not.toMatch(/carrier-status|absolute|percentile|modelled|best embryo|no copy found|carrier_state/);
    expect(html).toContain(`data-carrier-library-state="${count === 0 ? "not-covered" : count === 1 ? "partial-coverage" : "covered"}"`);
  });
  it("attributes one exact observed file-coverage figure to the embryo's subject", () => {
    const html = render([row()]);
    expect(html.match(/data-subject-id=/g)).toHaveLength(1);expect(html).toContain(`data-subject-id="${subjectId}"`);
    expect(html.match(/data-figure-kind=/g)).toHaveLength(1);expect(html).toContain('data-figure-kind="coverage"');
    expect(html).toContain('data-figure-class="quality"');expect(html).toContain('data-figure-basis="observed"');
    expect(html).toContain('data-provenance="computed:embryos/carrier-library-coverage"');
  });
  it("names all unresolved causes without turning a dispute into absence", () => {
    const input = row(0);input.coverage!.unresolved = [{ reasons: ["not_covered", "source_call_disputed"], positions: 1 },
      { reasons: ["invalid_calls"], positions: 1 }];
    const words = text(render([input]));
    expect(words).toContain("Some reviewed positions were not read in this file.");
    expect(words).toContain("Some readings at reviewed positions disagree.");
    expect(words).toContain("Some readings at reviewed positions could not be used.");
  });
  it("withholds numeric scientific coverage when the actual file fails quality", () => {
    const input = row();input.coverage = null;input.qualityReason = "embryo_call_rate";
    const html = render([input]);expect(html).toContain('data-carrier-library-state="quality-not-measurable"');
    expect(text(html)).toContain("Too few calls could be read to check this library.");
    expect(html).not.toContain("data-figure-kind");expect(html).not.toContain("0 of");
  });
  it("refuses a widened or inconsistent native count rather than drawing it", () => {
    const input = row();input.coverage!.checkedPositions = 3;
    expect(() => render([input])).toThrow("invalid complete carrier position coverage");
  });
  it("escapes source labels instead of creating source-supplied markup", () => {
    const input = row();input.coverage!.conditionName = "<script>not markup</script>";
    const html = render([input]);expect(html).toContain("&lt;script&gt;");expect(html).not.toContain("<script>");
  });
});
