import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Count, countText, type CountClass, type CountProps } from "./count";

describe("Count", () => {
  it.each([NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
    "refuses invalid count %s before rendering", (value) => {
      expect(() => countText(value, "estimate")).toThrow("invalid_report_count");
      expect(() => renderToStaticMarkup(h(Count, {
        value, layerClass: "estimate", describedBy: "definition",
      }))).toThrow("invalid_report_count");
    },
  );

  it.each([undefined, null, "", "estimate variant-call", "variant_call", "monogenic", "polygenic", ["estimate", "variant-call"], "__proto__"])(
    "refuses missing, legacy or mixed runtime layer %j", (layer) => {
      expect(() => countText(1, layer as CountClass)).toThrow("invalid_report_count");
    },
  );

  it.each([undefined, "", " ", "missing two", ["definition"]])("requires one definition id, got %j", (describedBy) => {
    expect(() => renderToStaticMarkup(h(Count, {
      value: 1, layerClass: "estimate", describedBy,
    } as CountProps))).toThrow("invalid_report_count_definition");
  });

  it("classifies the exact unavailable-score sentence only as an estimate", () => {
    const html = renderToStaticMarkup(h(Count, {
      value: 2, layerClass: "estimate", describedBy: "definition", wording: "unavailable",
    }));
    expect(html).toContain('data-figure-class="estimate"');
    expect(html).toContain("2 of these reports cannot give you a number yet.");
    expect(() => renderToStaticMarkup(h(Count, {
      value: 2, layerClass: "variant-call", describedBy: "definition", wording: "unavailable",
    }))).toThrow("invalid_report_count_definition");
  });

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
