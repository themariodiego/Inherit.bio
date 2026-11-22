import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Owner decision 2026-11-19 (D-142): wherever a page, a layout or a resolver a
 * page uses turns "no user" into the sign-in page or into not-found, it reads
 * the session through `userForPage` or `getPageAccountContext`, so a sign-in
 * check that failed for a moment twice throws to the error boundary instead.
 *
 * Every other page-side reading of the session is listed with the reason it
 * still reads a failure as no user: none of them answers with sign-in or
 * not-found. A new raw `auth.getUser()` or `getSensitiveAccountContext()` in a
 * page, layout or component fails here until it is either checked or listed.
 * Route handlers are out of scope: they answer the register's 401 themselves.
 */

const CHECKED: Record<string, RegExp> = {
  "src/app/(app)/layout.tsx": /userForPage\(supabase\.auth\)/,
  "src/app/(app)/overview/page.tsx": /userForPage\(supabase\.auth\)/,
  "src/app/(app)/embryos/context.ts": /userForPage\(supabase\.auth\)/,
  "src/app/(app)/embryos/upload/page.tsx": /getPageAccountContext\(\)/,
  "src/app/(app)/family/portrait/[pairId]/page.tsx": /userForPage\(supabase\.auth\)/,
  "src/app/(app)/family/[person]/page.tsx": /userForPage\(supabase\.auth\)/,
  "src/app/(app)/family/[person]/permissions/page.tsx": /userForPage\(supabase\.auth\)[\s\S]*getPageAccountContext\(\)/,
  "src/app/(app)/family/health-picture/page.tsx": /userForPage\(supabase\.auth\)/,
  "src/app/(app)/family/invite/page.tsx": /userForPage\(supabase\.auth\)[\s\S]*pageOperationNonce\(/,
  "src/app/(app)/copilot/[scope]/page.tsx": /userForPage\(supabase\.auth\)/,
  "src/app/(review)/reviews/appeals/[id]/page.tsx": /getPageAccountContext\(\)/,
  "src/app/(review)/reviews/future-person/claims/[id]/page.tsx": /getPageAccountContext\(\)/,
  "src/lib/family/subject-route.ts": /userForPage\(supabase\.auth\)/,
  "src/lib/person-operation-nonce.ts": /getPageAccountContext\(\)/,
  "src/lib/page-account-context.ts": /pageAuth\(supabase\.auth\)/,
};

const LEFT: Record<string, string> = {
  "src/app/(family-hub)/layout.tsx":
    "Chooses the chrome of the public-or-authenticated /family landing; with no user it renders the public chrome, which the register requires for any session failure (pageAuthContract.publicOrAuthenticated.failure).",
  "src/app/(family-hub)/family/page.tsx":
    "The same landing's page: with no user it renders the public panels, which no session failure may remove (pageAuthContract.publicOrAuthenticated).",
  "src/app/(app)/files/page.tsx":
    "With no user the file list renders without its breadcrumb; it answers neither sign-in nor not-found.",
  "src/app/(app)/files/upload/page.tsx":
    "With no user the upload page renders without its breadcrumb; it answers neither sign-in nor not-found.",
  "src/app/(app)/settings/page.tsx":
    "With no user Settings renders without the saved declaration and its nonces; it answers neither sign-in nor not-found.",
  "src/app/(app)/settings/consents/page.tsx":
    "With no account the consent list renders without its revoke nonces; it answers neither sign-in nor not-found.",
  "src/components/site/header.tsx":
    "The marketing header shows the sign-in link when no user is read; it redirects nowhere.",
};

const RAW = /\bauth\.getUser\(|\bgetSensitiveAccountContext\(/;
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const read = (file: string) => stripComments(readFileSync(file, "utf8"));

/** Pages, layouts, components and their helpers: everything under these roots but route handlers and tests. */
function pageSideFiles(): string[] {
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (full.split(path.sep).join("/") !== "src/app/api") walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name) || /^route\.ts$/.test(entry.name)) continue;
      found.push(full.split(path.sep).join("/"));
    }
  };
  walk("src/app");
  walk("src/components");
  return found.sort();
}

describe("every page-side reading of the session is checked or listed (D-142)", () => {
  const files = pageSideFiles();

  it("scans the page side at all, so a passing run is not an empty scan", () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain("src/app/(app)/layout.tsx");
    expect(files).toContain("src/components/site/header.tsx");
    expect(files.some(file => file.startsWith("src/app/api/"))).toBe(false);
  });

  it("finds a raw reading only where it is listed, and every listed one still there", () => {
    const raw = files.filter(file => RAW.test(read(file)));
    expect(raw).toEqual(Object.keys(LEFT).sort());
  });

  it.each(Object.entries(CHECKED))("%s reads the session through the checked helper and nothing raw", (file, pattern) => {
    const source = read(file);
    expect(source).toMatch(pattern);
    expect(source).not.toMatch(RAW);
  });

  it("strips comments without eating a scheme's slashes, so prose cannot hide or fake a site", () => {
    expect(stripComments('const a = "scheme://x"; // auth.getUser(')).toBe('const a = "scheme://x"; ');
    expect(RAW.test(stripComments("/* auth.getUser() */ const b = 1;"))).toBe(false);
  });
});
