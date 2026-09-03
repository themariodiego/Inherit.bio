import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown }) =>
    h("a", { href, ...rest }, children as never),
}));

const { Breadcrumbs } = await import("./breadcrumbs");

function text(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

describe("Breadcrumbs", () => {
  it("renders Domain / Subject / Section / Item with the full subject name", () => {
    const html = renderToStaticMarkup(
      h(Breadcrumbs, {
        items: [
          { label: "My Genome", href: "/genome/me" },
          { label: "Maya Okafor" },
          { label: "Reports", href: "/genome/me/reports" },
          { label: "Caffeine metabolism · CYP1A2" },
        ],
      }),
    );
    expect(text(html)).toBe("My Genome / Maya Okafor / Reports / Caffeine metabolism · CYP1A2");
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('<a href="/genome/me"');
    expect(html).toContain('<a href="/genome/me/reports"');
    expect(html).not.toContain('<a href="#"');
  });

  it("marks only the last crumb as the current page", () => {
    const html = renderToStaticMarkup(
      h(Breadcrumbs, { items: [{ label: "My Genome", href: "/genome/me" }, { label: "Maya" }] }),
    );
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>Maya</);
  });
});
