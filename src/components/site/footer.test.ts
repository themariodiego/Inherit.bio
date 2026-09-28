// Vitest runs in the node environment (vitest.config.ts); components are
// rendered with renderToStaticMarkup and the HTML is inspected as text.
import fs from "node:fs";
import path from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LEGAL_INDEX_RIGHTS, PUBLIC_RIGHTS_FOOTER } from "@/copy/navigation";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    h("a", { href, ...rest }, children as never),
}));

const { SiteFooter } = await import("./footer");
const { default: LegalIndexPage } = await import("@/app/(marketing)/legal/page");

/**
 * `docs/route-register.json` → `navigationContract.publicRightsReachability`
 * names the rights links a person with no account must find from the home
 * page: three in the persistent public footer, one action away, and two on the
 * legal index, two actions away. Nothing read that contract before
 * 28 September, and none of the five links existed, so T9's "someone uploaded
 * my DNA" had no route from the home page at all. These tests hold the copy,
 * the footer and the legal index to the register in both directions, so a
 * register edit and a component edit cannot drift apart silently.
 */
interface RightsLink { label: string; labelCopyId: string; routeId: string; maximumActionsFromHome: number }
const register = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "docs/route-register.json"), "utf8"),
) as {
  routes: { id: string; path: string }[];
  navigationContract: { publicRightsReachability: { persistentPublicFooter: RightsLink[]; legalIndex: RightsLink[] } };
};
const contract = register.navigationContract.publicRightsReachability;
const pathOf = (routeId: string) => register.routes.find((entry) => entry.id === routeId)?.path;

/** Every `<a>` in rendered HTML, as [href, text] pairs. */
function anchors(html: string): [string, string][] {
  return [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g)].map((match) => [match[1], match[2]]);
}

describe("public rights reachability", () => {
  it("carries exactly the register's footer and legal-index links, in its order", () => {
    expect(contract.persistentPublicFooter).toHaveLength(3);
    expect(contract.legalIndex).toHaveLength(2);
    expect(PUBLIC_RIGHTS_FOOTER.map(({ label, copyId, routeId }) => ({ label, copyId, routeId })))
      .toEqual(contract.persistentPublicFooter.map(({ label, labelCopyId, routeId }) => ({ label, copyId: labelCopyId, routeId })));
    expect(LEGAL_INDEX_RIGHTS.map(({ label, copyId, routeId }) => ({ label, copyId, routeId })))
      .toEqual(contract.legalIndex.map(({ label, labelCopyId, routeId }) => ({ label, copyId: labelCopyId, routeId })));
  });

  it("points every link at the path the register gives its route", () => {
    for (const link of [...PUBLIC_RIGHTS_FOOTER, ...LEGAL_INDEX_RIGHTS]) {
      expect(pathOf(link.routeId), link.routeId).toBeDefined();
      expect(link.href, link.label).toBe(pathOf(link.routeId));
    }
  });

  it("renders all three footer links on every page that carries the public footer", () => {
    const rendered = anchors(renderToStaticMarkup(h(SiteFooter)));
    for (const link of contract.persistentPublicFooter) {
      expect(rendered, link.label).toContainEqual([pathOf(link.routeId), link.label]);
    }
  });

  it("renders both rights entries on the legal index, the footer's third link", () => {
    const third = contract.persistentPublicFooter.find((link) => link.routeId === "legal.index");
    expect(third, "the footer's way to the legal index").toBeDefined();
    const rendered = anchors(renderToStaticMarkup(h(LegalIndexPage)));
    for (const link of contract.legalIndex) {
      expect(link.maximumActionsFromHome, "footer to index, then the entry").toBe(2);
      expect(rendered, link.label).toContainEqual([pathOf(link.routeId), link.label]);
    }
  });
});
