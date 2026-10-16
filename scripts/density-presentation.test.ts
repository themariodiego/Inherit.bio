import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AuthLayout from "../src/app/auth/layout";
import LandingPage from "../src/app/(marketing)/page";
import { LegalPage } from "../src/components/legal/legal-page";

describe("density presentation retains ordinary visible content", () => {
  it("keeps auth landmarks, content, attribution and navigation without decorative terrain", () => {
    const html = renderToStaticMarkup(createElement(AuthLayout, null,
      createElement("p", null, "Your consent remains required.")));
    expect(html).toMatch(/<main\b[^>]*id="main"[^>]*>/u);
    expect(html).toContain("Your consent remains required.");
    expect(html).toContain("Back to Inherit");
    expect(html).toContain("for the public good");
    expect(html).toContain("auth-surface surface-pad");
    expect(html).not.toContain("auth-terrain");
    expect(html).not.toContain("auth-band");
    expect(html).not.toContain('data-slot="terrain"');
  });

  it("collapses only legal navigation, never the legal body or effective version", () => {
    const html = renderToStaticMarkup(createElement(LegalPage, {
      eyebrow: "Your rights", title: "Consent and safety", effectiveDate: "2026-10-10", version: 2,
      intro: createElement("p", null, "Read these terms before choosing."),
      sections: [{ id: "safety", heading: "Safety", body: createElement("p", null, "Laboratory confirmation is required.") },
        { id: "withdraw", heading: "Withdrawal", body: createElement("a", { href: "/withdraw/example" }, "Withdraw consent") }],
    }));
    const disclosure = html.match(/<details\b[\s\S]*?<\/details>/u)?.[0];
    expect(disclosure).toBeDefined();
    expect(disclosure).toContain('aria-label="On this page"');
    expect(disclosure).toContain('href="#safety"');
    expect(disclosure).toContain('href="#withdraw"');
    expect(disclosure).toContain("min-h-11");
    expect(disclosure).not.toContain("Laboratory confirmation");
    expect(disclosure).not.toContain("Withdraw consent");
    const ordinary = html.replace(disclosure!, "");
    expect(ordinary).toContain("Laboratory confirmation is required.");
    expect(ordinary).toContain('href="/withdraw/example"');
    expect(ordinary).toContain('dateTime="2026-10-10"');
    expect(ordinary).toContain("Version 2");
    expect(ordinary).toContain("Read these terms before choosing.");
    expect(ordinary).not.toMatch(/\b(?:hidden|aria-hidden)\b/u);
    expect([...html.matchAll(/<nav\b/gu)]).toHaveLength(1);
  });

  it("retains landing actions, provider payment and all four safety statements", () => {
    const html = renderToStaticMarkup(createElement(LandingPage));
    for (const text of ["Start with your raw data", "Find a sequencing provider", "Inherit itself is free",
      "No diagnosis.", "No sequencing sales.", "No trackers.", "No data sharing with anyone",
      "BAM, CRAM and FASTQ files are not accepted.", "Uploads go straight from your browser to private storage."]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('href="/auth/sign-up"');
    expect(html).toContain('href="/providers"');
    expect(html).not.toContain("hero-ground");
    expect(html).not.toContain("hero-band");
    expect(html).not.toContain('data-slot="terrain"');
  });
});
