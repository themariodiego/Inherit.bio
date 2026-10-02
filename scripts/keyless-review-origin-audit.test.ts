import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { ALLOWED_ORIGINS, assertNoThirdParty, SUPABASE_URL, type ObservedRequests } from "../e2e/helpers";

function fixture(origin: string) {
  const globals: Record<string, string> = {};
  const content = vi.fn(async () => "<main>Private documentary review</main>");
  const evaluate = vi.fn(async (_callback: unknown, name: string) => globals[name] ?? "undefined");
  const page = { url: () => `${origin}/reviews/future-person/claims/synthetic`, evaluate, content } as unknown as Page;
  const observed: ObservedRequests = { origins: new Set([origin, SUPABASE_URL]),
    urls: [`${origin}/_next/static/review.js`, `${SUPABASE_URL}/auth/v1/user`] };
  return { page, observed, globals, content, evaluate };
}

describe("explicit isolated app privacy audits", () => {
  it("preserves the main sweep's original two-origin contract and all document checks", async () => {
    expect([...ALLOWED_ORIGINS]).toEqual(["http://localhost:3100", "http://127.0.0.1:54321"]);
    const f = fixture("http://localhost:3100");
    await assertNoThirdParty(f.page, f.observed, "main");
    expect(f.evaluate.mock.calls.map(call => call[1])).toEqual(["fbq", "gtag", "dataLayer"]);
    expect(f.content).toHaveBeenCalledTimes(1);
  });

  it("accepts only the separately declared 3105 app and its own storage API", async () => {
    const f = fixture("http://localhost:3105");
    await assertNoThirdParty(f.page, f.observed, "isolated", "http://localhost:3105");
    expect(f.evaluate.mock.calls.map(call => call[1])).toEqual(["fbq", "gtag", "dataLayer"]);
    expect(f.content).toHaveBeenCalledTimes(1);
  });

  it.each(["http://localhost:3104", "http://localhost:3105"])("never infers %s for the unchanged main sweep", async origin => {
    const f = fixture(origin);
    await expect(assertNoThirdParty(f.page, f.observed, "main")).rejects.toThrow("unexpected third-party origins");
  });

  it.each(["http://localhost:3100", "http://localhost:3104", "http://localhost:3106", "http://127.0.0.1:3105",
    "https://localhost:3105", "https://outside.example", "http://127.0.0.1:55321"])("rejects an additional request to %s", async origin => {
    const f = fixture("http://localhost:3105");
    f.observed.origins.add(origin); f.observed.urls.push(`${origin}/private`);
    await expect(assertNoThirdParty(f.page, f.observed, "isolated", "http://localhost:3105"))
      .rejects.toThrow("unexpected third-party origins");
  });

  it.each(["", "http://localhost:3106", "https://outside.example", "http://localhost:3105/",
    "http://localhost:3105/path", "http://user@localhost:3105", "http://localhost:3105?allow=1",
    "http://127.0.0.1:3105", "https://localhost:3105", SUPABASE_URL])("refuses an unregistered declaration %s", async origin => {
    const f = fixture("http://localhost:3105");
    await expect(assertNoThirdParty(f.page, f.observed, "isolated", origin)).rejects.toThrow("exact registered local app origin");
    expect(f.evaluate).not.toHaveBeenCalled();
  });

  it("refuses a registered declaration that differs from the actual page", async () => {
    const f = fixture("http://localhost:3100");
    await expect(assertNoThirdParty(f.page, f.observed, "isolated", "http://localhost:3105"))
      .rejects.toThrow("page must match its declared app origin");
  });

  for (const declared of [undefined, "http://localhost:3105"]) {
    const origin = declared ?? "http://localhost:3100";
    it(`retains the independent tracker-host check at ${origin}`, async () => {
      const f = fixture(origin);
      // Exercise the independent host detector even if origin metadata were incomplete.
      f.observed.urls.push("https://www.google-analytics.com/collect");
      await expect(assertNoThirdParty(f.page, f.observed, "privacy", declared)).rejects.toThrow("tracker-like host");
    });
    it.each(["fbq", "gtag", "dataLayer"])(`refuses the %s tracking global at ${origin}`, async name => {
      const f = fixture(origin); f.globals[name] = "function";
      await expect(assertNoThirdParty(f.page, f.observed, "privacy", declared)).rejects.toThrow(`window.${name} must be undefined`);
    });
    it(`refuses payment origins in the rendered response at ${origin}`, async () => {
      const f = fixture(origin); f.content.mockResolvedValue('<form action="https://checkout.stripe.com/pay"></form>');
      await expect(assertNoThirdParty(f.page, f.observed, "privacy", declared)).rejects.toThrow("payment-processor origin");
    });
  }
});

/** Pin the connected awaited audit, so observed traffic cannot become its declaration. */
function assertFixedJourneyAudit(source: string) {
  const file = ts.createSourceFile("journey.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imported = file.statements.some(statement => ts.isImportDeclaration(statement)
    && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === "./helpers"
    && !statement.importClause?.isTypeOnly && statement.importClause?.namedBindings
    && ts.isNamedImports(statement.importClause.namedBindings)
    && statement.importClause.namedBindings.elements.some(binding => binding.name.text === "assertNoThirdParty"
      && !binding.propertyName && !binding.isTypeOnly));
  const audits: ts.CallExpression[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "assertNoThirdParty") audits.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert(imported && audits.length === 1, "Exactly one genuine helper audit must be connected");
  const call = audits[0];
  assert(ts.isAwaitExpression(call.parent) && call.arguments.length === 4
    && ts.isIdentifier(call.arguments[0]) && call.arguments[0].text === "fresh"
    && ts.isIdentifier(call.arguments[1]) && call.arguments[1].text === "observed"
    && ts.isStringLiteral(call.arguments[2])
    && call.arguments[2].text === "assigned native positive notice and real release hold, both themes"
    && ts.isStringLiteral(call.arguments[3]) && call.arguments[3].text === "http://localhost:3105",
  "The actual fresh-page audit must declare the literal isolated 3105 origin");
}

describe("permanent isolated journey audit wiring", () => {
  const real = () => readFileSync("e2e/reviews-keyless-owner-notice-journey.spec.ts", "utf8");
  it("pins the actual awaited audit to its literal fixture origin", () => {
    expect(() => assertFixedJourneyAudit(real())).not.toThrow();
  });
  it("rejects removed, redirected, comment-only and traffic-derived audit declarations", () => {
    const changes = [
      (source: string) => source.replace('both themes","http://localhost:3105"', 'both themes"'),
      (source: string) => source.replace('both themes","http://localhost:3105"', 'both themes","http://localhost:3100"'),
      (source: string) => source.replace('both themes","http://localhost:3105"', 'both themes",new URL(fresh.url()).origin'),
      (source: string) => source.replace('both themes","http://localhost:3105"', 'both themes",[...observed.origins][0]'),
      (source: string) => source.replace("assertNoThirdParty(fresh,observed,", "assertNoThirdParty(review,observed,"),
      (source: string) => source.replace("await assertNoThirdParty(fresh,", "void assertNoThirdParty(fresh,"),
      (source: string) => source.replace("await assertNoThirdParty(fresh,", "// await assertNoThirdParty(fresh,"),
      (source: string) => source.replace("await assertNoThirdParty(fresh,", "await unconnectedAudit(fresh,"),
    ];
    for (const change of changes) {
      const source = real(), changed = change(source); expect(changed).not.toBe(source);
      expect(() => assertFixedJourneyAudit(changed)).toThrow();
    }
  });
});
