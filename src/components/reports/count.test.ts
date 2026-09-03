import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Count, countText } from "./count";

describe("Count", () => {
  it("labels every count with its layer word, singular and plural", () => {
    expect(countText(1, "estimate")).toBe("1 statistical estimate");
    expect(countText(151, "estimate")).toBe("151 statistical estimates");
    expect(countText(0, "estimate")).toBe("0 statistical estimates");
    expect(countText(1, "variant-call")).toBe("1 specific-variant report");
    expect(countText(412, "variant-call")).toBe("412 specific-variant reports");
    expect(countText(1234, "estimate")).toBe("1,234 statistical estimates");
    expect(countText(3, "estimate", "covered by your file")).toBe(
      "3 statistical estimates covered by your file",
    );
  });

  it("emits data-figure-class and data-metric-value on the node", () => {
    const html = renderToStaticMarkup(
      h(Count, { value: 151, layerClass: "estimate", describedBy: "layer-estimate-definition" }),
    );
    expect(html).toContain('data-figure-class="estimate"');
    expect(html).toContain('data-metric-value="151"');
    expect(html).toContain('aria-describedby="layer-estimate-definition"');
    expect(html).toContain(">151 statistical estimates<");
    expect(html).not.toMatch(/\d+ reports\b/);
  });
});
