import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NOT_DIAGNOSTIC } from "@/copy/reports/strings";
import { ReportSkeleton } from "./report-skeleton";

function render(variant?: "adult" | "embryo") {
  return renderToStaticMarkup(
    h(ReportSkeleton, {
      variant,
      whatThisIs: h("p", null, "summary"),
      yourResult: h("div", { "data-claim-block": "true" }, "result"),
      whatThisDoesntMean: h("ul", null, h("li", null, "bullet")),
      howSureWeAre: h("p", null, "sure"),
      whatYouCanDo: h("p", null, "nothing"),
      whereThisComesFrom: h("p", null, "sources"),
    }),
  );
}

function h2s(html: string): { id: string; text: string }[] {
  return [...html.matchAll(/<h2 id="([^"]+)"[^>]*>([^<]*)<\/h2>/g)].map((m) => ({
    id: m[1],
    text: m[2],
  }));
}

describe("ReportSkeleton", () => {
  it("renders the six h2s in order with fixed ids", () => {
    expect(h2s(render())).toEqual([
      { id: "what-this-is", text: "What this is" },
      { id: "your-result", text: "Your result" },
      { id: "what-this-doesnt-mean", text: "What this doesn’t mean" },
      { id: "how-sure-we-are", text: "How sure we are" },
      { id: "what-you-can-do", text: "What you can do" },
      { id: "where-this-comes-from", text: "Where this comes from" },
    ]);
  });

  it("substitutes the embryo heading and keeps the id", () => {
    const headings = h2s(render("embryo"));
    expect(headings[4]).toEqual({
      id: "what-you-can-do",
      text: "What this does and does not tell you",
    });
    expect(headings.map((item) => item.id)).toEqual(h2s(render()).map((item) => item.id));
  });

  it("renders the not-diagnostic line inside Your result with the pinned testid", () => {
    const html = render();
    const yourResult = html.slice(html.indexOf('id="your-result"'), html.indexOf('id="what-this-doesnt-mean"'));
    expect(yourResult).toContain('data-testid="report-disclaimer"');
    expect(yourResult).toContain(NOT_DIAGNOSTIC);
    expect(html.match(/data-testid="report-disclaimer"/g)).toHaveLength(1);
  });

  it("marks the primary claim block (headings 1–3) and the primary content block (4–6)", () => {
    const html = render();
    const claim = html.indexOf("data-density-primary-claim");
    const content = html.indexOf("data-density-primary-content");
    expect(claim).toBeGreaterThan(-1);
    expect(content).toBeGreaterThan(claim);
    expect(html.indexOf('id="what-this-doesnt-mean"')).toBeLessThan(content);
    expect(html.indexOf('id="how-sure-we-are"')).toBeGreaterThan(content);
    expect(html).not.toContain("<details");
  });
});
