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

  it("marks every section as a top-level density section and the not-diagnostic line as required accuracy", () => {
    const html = render();
    expect(html.match(/<section [^>]*data-density-top-level-section="true"/g)).toHaveLength(6);
    // The primary-claim and primary-content markers belong to the caller
    // (the first ClaimBlock and the article), never to the skeleton.
    expect(html).not.toContain("data-density-primary-claim");
    expect(html).not.toContain("data-density-primary-content");
    const disclaimer = html.match(/<p [^>]*data-testid="report-disclaimer"[^>]*>/)?.[0] ?? "";
    expect(disclaimer).toContain('data-density-required-accuracy="true"');
    expect(html).not.toContain("<details");
  });
});
