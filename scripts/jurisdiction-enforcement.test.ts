import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * G5.1: jurisdiction is server-enforced for every restricted capability.
 *
 * Enforcement is real but plural, so nothing catches a new surface that uses
 * none of the mechanisms unless every surface in scope is classified. This
 * gate classifies each one, and it reads CALLS rather than imports: a first
 * version accepted `@/lib/embryos/guards` as a mechanism, and three routes
 * import only its response helpers while their authority is an operation
 * token and the database-side jurisdiction checks made when the cohort was
 * created. Those three are listed below with that reason rather than counted
 * as guarded by an import.
 *
 * Scope is by path, not by import (a surface that forgot the import is the
 * one to find): every API route, page, layout and server action whose path
 * names a restricted area, plus the counterpart subject pages under
 * `genome/[subject]`, which serve another adult's data under
 * `third_party_adult_analysis`. Own-subject surfaces are out of scope by the
 * register's own rule: `adult_self_analysis` is the one unrestricted
 * capability.
 *
 * A surface passes when its own source calls a resolver or a fail-closed
 * refusal, when it re-exports a route that does, when one module it imports
 * does (the Embryo pages share one `loadViewer` that calls
 * `embryoCapability`), or when it is listed here with a reviewable reason.
 * Every listed reason must still be true: a listed surface that gains a
 * check fails as stale. Planted trees prove both directions.
 */
export const AREA = /(family|embryo|cohort|portrait|carrier|invitation|rights|withdraw|subject)/i;
export const MECHANISMS: [RegExp, string][] = [
  [/\b(?:familyCapability|personCapability|accountCapability|cohortCapability|embryoCapability|resolveCapability|resolveSubjectRoute|accountJurisdictionDenied)\s*\(/,
    "capability resolver call"],
];
/**
 * A surface that reads only the acceptance flag is no longer counted: once a
 * person declares where they live (G5.1a, ADR 0032), the flag says the
 * fixture is on, not that this account may act. Every such refusal became
 * the account-aware `accountJurisdictionDenied`, and a new one is reported
 * as unguarded rather than accepted.
 */
export const FLAG_ONLY = /\bjurisdictionDenied\s*\(|\bisTestJurisdictionEnabled\s*\(|\bINHERIT_TEST_JURISDICTION\b/;
/** A file whose whole body re-exports another route inherits its enforcement. */
const ALIAS = /^\s*(?:\/\/[^\n]*\n|\s)*export\s*\{\s*[A-Z,\s]+\}\s*from\s*"([^"]+)"\s*;?\s*$/;
const IMPORT = /import\s+(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/g;
const SURFACE_FILES = new Set(["route.ts", "page.tsx", "layout.tsx"]);

/**
 * Surfaces in scope that carry no capability check of their own, each with
 * the reason. Listed rather than pattern-matched away, so the reason is
 * reviewable and a new one cannot join them silently.
 */
export const WITHOUT_CHECK: Record<string, string> = {
  "src/app/api/family/acknowledge/route.ts":
    "Records an acknowledgement, a Tier-2 result-gate cookie and a one-time portrait acknowledgement stamp. It returns no genetic result and opens no capability; the surfaces it precedes resolve capability themselves.",
  "src/app/(app)/embryos/acknowledge.ts":
    "Server action recording the Embryo domain's Tier-2 acknowledgement as a session cookie. It returns no result and opens no capability; the Embryo pages resolve capability through loadViewer.",
  "src/app/(family-hub)/layout.tsx":
    "Chooses the chrome around the Family landing by sign-in state. It renders no result; the page inside resolves capability itself.",
  "src/app/(marketing)/embryo-analysis/page.tsx":
    "Public explanation of the Embryo domain with no account, no data and no result.",
  "src/app/(marketing)/withdraw/request/route.ts":
    "Subject rights interstitial: confirming, refusing, deleting or withdrawing is not a restricted capability and must answer in every jurisdiction; it opens no analysis.",
  "src/app/(marketing)/withdraw/session/page.tsx":
    "Subject rights review page for an activated rights session; rights are not a restricted capability and must answer in every jurisdiction.",
  "src/app/(marketing)/withdraw/[token]/page.tsx":
    "Pre-migration rights page kept while D-081 retires the open token segment; rights are not a restricted capability.",
  "src/app/api/withdraw/route.ts":
    "Pre-migration rights endpoint kept while D-081 retires it; rights are not a restricted capability.",
  "src/app/api/withdraw/session/route.ts":
    "Rights session responses (confirm, refuse, delete); rights are not a restricted capability and must answer in every jurisdiction.",
  "src/app/api/rights/activate/route.ts":
    "Activates a rights session from a mailed token; rights are not a restricted capability.",
  "src/app/api/cohorts/[id]/restrict/route.ts":
    "Withdrawal-class cohort restriction under an operation token bound to the account, session, operation and target. A cohort exists only through create_embryo_cohort_draft_v1, create_embryo_draft_invitation_v1, accept_embryo_co_parent_invitation_v1 and grant_cohort_purpose_v1, each of which checks jurisdiction in the database, and restriction must work in every jurisdiction.",
  "src/app/api/embryos/[id]/disposition/route.ts":
    "Future-person disposition under an operation token bound to the account, session, operation and target, on a cohort that exists only through the database functions that check jurisdiction at creation, invitation, acceptance and grant.",
  "src/app/api/embryo-cohorts/[id]/record-key-cards/route.ts":
    "Delivery of Record Key cards under an operation token, on a cohort that exists only through the database functions that check jurisdiction at creation, invitation, acceptance and grant; it opens no analysis.",
};

const posix = (file: string) => file.split(path.sep).join("/");

function isServerAction(file: string): boolean {
  if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) return false;
  return readFileSync(file, "utf8").trimStart().startsWith('"use server"');
}

/** Every surface in scope under `root/src/app`, as paths relative to `root`. */
export function surfaceFiles(root: string): string[] {
  const app = path.join(root, "src", "app");
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) return walk(full);
      return SURFACE_FILES.has(entry.name) || isServerAction(full) ? [full] : [];
    });
  return walk(app).map(file => path.relative(root, file)).filter(file => AREA.test(posix(file))).sort();
}

/** The module a specifier names, as a path relative to `root`, or null when it is not a project module. */
function resolveImport(root: string, from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/") ? path.join(root, "src", specifier.slice(2))
    : specifier.startsWith(".") ? path.resolve(root, path.dirname(from), specifier) : null;
  if (!base) return null;
  // Only TypeScript modules can carry a check; a data file that mentions the
  // flag in prose (data/jurisdictions.json does) is not one.
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return path.relative(root, candidate);
  }
  return null;
}

/** The mechanism a surface reaches, or null. Reads calls, follows one alias and one hop of imports. */
export function mechanismFor(root: string, file: string, seen = new Set<string>()): string | null {
  if (seen.has(file)) return null;
  seen.add(file);
  let source: string;
  try { source = readFileSync(path.join(root, file), "utf8"); } catch { return null; }
  for (const [pattern, name] of MECHANISMS) if (pattern.test(source)) return name;
  const alias = ALIAS.exec(source);
  if (alias) {
    const target = resolveImport(root, file, alias[1]!);
    return target && mechanismFor(root, target, seen) ? `alias → ${posix(target)}` : null;
  }
  // One hop, and only through a relative import: a loader beside the surface
  // (the Embryo pages' `../context`) is part of the surface; a library that
  // happens to contain a resolver somewhere is not evidence the surface used it.
  for (const match of source.matchAll(IMPORT)) {
    if (!match[1]!.startsWith(".")) continue;
    const target = resolveImport(root, file, match[1]!);
    if (!target || seen.has(target)) continue;
    const imported = readFileSync(path.join(root, target), "utf8");
    for (const [pattern, name] of MECHANISMS) if (pattern.test(imported)) return `${name} via ${posix(target)}`;
  }
  return null;
}

/** The route a bare re-export names, relative to `root`, or null. */
export function aliasTarget(root: string, file: string): string | null {
  let source: string;
  try { source = readFileSync(path.join(root, file), "utf8"); } catch { return null; }
  const alias = ALIAS.exec(source);
  const target = alias ? resolveImport(root, file, alias[1]!) : null;
  return target ? posix(target) : null;
}

/** An alias inherits its target's classification, listed reason included. */
export function unexplained(root: string, listed: Record<string, string> = WITHOUT_CHECK): string[] {
  return surfaceFiles(root).map(posix).filter(file => {
    if (mechanismFor(root, file) || file in listed) return false;
    const target = aliasTarget(root, file);
    return !(target && target in listed);
  });
}
export function staleExceptions(root: string, listed: Record<string, string> = WITHOUT_CHECK): string[] {
  return Object.keys(listed).filter(file => !existsSync(path.join(root, file)) || mechanismFor(root, file));
}

describe("every restricted-capability surface enforces or is classified", () => {
  const root = process.cwd();
  const surfaces = surfaceFiles(root).map(posix);

  it("finds the surfaces at all, so a passing run is not an empty scan", () => {
    expect(surfaces.length).toBeGreaterThanOrEqual(36);
    expect(surfaces.filter(file => file.endsWith("/route.ts")).length).toBeGreaterThanOrEqual(13);
    expect(surfaces.filter(file => file.endsWith("/page.tsx")).length).toBeGreaterThanOrEqual(18);
    for (const file of ["src/app/api/family/[person]/sharing/route.ts", "src/app/api/embryo-cohort-drafts/route.ts",
      "src/app/(app)/family/health-picture/page.tsx", "src/app/(app)/genome/[subject]/data/browser/page.tsx",
      "src/app/(app)/embryos/acknowledge.ts", "src/app/(family-hub)/layout.tsx"]) expect(surfaces).toContain(file);
  });

  it("leaves no surface in scope both unguarded and unexplained", () => {
    expect(unexplained(root)).toEqual([]);
  });

  it("keeps the exception list honest: a listed surface must exist and still lack a check", () => {
    expect(staleExceptions(root)).toEqual([]);
  });

  it("reaches every mechanism class and the one-hop delegation somewhere, so a renamed resolver cannot pass silently", () => {
    const reached = surfaces.map(file => mechanismFor(root, file) ?? "");
    expect(reached.some(name => name === "capability resolver call")).toBe(true);
    expect(reached.every(name => !name.includes("fail-closed")), "no surface relies on the acceptance flag alone").toBe(true);
    expect(aliasTarget(root, "src/app/api/embryo-cohorts/[id]/withdraw/route.ts")).toBe("src/app/api/cohorts/[id]/restrict/route.ts");
    expect(mechanismFor(root, "src/app/(app)/embryos/upload/page.tsx")).toBe("capability resolver call via src/app/(app)/embryos/context.ts");
    expect(mechanismFor(root, "src/app/(app)/genome/[subject]/data/browser/page.tsx")).toBe("capability resolver call");
    expect(mechanismFor(root, "src/app/api/subject-drafts/route.ts")).toBe("capability resolver call");
    expect(mechanismFor(root, "src/app/api/invitations/route.ts")).toBe("capability resolver call");
    expect(FLAG_ONLY.test(readFileSync(path.join(root, "src/app/api/subject-drafts/route.ts"), "utf8"))).toBe(false);
  });
});

describe("planted trees prove the gate in both directions", () => {
  const plant = (files: Record<string, string>) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "g51-"));
    for (const [file, body] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), body);
    }
    return root;
  };
  const guarded = 'import { personCapability } from "@/lib/family/access";\nexport async function GET() { return personCapability(); }\n';

  it("reports a new unguarded family route and a page that only imports a helper", () => {
    const root = plant({
      "src/app/api/family/new/route.ts": 'export async function GET() { return Response.json({}); }\n',
      "src/app/(app)/family/new/page.tsx": 'import { permits } from "@/lib/family/access";\nexport default function Page() { return permits; }\n',
      "src/lib/family/access.ts": "export const permits = 1;\n",
      "src/app/api/family/guarded/route.ts": guarded,
    });
    try {
      expect(unexplained(root, {})).toEqual(["src/app/(app)/family/new/page.tsx", "src/app/api/family/new/route.ts"]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("accepts an alias to a guarded route and one hop of delegation, and refuses a second hop", () => {
    const root = plant({
      "src/app/api/family/guarded/route.ts": guarded,
      "src/app/api/family/alias/route.ts": 'export { GET } from "@/app/api/family/guarded/route";\n',
      "src/app/(app)/embryos/context.ts": 'import { embryoCapability } from "@/lib/embryos/access";\nexport const loadViewer = () => embryoCapability();\n',
      "src/app/(app)/embryos/page.tsx": 'import { loadViewer } from "./context";\nexport default function Page() { return loadViewer(); }\n',
      "src/app/(app)/embryos/far/page.tsx": 'import { twice } from "../twice";\nexport default function Page() { return twice(); }\n',
      "src/app/(app)/embryos/twice.ts": 'import { loadViewer } from "./context";\nexport const twice = () => loadViewer();\n',
      "src/app/(app)/embryos/server.ts": '"use server";\nexport async function act() { return 1; }\n',
    });
    try {
      expect(mechanismFor(root, "src/app/api/family/alias/route.ts")).toBe("alias → src/app/api/family/guarded/route.ts");
      expect(mechanismFor(root, "src/app/(app)/embryos/page.tsx")).toBe("capability resolver call via src/app/(app)/embryos/context.ts");
      expect(unexplained(root, {})).toEqual(["src/app/(app)/embryos/far/page.tsx", "src/app/(app)/embryos/server.ts"]);
      expect(unexplained(root, { "src/app/api/family/guarded/route.ts": "reason" }).includes("src/app/api/family/alias/route.ts")).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("reports a route that reads only the acceptance flag as unguarded", () => {
    const root = plant({
      "src/app/api/family/flag-only/route.ts": 'import { isTestJurisdictionEnabled } from "@/lib/legal/jurisdictions";\n' +
        'export async function POST() { if (!isTestJurisdictionEnabled()) return new Response(null, { status: 409 }); return Response.json({}); }\n',
      "src/app/api/family/account/route.ts": 'import { accountJurisdictionDenied } from "@/lib/embryos/guards";\n' +
        'export async function POST() { return (await accountJurisdictionDenied("a")) ?? Response.json({}); }\n',
    });
    try {
      expect(unexplained(root, {})).toEqual(["src/app/api/family/flag-only/route.ts"]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("fails a listed exception that gained a check or no longer exists", () => {
    const root = plant({ "src/app/api/family/listed/route.ts": guarded });
    try {
      expect(staleExceptions(root, { "src/app/api/family/listed/route.ts": "reason", "src/app/api/family/gone/route.ts": "reason" }))
        .toEqual(["src/app/api/family/listed/route.ts", "src/app/api/family/gone/route.ts"]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
