import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * D-142, 19 November 2026: a default `<Link>` prefetches every link that
 * enters the viewport, every prefetch passes the proxy's sign-in check, and
 * a signed-in page's chrome made 21 prefetch requests per page view, so 22 of
 * the 25 `GET /auth/v1/user` calls of a report page were prefetches nobody
 * followed. The site chrome and the pages the journeys walk now link through
 * `IntentLink`, which prefetches on intent only.
 */

const hook = vi.hoisted(() => ({ intent: false, set: [] as unknown[] }));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  // One render of the component, with its state as the test sets it.
  useState: (initial: unknown) => [hook.intent ?? initial, (value: unknown) => { hook.set.push(value); }],
}));
vi.mock("next/link", () => ({ default: function NextLink() { return null; } }));

const { IntentLink } = await import("./intent-link");
type Rendered = ReactElement<Record<string, unknown> & { prefetch: unknown }>;
const render = (props: Record<string, unknown>) => IntentLink(props as never) as Rendered;

describe("IntentLink: no prefetch on sight, the default prefetch on intent", () => {
  beforeEach(() => { hook.intent = false; hook.set = []; });

  it("renders next/link with prefetching off until the person shows intent", () => {
    const link = render({ href: "/overview", className: "x", "aria-current": "page", children: "Overview" });
    expect(link.props.prefetch).toBe(false);
    expect(link.props).toEqual(expect.objectContaining({ href: "/overview", className: "x", "aria-current": "page", children: "Overview" }));
  });

  it.each(["onMouseEnter", "onFocus", "onTouchStart"] as const)("%s turns prefetching on, and still calls the caller's own handler", (handler) => {
    const own = vi.fn();
    const event = { type: handler };
    (render({ href: "/overview", [handler]: own }).props[handler] as (event: unknown) => void)(event);
    expect(hook.set).toEqual([true]);
    expect(own).toHaveBeenCalledWith(event);
  });

  it("after intent hands next/link its default prefetch (null), never a full prefetch", () => {
    hook.intent = true;
    expect(render({ href: "/overview" }).props.prefetch).toBeNull();
  });

  it("does not let a caller turn viewport prefetching back on", () => {
    expect(render({ href: "/overview", prefetch: true }).props.prefetch).toBe(false);
    expect(render({ href: "/overview", prefetch: null }).props.prefetch).toBe(false);
  });

  it("passes every other prop through, the click handler included", () => {
    const onClick = vi.fn();
    const link = render({ href: { pathname: "/genome/me/reports", query: { layer: "estimate" } }, scroll: false, onClick, "data-slot": "wordmark" });
    expect(link.props).toEqual(expect.objectContaining({ scroll: false, onClick, "data-slot": "wordmark",
      href: { pathname: "/genome/me/reports", query: { layer: "estimate" } } }));
  });
});

/**
 * Every link in the site chrome (everything under `src/components/site`, which
 * the signed-in shell, the public header and footer and the error and
 * not-found surfaces render) and on the pages the browser journeys walk in
 * bulk. A `next/link` element there must be `IntentLink`, or carry
 * `prefetch={false}` where nothing may be fetched ahead of a click (the
 * sensitive-result reveal, the sign-up form's cookie).
 */
const JOURNEY_FILES = [
  "src/app/(app)/overview/page.tsx",
  "src/components/overview/entry-box.tsx",
  "src/components/overview/processing-panel.tsx",
  "src/components/overview/start-here.tsx",
  "src/components/overview/starter-reports.tsx",
  "src/components/subjects/subject-bar.tsx",
  "src/app/(app)/genome/[subject]/reports/[slug]/page.tsx",
  "src/components/reports/sensitive-gate.tsx",
  "src/app/(app)/genome/[subject]/reports/page.tsx",
  "src/components/reports/report-library.tsx",
  "src/app/(app)/family/health-picture/page.tsx",
  "src/components/family/health-picture-cell.tsx",
  "src/app/(app)/files/page.tsx",
  "src/components/family/person-card.tsx",
];

function chromeFiles(): string[] {
  return readdirSync("src/components/site").filter(name => /\.tsx$/.test(name) && name !== "intent-link.tsx")
    .map(name => path.posix.join("src/components/site", name)).sort();
}

const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Every opening tag of `tag` in a source, braces and strings respected. */
function openingTags(source: string, tag: string): string[] {
  const tags: string[] = [];
  const pattern = new RegExp(`<${tag}(?=[\\s>/])`, "g");
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    let depth = 0, quote: string | null = null, end = -1;
    for (let i = match.index; i < source.length && end < 0; i++) {
      const c = source[i]!;
      if (quote) { if (c === quote) quote = null; continue; }
      if (depth === 0 && (c === '"' || c === "'")) quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) end = i;
    }
    tags.push(source.slice(match.index, end + 1));
  }
  return tags;
}

/**
 * What in a source could render `next/link` with prefetching on sight: an
 * element of it without `prefetch={false}`, and any other use of its name
 * (an alias, a prop, a type), which this reading cannot follow. Also any
 * `IntentLink` that is not the shared one.
 */
function prefetchingOnSight(source: string): string[] {
  const code = stripComments(source);
  const found: string[] = [];
  const intent = /import\s*\{[^}]*\bIntentLink\b[^}]*\}\s*from\s*"([^"]+)"/.exec(code)?.[1];
  if (/<IntentLink[\s>/]/.test(code) && intent !== "@/components/site/intent-link") found.push(`IntentLink from ${intent ?? "nowhere"}`);
  const imported = /import\s+(\w+)\s+from\s+"next\/link";?/.exec(code);
  if (!imported) return found;
  const local = imported[1]!;
  const tags = openingTags(code, local);
  found.push(...tags.filter(tag => !/\bprefetch=\{false\}/.test(tag)));
  let rest = code.replace(imported[0], "").split(`</${local}>`).join("");
  for (const tag of tags) rest = rest.replace(tag, "");
  if (new RegExp(`\\b${local}\\b`).test(rest)) found.push(`another use of ${local}`);
  return found;
}

describe("no link in the site chrome or on a journey page prefetches on sight", () => {
  const files = [...chromeFiles(), ...JOURNEY_FILES];

  it("scans the chrome at all, so a passing run is not an empty scan", () => {
    expect(chromeFiles()).toEqual(expect.arrayContaining(["src/components/site/app-nav.tsx", "src/components/site/wordmark.tsx",
      "src/components/site/global-search.tsx", "src/components/site/breadcrumbs.tsx", "src/components/site/footer.tsx",
      "src/components/site/header.tsx", "src/components/site/error-content.tsx", "src/components/site/not-found-content.tsx"]));
  });

  it.each(files)("%s", (file) => {
    const source = readFileSync(file, "utf8");
    expect(prefetchingOnSight(source), `${file}: a next/link element without prefetch={false}; use IntentLink`).toEqual([]);
    if (JOURNEY_FILES.includes(file)) expect(stripComments(source)).toMatch(/<IntentLink[\s>]/);
  });

  it("keeps the two links that must never fetch ahead of a click on next/link with prefetch={false}", () => {
    const reveal = openingTags(stripComments(readFileSync("src/components/reports/sensitive-gate.tsx", "utf8")), "Link");
    expect(reveal).toHaveLength(1);
    expect(reveal[0]).toMatch(/href=\{revealHref\}[\s\S]*prefetch=\{false\}/);
    const signUp = openingTags(stripComments(readFileSync("src/components/site/header.tsx", "utf8")), "Link");
    expect(signUp).toEqual(['<Link href="/auth/sign-up" prefetch={false}>']);
  });

  it("finds a prefetching element in a planted source, aliased or multi-line", () => {
    expect(prefetchingOnSight('import Link from "next/link";\nconst a = <Link\n  href={x}\n  onClick={() => go(a > b)}\n>A</Link>;')).toHaveLength(1);
    expect(prefetchingOnSight('import NextLink from "next/link";\nconst a = <NextLink href="/x">A</NextLink>;')).toHaveLength(1);
    expect(prefetchingOnSight('import Link from "next/link";\nconst a = <Link href="/x" prefetch={false}>A</Link>;')).toEqual([]);
    expect(prefetchingOnSight('// <Link href="/x">\nimport { IntentLink } from "@/components/site/intent-link";')).toEqual([]);
    expect(prefetchingOnSight('import Link from "next/link";\nconst IntentLink = Link;\nconst a = <IntentLink href="/x">A</IntentLink>;'))
      .toEqual(["IntentLink from nowhere", "another use of Link"]);
    expect(prefetchingOnSight('import IntentLink from "next/link";\nconst a = <IntentLink href="/x">A</IntentLink>;')).toHaveLength(2);
  });
});
