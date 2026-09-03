// Vitest runs in the node environment (vitest.config.ts); components are
// rendered with renderToStaticMarkup and the HTML is inspected as text, as
// src/components/figures/figures.test.ts does. AncestryRegions is a client
// component that renders <ClaimBlock> and <Figure>: rendering it here fails
// loudly if a server-only import ever lands in the figures package.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CHIP_LABELS,
  DENISOVAN,
  IDENTITY,
  MARKER_GLOSS,
  NEANDERTHAL_HEADING,
  NOISE,
  NOTHING_READ,
  NO_Y_LEAD,
  RANGE_UNAVAILABLE,
  RAW_NUMBERS_SUMMARY,
  TOGGLE_LABEL,
  XX_GLOSS,
  greyState,
  lineageSentence,
  markersLine,
  panelLine,
} from "@/copy/ancestry";
import { mapShapes } from "@/lib/ancestry/geometry";
import { MIN_MARKERS, PANEL } from "@/lib/ancestry/panel";
import { OPACITY_FLOOR, presentShares } from "@/lib/ancestry/present";
import { tierQualifies } from "@/lib/ancestry/regions";
import { regionsView } from "@/lib/ancestry/view";
import { ANCESTRY_RANGE_UNAVAILABLE, MODELLED_MARKER } from "@/lib/figures/contract";
import type { Pop } from "@/lib/genome/admixture";
import { AncestryRegions, type AncestryResultView } from "./ancestry-regions";
import { LineageCard } from "./lineage-card";
import { NeanderthalCard } from "./neanderthal-card";

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
const PANEL_FACTS = { markers: PANEL.markers, version: PANEL.version };
const SUPPORT_NOTE = "Low confidence: proportions are unreliable.";

function result(proportions: Record<Pop, number>, markersUsed: number): AncestryResultView {
  return {
    markersUsed,
    supportNote: SUPPORT_NOTE,
    shown: tierQualifies("continental", markersUsed),
    view: regionsView(presentShares({ proportions })),
  };
}

function render(view: AncestryResultView | null, initialWellSupportedOnly?: boolean): string {
  return renderToStaticMarkup(
    h(AncestryRegions, {
      subjectId: SUBJECT,
      shapes: mapShapes(),
      panel: PANEL_FACTS,
      minMarkers: MIN_MARKERS,
      result: view,
      initialWellSupportedOnly,
    }),
  );
}

/** Every `ancestry-share` figure node, each with its unit text. */
function shareFigures(html: string): { value: string; unit: string }[] {
  return html.split('data-figure-kind="ancestry-share"').slice(1).map((chunk) => {
    const value = /data-slot="figure-value"[^>]*>([^<]*)</.exec(chunk)?.[1] ?? "";
    const unit = /data-slot="figure-unit"[^>]*>([^<]*)</.exec(chunk)?.[1] ?? "";
    const nextFigure = chunk.indexOf('data-slot="figure"');
    const unitAt = chunk.indexOf('data-slot="figure-unit"');
    expect(unitAt, "an ancestry share without its unit").toBeGreaterThan(-1);
    if (nextFigure !== -1) expect(unitAt).toBeLessThan(nextFigure);
    return { value, unit };
  });
}

function regionPaths(html: string): Tag[] {
  return openingTags(html).filter((tag) => tag.tag === "path" && "data-region" in tag.attrs);
}

function focusablePaths(html: string): Tag[] {
  return regionPaths(html).filter((tag) => tag.attrs.tabindex === "0");
}

function chipValues(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const chunk of html.split('data-slot="ancestry-chip"').slice(1)) {
    const chip = /^[^>]*data-chip="([^"]+)"/.exec(chunk)?.[1] ?? "";
    out[chip] = /data-slot="figure-value"[^>]*>([^<]*)</.exec(chunk)?.[1] ?? "";
  }
  return out;
}

function percent(value: string): number {
  expect(value).toMatch(/^\d+\.\d%$/);
  return Number(value.slice(0, -1));
}

const FIVE_SHOWN: Record<Pop, number> = { AFR: 0.3, AMR: 0.05, EAS: 0.1, EUR: 0.5, SAS: 0.05 };
const TWO_HIDDEN: Record<Pop, number> = { AFR: 0.3, AMR: 0, EAS: 0.019, EUR: 0.662, SAS: 0.019 };

describe("AncestryRegions, shown state", () => {
  const html = render(result(FIVE_SHOWN, PANEL.markers));

  it("renders exactly one attributed claim block and the modelled marker once", () => {
    const blocks = openingTags(html).filter((tag) => "data-claim-block" in tag.attrs);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].attrs["data-subject-id"]).toBe(SUBJECT);
    expect(html.split(MODELLED_MARKER).length - 1).toBe(1);
  });

  it("gives every ancestry share a one-decimal value and the unit `no range yet`", () => {
    const figures = shareFigures(html);
    // Five rows, two chips; no panel is open in static markup.
    expect(figures).toHaveLength(7);
    for (const figure of figures) {
      expect(figure.value).toMatch(/^\d+\.\d%$/);
      expect(figure.unit).toBe(ANCESTRY_RANGE_UNAVAILABLE);
    }
    const coverage = openingTags(html).filter((tag) => tag.attrs["data-figure-kind"] === "coverage");
    expect(coverage).toHaveLength(1);
    expect(coverage[0].attrs["data-figure-basis"]).toBe("observed");
  });

  it("renders five focusable region paths in descending share order with the gradient contract", () => {
    const paths = focusablePaths(html);
    expect(paths).toHaveLength(5);
    const lowerBounds = paths.map((path) => Number(path.attrs["data-lower-bound"]));
    expect([...lowerBounds].sort((a, b) => b - a)).toEqual(lowerBounds);
    for (const path of paths) {
      expect(path.attrs.role).toBe("button");
      expect(path.attrs["aria-label"]).toMatch(/^.+: \d+% \(no range yet\)$/);
      expect(Number(path.attrs["data-fill-opacity"])).toBeGreaterThanOrEqual(OPACITY_FLOOR);
      const id = /^url\(#(.+)\)$/.exec(path.attrs.fill)?.[1];
      expect(id).toBeDefined();
      const gradient = html.split(`<radialGradient id="${id}"`)[1]?.split("</radialGradient>")[0] ?? "";
      const stops = openingTags(gradient).filter((tag) => tag.tag === "stop");
      expect(stops.length).toBeGreaterThanOrEqual(3);
      expect(stops[stops.length - 1].attrs["stop-opacity"]).toBe("0");
      expect(stops[stops.length - 1].attrs.offset).toBe("100%");
      // The feather starts at 70% of the radius: the outer 30% of r = 15% of the bbox width.
      expect(stops[stops.length - 2].attrs.offset).toBe("70%");
      expect(gradient).toContain('gradientUnits="objectBoundingBox"');
    }
    const svg = openingTags(html).find((tag) => tag.tag === "svg");
    expect(svg?.attrs["data-density-pixel-exclusion"]).toBe("map-tile");
    expect(svg?.attrs["data-mode"]).toBe("shown");
  });

  it("renders the toggle on by default, both chips, and the G4.4 sentences once", () => {
    const toggle = openingTags(html).find((tag) => tag.attrs["data-slot"] === "well-supported-toggle");
    expect(toggle?.tag).toBe("button");
    expect(toggle?.attrs.role).toBe("switch");
    expect(toggle?.attrs["aria-checked"]).toBe("true");
    expect(html).toContain(TOGGLE_LABEL);
    expect(html).toContain(CHIP_LABELS.unassignable);
    expect(html).toContain(CHIP_LABELS.hidden);
    for (const sentence of [
      RANGE_UNAVAILABLE,
      panelLine(PANEL_FACTS),
      markersLine(PANEL.markers, PANEL_FACTS, MIN_MARKERS),
      MARKER_GLOSS,
      IDENTITY,
    ]) {
      expect(html.split(sentence).length - 1, sentence).toBe(1);
    }
    expect(html).not.toContain(SUPPORT_NOTE);
    expect(html).not.toContain("<details");
  });

  it("lists every region in a table with an sr-only caption, none hidden when all are well supported", () => {
    const rows = openingTags(html).filter((tag) => tag.attrs["data-slot"] === "region-row");
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => !("hidden" in row.attrs))).toBe(true);
    expect(html).toContain('<caption class="sr-only">');
    expect(openingTags(html).filter((tag) => tag.tag === "ul")).toHaveLength(0);
  });
});

describe("AncestryRegions, the toggle", () => {
  const on = render(result(TWO_HIDDEN, PANEL.markers), true);
  const off = render(result(TWO_HIDDEN, PANEL.markers), false);

  it("hides rows and paths below the threshold when on, and shows a hairline for a share of 0 when off", () => {
    // Three rows sit below 0.02: the two at 0.019 and the one at exactly 0.
    const hiddenOn = openingTags(on).filter((tag) => tag.attrs["data-slot"] === "region-row" && "hidden" in tag.attrs);
    expect(hiddenOn).toHaveLength(3);
    expect(focusablePaths(on)).toHaveLength(2);
    const hiddenOff = openingTags(off).filter((tag) => tag.attrs["data-slot"] === "region-row" && "hidden" in tag.attrs);
    expect(hiddenOff).toHaveLength(0);
    const pathsOff = focusablePaths(off);
    expect(pathsOff).toHaveLength(5);
    const hairline = pathsOff.filter((path) => path.attrs["data-hairline"] === "true");
    expect(hairline).toHaveLength(1);
    expect(hairline[0].attrs.fill).toBe("none");
    expect(hairline[0].attrs["stroke-dasharray"]).toBe("6 6");
    expect("data-fill-opacity" in hairline[0].attrs).toBe(false);
    expect(openingTags(off).find((tag) => tag.attrs["data-slot"] === "well-supported-toggle")?.attrs["aria-checked"]).toBe("false");
  });

  it("renders both chips in both states so shown + unassignable + hidden = 100.0", () => {
    for (const [html, hidden] of [
      [on, "3.8%"],
      [off, "0.0%"],
    ] as const) {
      const chips = chipValues(html);
      expect(Object.keys(chips).sort()).toEqual(["hidden", "unassignable"]);
      expect(chips.unassignable).toBe("0.0%");
      expect(chips.hidden).toBe(hidden);
      const visibleRows = html
        .split('data-slot="region-row"')
        .slice(1)
        .filter((chunk) => !/^[^>]*\shidden/.test(chunk));
      const shown = visibleRows.reduce(
        (sum, chunk) => sum + percent(/data-slot="figure-value"[^>]*>([^<]*)</.exec(chunk)?.[1] ?? ""),
        0,
      );
      expect(Math.round((shown + percent(chips.unassignable) + percent(chips.hidden)) * 10) / 10).toBe(100);
    }
  });
});

describe("AncestryRegions, grey state", () => {
  const html = render(result(TWO_HIDDEN, 0));

  it("renders a grey map, the mandated sentence, no toggle, no chips and no percent outside the disclosure", () => {
    expect(openingTags(html).find((tag) => tag.tag === "svg")?.attrs["data-mode"]).toBe("grey");
    expect(focusablePaths(html)).toHaveLength(0);
    expect(regionPaths(html)).toHaveLength(5);
    expect(html).toContain(greyState(0, PANEL_FACTS));
    expect(greyState(0, PANEL_FACTS)).toContain(`0 of ${PANEL.markers} ancestry markers — too few to draw a map`);
    expect(html).not.toContain('data-slot="well-supported-toggle"');
    expect(html).not.toContain('data-slot="ancestry-chip"');
    expect(html).not.toContain(TOGGLE_LABEL);
    const [outside, disclosure] = html.split("<details");
    expect(disclosure).toBeDefined();
    expect(text(outside)).not.toContain("%");
    expect(outside).toContain(MARKER_GLOSS);
    expect(outside).toContain(panelLine(PANEL_FACTS));
    expect(outside).toContain(IDENTITY);
  });

  it("keeps the raw numbers one activation away in one attributed block with exactly one list of five", () => {
    expect(html).toContain(RAW_NUMBERS_SUMMARY);
    expect(html).toContain(SUPPORT_NOTE);
    expect(html).toContain(NOISE);
    expect(openingTags(html).filter((tag) => tag.tag === "ul")).toHaveLength(1);
    expect(openingTags(html).filter((tag) => tag.tag === "ol")).toHaveLength(0);
    expect(openingTags(html).filter((tag) => tag.tag === "li")).toHaveLength(5);
    expect(openingTags(html).filter((tag) => "data-claim-block" in tag.attrs)).toHaveLength(1);
    expect(shareFigures(html)).toHaveLength(5);
    expect(html.split(MODELLED_MARKER).length - 1).toBe(1);
  });
});

describe("AncestryRegions, no stored result", () => {
  it("renders the grey map and the one sentence, with no claim block", () => {
    const html = render(null);
    expect(openingTags(html).find((tag) => tag.tag === "svg")?.attrs["data-mode"]).toBe("grey");
    expect(html).toContain(NOTHING_READ);
    expect(html).not.toContain("data-claim-block");
    expect(text(html)).not.toContain("%");
  });
});

describe("LineageCard", () => {
  const call = { haplogroup: "H1a", path: ["L3", "N", "R", "H", "H1", "H1a"], matched: 12, tested: 14, support: "strong", note: "Strong support." };

  it("renders a read mother's line: the term defined once, the name, the path, an observed coverage figure and the mandated sentence", () => {
    const html = renderToStaticMarkup(
      h(LineageCard, { parent: "mother", subjectId: SUBJECT, call, supportNote: call.note, defineTerm: true }),
    );
    expect(openingTags(html).filter((tag) => tag.attrs["data-term-definition"] === "haplogroup")).toHaveLength(1);
    expect(html).toContain('data-testid="mtdna"');
    expect(html).toMatch(/<h2[^>]*>Mother’s line<\/h2>/);
    expect(html).toContain('data-slot="haplogroup"');
    expect(html).toContain("L3 → N → R → H → H1 → H1a");
    const coverage = openingTags(html).filter((tag) => tag.attrs["data-figure-kind"] === "coverage");
    expect(coverage).toHaveLength(1);
    expect(coverage[0].attrs["data-figure-basis"]).toBe("observed");
    expect(coverage[0].attrs["data-provenance"]).toBe("computed:src/lib/genome/haplogroups.ts");
    expect(openingTags(html).filter((tag) => "data-claim-block" in tag.attrs)).toHaveLength(1);
    expect(html).toContain(call.note);
    expect(html).toContain(lineageSentence("mother"));
    expect(lineageSentence("mother")).toContain("your mother’s mother’s mother");
    expect(html).not.toContain(NO_Y_LEAD);
  });

  it("leads the no-Y card with the §2 sentence and keeps the stored note and the XX gloss", () => {
    const note =
      "Your file contains no Y-chromosome positions (expected for XX genomes and some file types), so no Y haplogroup is estimated.";
    const html = renderToStaticMarkup(
      h(LineageCard, { parent: "father", subjectId: SUBJECT, call: { haplogroup: null }, supportNote: note, defineTerm: false }),
    );
    expect(html).toContain('data-testid="ydna"');
    expect(html).toMatch(/<h2[^>]*>Father’s line<\/h2>/);
    expect(html).toContain(NO_Y_LEAD);
    expect(html).toContain(note);
    expect(html).toContain(XX_GLOSS);
    expect(html).not.toContain("data-term-definition");
    expect(html).not.toContain(lineageSentence("father"));
    expect(html).not.toContain("data-claim-block");
  });

  it("does not claim missing Y data when the chromosome was read but the call is insufficient", () => {
    const insufficient = { haplogroup: null, path: [], matched: 1, tested: 9, support: "insufficient", note: "Too few markers matched." };
    const html = renderToStaticMarkup(
      h(LineageCard, { parent: "father", subjectId: SUBJECT, call: insufficient, supportNote: insufficient.note, defineTerm: false }),
    );
    expect(html).not.toContain(NO_Y_LEAD);
    expect(html).toContain(insufficient.note);
    expect(html).not.toContain(XX_GLOSS);
  });

  it("says nothing has been read when no result row exists", () => {
    const html = renderToStaticMarkup(
      h(LineageCard, { parent: "mother", subjectId: SUBJECT, call: null, supportNote: null, defineTerm: true }),
    );
    expect(html).toContain(NOTHING_READ);
    expect(html).not.toContain("data-claim-block");
  });
});

describe("NeanderthalCard", () => {
  it("renders #neanderthal with the mandated heading and Denisovan sentence, and never the archaic-hominin string", () => {
    const html = renderToStaticMarkup(h(NeanderthalCard));
    expect(html).toContain('id="neanderthal"');
    expect(html).toMatch(new RegExp(`<h2[^>]*>${NEANDERTHAL_HEADING}</h2>`));
    expect(html).toContain(DENISOVAN);
    expect(html).not.toContain("archaic-hominin");
    expect(openingTags(html).filter((tag) => /^h[1-6]$/.test(tag.tag))).toHaveLength(1);
  });
});
