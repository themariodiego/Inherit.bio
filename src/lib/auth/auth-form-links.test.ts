import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUTH_FORM_PAGES } from "./auth-form";

/**
 * Each auth form page hands its visitor a form cookie (`src/proxy.ts`). The
 * proxy refuses one to a prefetch it can recognise, but Next.js also
 * prefetches a page's head with a request that carries only `rsc` and the
 * router state tree, which is the same shape as a real navigation. So a link
 * to an auth form page must not prefetch at all, or a visitor on any page
 * showing it is given a cookie for a form they never opened.
 */
const SOURCE = path.join(process.cwd(), "src");

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [full] : [];
  });
}

describe("links to an auth form page", () => {
  const formPaths = Object.keys(AUTH_FORM_PAGES);
  const links = sources(SOURCE).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/<Link\b[^>]*>/g)]
      .map((match) => match[0])
      .filter((tag) => formPaths.some((formPath) => tag.includes(`href="${formPath}"`)))
      .map((tag) => ({ file: path.relative(SOURCE, file), tag })));

  it("are found at all, so a passing run is not an empty scan", () => {
    expect(links.length).toBeGreaterThanOrEqual(4);
  });

  it("never prefetch", () => {
    expect(links.filter(({ tag }) => !tag.includes("prefetch={false}"))).toEqual([]);
  });
});
