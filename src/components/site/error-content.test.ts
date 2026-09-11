// Rendered with renderToStaticMarkup and the HTML inspected as text, the same
// way `src/components/results/polygenic/polygenic.test.ts` does.
import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ERROR_HEADING,
  ERROR_LINKS,
  ERROR_NEXT,
  ERROR_RETRY_LABEL,
  ERROR_WITHHELD,
} from "@/copy/error-state";
import { ErrorContent } from "./error-content";

const html = renderToStaticMarkup(h(ErrorContent, { reset: () => {} }));

describe("the error surface", () => {
  it("renders the three things the register asks of this state", () => {
    // stateProjection.error = "show-the-public-safe-retry-and-rights-navigation-state".
    expect(html).toContain(ERROR_HEADING);
    expect(html, "the retry control").toContain(ERROR_RETRY_LABEL);
    for (const link of ERROR_LINKS) {
      expect(html, `rights navigation: ${link.label}`).toContain(link.href);
    }
  });

  it("never renders the error's own text, which is what public-safe means", () => {
    // An error's message or digest can carry identifiers, query parameters or
    // row contents, and this boundary is reachable from the genome surfaces.
    expect(html).not.toContain("digest");
    // The component cannot leak what it is never handed, and this is the
    // assertion that keeps it that way if someone adds the argument back.
    const source = readFileSync("src/components/site/error-content.tsx", "utf8")
      // Comments explain that these are never read, so scanning them would
      // match the explanation rather than the code.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    // Optional chaining counts: `error?.message` leaks exactly as much as
    // `error.message`, and an earlier version of this pattern missed it — a
    // planted leak using `?.` passed. So does destructuring the field out.
    expect(source, "the error's own text must never be read here")
      .not.toMatch(/error\s*\??\.\s*(message|digest|stack)\b/);
    expect(source, "nor destructured out of the error")
      .not.toMatch(/\{[^}]*\b(message|digest|stack)\b[^}]*\}\s*=\s*error\b/);
  });

  it("promises nothing about what was or was not saved", () => {
    // A render error says nothing about what persisted. Reassurance here would
    // be the missing-data comfort this product forbids.
    for (const comfort of [
      "your data is safe", "nothing was lost", "nothing was deleted",
      "your data is unchanged", "no data was lost", "everything is saved",
    ]) {
      expect(html.toLowerCase(), `"${comfort}" is a promise this page cannot keep`)
        .not.toContain(comfort);
    }
  });

  it("says why no detail is shown, rather than showing a blank failure", () => {
    expect(html).toContain(ERROR_WITHHELD);
    expect(html).toContain(ERROR_NEXT);
  });

  it("links only to routes the register keeps", () => {
    const register = JSON.parse(readFileSync("docs/route-register.json", "utf8")) as {
      routes: { path: string; kind: string; disposition: string }[];
    };
    const kept = new Set(
      register.routes
        .filter(route => route.kind === "page" && route.disposition === "kept")
        .map(route => route.path),
    );
    expect(kept.size, "the register must actually load").toBeGreaterThan(20);
    expect(ERROR_LINKS.length).toBeGreaterThan(0);
    for (const link of ERROR_LINKS) {
      expect(kept.has(link.href), `${link.href} (${link.label}) is not a kept page`).toBe(true);
    }
  });

  it("carries exactly one h1 and no landmark of its own", () => {
    // The boundary above supplies the landmark. Two `main` elements on one
    // document is the defect this pattern exists to prevent.
    expect(html.match(/<h1/g) ?? []).toHaveLength(1);
    expect(html).not.toContain("<main");
    expect(html).not.toContain('id="main"');
  });
});
