// Every not-found and error boundary rendered directly, to pin the one thing
// that was actually broken in this work: how many landmarks each contributes.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RootNotFound from "./not-found";
import AppNotFound from "./(app)/not-found";
import MarketingNotFound from "./(marketing)/not-found";
import RootError from "./error";
import AppError from "./(app)/error";
import MarketingError from "./(marketing)/error";
import GlobalError from "./global-error";
import { NOT_FOUND_HEADING } from "@/copy/not-found";
import { ERROR_HEADING } from "@/copy/error-state";

const noop = () => {};
const thrown = Object.assign(new Error("subject 7f3a1b carries BRCA1 c.68_69del"), { digest: "d123" });

/**
 * Next renders the nearest boundary **inside the layouts above it**. A boundary
 * under a route group therefore sits within a layout that already supplies the
 * one `<main id="main">`, and one that brings its own puts two `main` landmarks
 * and two `id="main"` elements on the page — a `landmark-one-main` failure, a
 * duplicate id and an ambiguous skip-link target.
 *
 * That is not hypothetical: the first version of `not-found.tsx` did exactly
 * that on 19 of the 20 files that call `notFound()`, and passed its own
 * accessibility audit because that audit only ever visited an unmatched URL,
 * which renders under the bare root layout. These assertions are cheap and they
 * would have caught it before a browser ever ran.
 */
const SUPPLIES_ITS_OWN_LANDMARK = [
  ["src/app/not-found.tsx", h(RootNotFound), NOT_FOUND_HEADING],
  ["src/app/error.tsx", h(RootError, { error: thrown, reset: noop }), ERROR_HEADING],
  ["src/app/global-error.tsx", h(GlobalError, { error: thrown, reset: noop }), ERROR_HEADING],
] as const;

const INHERITS_ITS_LANDMARK = [
  ["src/app/(app)/not-found.tsx", h(AppNotFound), NOT_FOUND_HEADING],
  ["src/app/(marketing)/not-found.tsx", h(MarketingNotFound), NOT_FOUND_HEADING],
  ["src/app/(app)/error.tsx", h(AppError, { error: thrown, reset: noop }), ERROR_HEADING],
  ["src/app/(marketing)/error.tsx", h(MarketingError, { error: thrown, reset: noop }), ERROR_HEADING],
] as const;

describe("the not-found and error boundaries", () => {
  it.each(SUPPLIES_ITS_OWN_LANDMARK)(
    "%s renders under a layout with no chrome, so it supplies exactly one main",
    (_file, element, heading) => {
      const html = renderToStaticMarkup(element);
      expect(html.match(/<main\b/g) ?? [], "exactly one main").toHaveLength(1);
      expect(html.match(/id="main"/g) ?? [], "exactly one skip-link target").toHaveLength(1);
      expect(html.match(/<h1\b/g) ?? [], "exactly one h1").toHaveLength(1);
      expect(html).toContain(heading);
    },
  );

  it.each(INHERITS_ITS_LANDMARK)(
    "%s renders inside a layout that already has one, so it supplies none",
    (_file, element, heading) => {
      const html = renderToStaticMarkup(element);
      expect(html).not.toContain("<main");
      expect(html).not.toContain('id="main"');
      expect(html.match(/<h1\b/g) ?? [], "exactly one h1").toHaveLength(1);
      expect(html).toContain(heading);
    },
  );

  it.each([...SUPPLIES_ITS_OWN_LANDMARK, ...INHERITS_ITS_LANDMARK])(
    "%s never renders the thrown error's own text",
    (_file, element) => {
      // The error handed in above carries a subject id and a variant, which is
      // the shape of thing an error's message really can contain here.
      const html = renderToStaticMarkup(element);
      expect(html).not.toContain("BRCA1");
      expect(html).not.toContain("7f3a1b");
      expect(html).not.toContain("d123");
    },
  );

  it("global-error replaces the root layout, so it brings its own html and body", () => {
    const html = renderToStaticMarkup(h(GlobalError, { error: thrown, reset: noop }));
    expect(html).toContain("<html");
    expect(html).toContain("<body");
  });
});
