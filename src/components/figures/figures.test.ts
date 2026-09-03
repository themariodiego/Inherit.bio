// Vitest runs in the node environment (vitest.config.ts); components are
// rendered with renderToStaticMarkup and the HTML is inspected as text.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  FIGURE_BASES,
  FIGURE_CLASSES,
  FIGURE_KINDS,
  MODELLED_MARKER,
} from "@/lib/figures/contract";
import type { StandaloneFigureSpec } from "@/lib/figures/spec";
import { ClaimBlock } from "./claim-block";
import { Figure } from "./figure";
import { RelativeFigure } from "./relative-figure";
import { TermDefinition } from "./term-definition";

interface Tag {
  tag: string;
  attrs: Record<string, string>;
}

function openingTags(html: string): Tag[] {
  return [...html.matchAll(/<([a-z]+)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*\/?>/g)].map((match) => ({
    tag: match[1],
    attrs: Object.fromEntries(
      [...match[2].matchAll(/([^\s=]+)(?:="([^"]*)")?/g)].map((attr) => [attr[1], attr[2] ?? ""]),
    ),
  }));
}

function figureNodes(html: string): Tag[] {
  return openingTags(html).filter((tag) => "data-figure-kind" in tag.attrs);
}

const provenance = { kind: "citation", id: "pmid:1" } as const;
const estimate = { class: "estimate", basis: "modelled", provenance } as const;
const observed = { class: "variant-call", basis: "observed", provenance } as const;

const everyKind: StandaloneFigureSpec[] = [
  { ...estimate, kind: "absolute", value: 0.12, group: "people like you" },
  { ...estimate, kind: "difference-pp", after: 0.12, before: 0.09 },
  { ...estimate, kind: "natural-frequency", value: 0.09 },
  { ...estimate, kind: "percentile", value: 80 },
  { ...observed, kind: "coverage", class: "quality", read: 1180, needed: 1200 },
  { ...estimate, kind: "interval", point: 0.12, low: 0.08, high: 0.17 },
  { ...estimate, kind: "ancestry-share", class: "ancestry", share: 0.43, range: { low: 0.38, high: 0.48 } },
  { ...observed, kind: "genotype", genotype: "A/C", label: "Your two letters at this position" },
  { ...observed, kind: "carrier-status", status: "carrier" },
];

describe("ClaimBlock", () => {
  it("renders the modelled marker exactly once when any figure is modelled", () => {
    const html = renderToStaticMarkup(h(ClaimBlock, { subject: { subjectId: "s1" }, figures: everyKind }));
    expect(html.split(MODELLED_MARKER).length - 1).toBe(1);
    expect(openingTags(html).filter((tag) => "data-modelled-marker" in tag.attrs)).toHaveLength(1);
    expect(html.endsWith(`${MODELLED_MARKER}</p></section>`)).toBe(true);
  });

  it("renders no marker when every figure is observed", () => {
    const figures = everyKind.filter((spec) => spec.basis === "observed");
    const html = renderToStaticMarkup(h(ClaimBlock, { subject: { subjectId: "s1" }, figures }));
    expect(html).not.toContain(MODELLED_MARKER);
    expect(html).not.toContain("data-modelled-marker");
  });

  it("gives every figure node the four attributes with valid values", () => {
    const html = renderToStaticMarkup(h(ClaimBlock, { subject: { subjectId: "s1" }, figures: everyKind }));
    const nodes = figureNodes(html);
    expect(nodes).toHaveLength(everyKind.length);
    for (const node of nodes) {
      expect(FIGURE_KINDS).toContain(node.attrs["data-figure-kind"]);
      expect(FIGURE_CLASSES).toContain(node.attrs["data-figure-class"]);
      expect(FIGURE_BASES).toContain(node.attrs["data-figure-basis"]);
      expect(node.attrs["data-provenance"]).toBe("citation:pmid:1");
    }
  });

  it("carries exactly one subject attribute on the container and none on the figures", () => {
    for (const subject of [{ subjectId: "s1" }, { subjectPair: ["a", "b"] as [string, string] }]) {
      const html = renderToStaticMarkup(h(ClaimBlock, { subject, figures: everyKind }));
      const [container] = openingTags(html);
      expect(container.tag).toBe("section");
      expect(container.attrs["data-claim-block"]).toBe("true");
      const attributed = ["data-subject-id", "data-subject-pair"].filter((name) => name in container.attrs);
      expect(attributed).toHaveLength(1);
      for (const node of figureNodes(html)) {
        expect(node.attrs).not.toHaveProperty("data-subject-id");
        expect(node.attrs).not.toHaveProperty("data-subject-pair");
      }
    }
    const paired = renderToStaticMarkup(
      h(ClaimBlock, { subject: { subjectPair: ["a", "b"] }, figures: [] }),
    );
    expect(openingTags(paired)[0].attrs["data-subject-pair"]).toBe("a:b");
  });
});

describe("Figure", () => {
  it("renders the value with its adjacent unit text", () => {
    const html = renderToStaticMarkup(h(Figure, { spec: everyKind[0], subject: { subjectId: "s1" } }));
    const [root] = figureNodes(html);
    expect(root.attrs["data-subject-id"]).toBe("s1");
    expect(root.attrs.class).toContain("text-2xl");
    expect(root.attrs.class).toContain("font-semibold");
    expect(root.attrs.class).toContain("tabular-nums");
    expect(html).toContain('data-slot="figure-value">12%</span>');
    expect(html).toContain('data-slot="figure-unit"');
    expect(html).toContain("about 12 in 100 people like you");
  });

  it("renders a genotype as a monospace pill with a visually hidden label", () => {
    const html = renderToStaticMarkup(h(Figure, { spec: everyKind[7] }));
    expect(html).toMatch(/<span data-slot="figure-value" class="[^"]*font-mono[^"]*">A\/C<\/span>/);
    expect(html).toContain('<span class="sr-only">Your two letters at this position</span>');
  });

  it("renders an ancestry share with its mandatory range", () => {
    const html = renderToStaticMarkup(h(Figure, { spec: everyKind[6] }));
    expect(html).toContain(">43%<");
    expect(html).toContain(">(38–48%)<");
  });

  it("throws for kind relative", () => {
    const spec = { ...estimate, kind: "relative", text: "30% higher", value: 1.3 } as unknown as StandaloneFigureSpec;
    expect(() => renderToStaticMarkup(h(Figure, { spec }))).toThrow(/RelativeFigure/);
  });

  it("rejects an ancestry share without a range at the type level", () => {
    // @ts-expect-error — `range` is mandatory for ancestry-share.
    const spec: StandaloneFigureSpec = { ...estimate, kind: "ancestry-share", class: "ancestry", share: 0.43 };
    expect(spec.kind).toBe("ancestry-share");
  });
});

describe("RelativeFigure", () => {
  const props = {
    relative: { text: "About a third higher than men aged 40 to 49.", value: 0.12 / 0.09 },
    absoluteBefore: 0.09,
    absoluteAfter: 0.12,
    groups: { before: "men aged 40 to 49", after: "people like you" },
    subject: { subjectId: "s1" } as const,
    provenance,
  };

  it("renders two absolutes, a difference, a natural-frequency pair, then the relative last", () => {
    const html = renderToStaticMarkup(h(RelativeFigure, props));
    const nodes = figureNodes(html);
    expect(nodes.map((node) => node.attrs["data-figure-kind"])).toEqual([
      "absolute",
      "absolute",
      "difference-pp",
      "natural-frequency",
      "relative",
    ]);
    expect(nodes[0].attrs["data-abs-before"]).toBe("true");
    expect(nodes[1].attrs["data-abs-after"]).toBe("true");
    expect(nodes[4].attrs["data-relative-figure"]).toBe("true");
    expect(html).toContain("About 12 in 100 people like you. About 9 in 100 men aged 40 to 49.");
    expect(html).toContain("3.0 percentage points higher");
    expect(html).toContain("(percentage points, not percent)");
    expect(html.split(MODELLED_MARKER).length - 1).toBe(1);
    expect(html.indexOf("About a third higher")).toBeLessThan(html.indexOf(MODELLED_MARKER));
  });

  it("styles both absolutes larger and heavier than the relative text", () => {
    const html = renderToStaticMarkup(h(RelativeFigure, props));
    const nodes = figureNodes(html);
    for (const absolute of nodes.slice(0, 2)) {
      expect(absolute.attrs.class).toContain("text-2xl");
      expect(absolute.attrs.class).toContain("font-semibold");
      expect(absolute.attrs.class).toContain("text-ink");
    }
    expect(nodes[4].attrs.class).toContain("text-sm");
    expect(nodes[4].attrs.class).not.toContain("font-semibold");
  });

  it("puts attribution on the block container only", () => {
    const html = renderToStaticMarkup(h(RelativeFigure, props));
    expect(openingTags(html)[0].attrs["data-subject-id"]).toBe("s1");
    expect(figureNodes(html).every((node) => !("data-subject-id" in node.attrs))).toBe(true);
  });

  it("refuses a relative value that is not the ratio of the absolutes", () => {
    const smuggledOddsRatio = { ...props, relative: { text: "Odds ratio 2.1", value: 2.1 } };
    expect(() => renderToStaticMarkup(h(RelativeFigure, smuggledOddsRatio))).toThrow(/Odds ratios/);
  });
});

describe("TermDefinition", () => {
  it("renders the term and its definition inline, with no tooltip", () => {
    const html = renderToStaticMarkup(h(TermDefinition, { term: "baseline", text: "Baseline" }));
    expect(html).toContain('data-term-definition="baseline"');
    expect(html).toContain("<dfn");
    expect(html).toContain(">Baseline</dfn>");
    expect(html).toContain("The usual chance for people like you, before your DNA is taken into account.");
    expect(html).not.toContain("title=");
  });
});
