// Vitest runs in the node environment (vitest.config.ts); the component is
// rendered with renderToStaticMarkup and the HTML inspected as text, exactly as
// src/components/results/ancestry/ancestry.test.ts does for the lineage cards.
//
// What these tests pin is G4.4's base requirement on the polygenic surface: the
// panel and its version, an interval or an explicit statement that none is
// available, and the resolution limit in plain words. The two polygenic extras
// the gate adds — the coverage fraction and the ancestry-portability statement
// — were already shipped and are asserted here only as the structure the three
// new sentences sit in.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NO_RANGE_YET, RESOLUTION_LIMIT, panelVersionLine } from "@/copy/genome/polygenic";
import { NO_RANGE_YET as REPORTS_NO_RANGE_YET } from "@/copy/reports/strings";
import { scorePanel } from "@/lib/genome/prs-panel";
import { ScorePanelResult } from "./score-panel-result";

interface Tag {
  tag: string;
  attrs: Record<string, string>;
}

function openingTags(html: string): Tag[] {
  return [...html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*\/?>/g)].map((match) => ({
    tag: match[1],
    attrs: Object.fromEntries(
      [...match[2].matchAll(/([^\s=]+)(?:="([^"]*)")?/g)].map((attr) => [attr[1], attr[2] ?? ""]),
    ),
  }));
}

function text(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

const SUBJECT = "subject-1";
/** A stored `prs_scores` row, in the shape the page selects it. */
const ROW = {
  pgs_id: "PGS000011",
  name: "GRS50",
  trait: "Coronary artery disease",
  n_variants: 50,
  ancestry_note:
    "Source GWAS ancestry (PGS Catalog): 53.3% multi-ancestry (including European), 40.3% European.",
};

function render(row: { pgs_id: string; name: string; version?: string | null } = ROW): string {
  return renderToStaticMarkup(
    h(ScorePanelResult, {
      subjectId: SUBJECT,
      panel: scorePanel(row),
      trait: ROW.trait,
      ancestryNote: ROW.ancestry_note,
      read: 44,
      needed: ROW.n_variants,
    }),
  );
}

/** The text of the G4.4 provenance block, or "" when the surface renders none. */
function provenance(html: string): string {
  const chunk = html.split('data-slot="score-panel-provenance"')[1];
  // Re-open the tag the split cut in half, so `text` strips the div's own
  // attributes (`mt-2`, `space-y-1`) instead of counting them as copy.
  return chunk === undefined ? "" : text(`<div ${chunk.split("</div>")[0] ?? ""}`);
}

describe("ScorePanelResult, G4.4 base requirements", () => {
  const html = render();

  it("names the panel and states that no version is recorded, inventing none", () => {
    expect(provenance(html)).toContain(panelVersionLine(scorePanel(ROW)));
    expect(panelVersionLine(scorePanel(ROW))).toBe(
      "Read against the GRS50 panel, PGS000011. No version is recorded for this panel, and Inherit will not guess one.",
    );
    // Nothing in the block may read as a version that was never recorded: no
    // date, no `v1`, no dotted build number, and — once the score's own
    // recorded name and catalogue id are removed — no digit at all.
    const stated = provenance(html);
    expect(stated).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(stated).not.toMatch(/\bv\d/i);
    expect(stated).not.toMatch(/\d+\.\d+/);
    expect(stated.split(ROW.pgs_id).join("").split(ROW.name).join("")).not.toMatch(/\d/);
  });

  it("renders a recorded version when a record ever carries one", () => {
    const versioned = render({ ...ROW, version: "Build 17" });
    expect(provenance(versioned)).toContain("Read against the GRS50 panel, PGS000011, version Build 17.");
    expect(provenance(versioned)).not.toContain("No version is recorded");
  });

  it("states that no interval is available, in the sentence the report surface already ships", () => {
    expect(provenance(html)).toContain(NO_RANGE_YET);
    expect(NO_RANGE_YET).toBe(REPORTS_NO_RANGE_YET);
    expect(NO_RANGE_YET).toBe("We can’t put a range on this yet, so we don’t show a single number.");
  });

  it("gives the panel's resolution limit in plain words", () => {
    expect(provenance(html)).toContain(RESOLUTION_LIMIT);
    expect(RESOLUTION_LIMIT).toContain("one fixed list of positions");
    expect(RESOLUTION_LIMIT).toContain("not a result for any single position");
    expect(RESOLUTION_LIMIT).toContain("cannot see changes it does not test");
  });

  it("keeps all three inside the one attributed claim block, beside the coverage figure", () => {
    const blocks = openingTags(html).filter((tag) => "data-claim-block" in tag.attrs);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs["data-subject-id"]).toBe(SUBJECT);
    // The block is the component's own root, so on the page it stays the list
    // item's direct child (the contract e2e/genome-data.spec.ts asserts).
    expect(html.startsWith("<section")).toBe(true);
    expect(html.indexOf("data-claim-block")).toBeLessThan(html.indexOf("score-panel-provenance"));
    const coverage = openingTags(html).filter((tag) => tag.attrs["data-figure-kind"] === "coverage");
    expect(coverage).toHaveLength(1);
    expect(coverage[0].attrs["data-figure-basis"]).toBe("observed");
    expect(coverage[0].attrs["data-provenance"]).toBe("computed:genome/prs");
    expect(html).toContain(ROW.ancestry_note);
  });

  it("adds no percent text outside the seeded portability note and no score number", () => {
    const outsideNote = html
      .split('data-slot="ancestry-note"')
      .map((chunk, index) => (index === 0 ? chunk : chunk.slice(chunk.indexOf("</p>"))))
      .join("");
    expect(text(outsideNote)).not.toMatch(/\d\s?%/);
    expect(openingTags(html).filter((tag) => tag.attrs["data-figure-kind"] === "percentile")).toHaveLength(0);
    expect(openingTags(html).filter((tag) => tag.attrs["data-figure-kind"] === "absolute")).toHaveLength(0);
  });
});
