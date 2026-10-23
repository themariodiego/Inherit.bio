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

import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("density presentation follows the brief's type scale and measure", () => {
  const css = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

  it("sets every page h1 at display-1 and keeps no larger display step", () => {
    const globals = css("src/app/globals.css");
    expect(globals).toContain("h1.display, .display-1 { font-size: clamp(2rem, 1.2rem + 3.2vw, 3.25rem);");
    expect(globals).not.toMatch(/display-(?:lg|hero)\b/u);
    const legal = renderToStaticMarkup(createElement(LegalPage, {
      eyebrow: "Trust", title: "Privacy policy.", sections: [{ id: "a", heading: "A", body: createElement("p", null, "Body.") }],
    }));
    expect(legal).toMatch(/<h1 class="display">Privacy policy\.<\/h1>/u);
    const landing = renderToStaticMarkup(createElement(LandingPage));
    expect(landing).toMatch(/<h1 class="display rise mt-6"/u);
  });

  it("holds the legal contents list to the prose measure and keeps every section rule", () => {
    const html = renderToStaticMarkup(createElement(LegalPage, {
      eyebrow: "Trust", title: "Terms", sections: [
        { id: "one", heading: "One", body: createElement("p", null, "First.") },
        { id: "two", heading: "Two", body: createElement("p", null, "Second.") }],
    }));
    const disclosure = html.match(/<details\b[\s\S]*?<\/details>/u)?.[0];
    expect(disclosure).toMatch(/<ol class="[^"]*\bmax-w-measure\b[^"]*">/u);
    expect([...html.matchAll(/<section\b[^>]*class="legal-section"/gu)]).toHaveLength(2);
    const reading = css("src/app/styles/reading.css");
    expect(reading).toContain("margin-top: calc(var(--rhythm-section) + 1px);");
    expect(reading).toContain("top: calc(var(--rhythm-section) / -2 - 1px);");
    expect(reading).toContain("border-top: 1px solid var(--line);");
    expect(reading).toContain(".reading-head > p { max-width: var(--measure); }");
  });

  it("keeps the landing actions as two 44px pills with the first in the forest outline", () => {
    const html = renderToStaticMarkup(createElement(LandingPage));
    const start = html.match(/<a\b[^>]*href="\/auth\/sign-up"[^>]*>Start with your raw data<\/a>/u)?.[0];
    expect(start).toBeDefined();
    expect(start).toContain('data-variant="outline"');
    expect(start).toContain("border-forest");
    expect(start).toContain("rounded-full");
    expect(start).toContain("h-11");
    expect(start).not.toMatch(/\bbg-forest\b/u);
    const provider = html.match(/<a\b[^>]*href="\/providers"[^>]*>Find a sequencing provider<\/a>/u)?.[0];
    expect(provider).toContain('data-variant="outline"');
  });

  it("keeps the quiet link underlined, at the prose link's resting weight", () => {
    const globals = css("src/app/globals.css");
    expect(globals).toMatch(/\.quiet-link \{[^}]*text-decoration: underline;[^}]*text-decoration-thickness: 1px;/u);
    expect(globals).toMatch(/\.quiet-link:hover \{[^}]*text-decoration-thickness: 2px;/u);
  });
});

import SciencePage from "../src/app/(marketing)/science/page";

describe("density presentation gives real paragraphs a real column, with the first screen unchanged", () => {
  const source = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

  it("sets the landing steps two across, keeps the guide three across, and holds the hero eyebrow to the measure", () => {
    const html = renderToStaticMarkup(createElement(LandingPage));
    expect(html).toContain('<ol class="mt-10 grid items-start gap-x-8 gap-y-10 md:grid-cols-2">');
    expect(html).not.toContain("lg:grid-cols-4");
    // Three plates across at lg, as before: no plate moves below the 1280 fold.
    expect(html).toContain('<div class="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">');
    expect(html).toMatch(/<p class="eyebrow rise max-w-measure"[^>]*>Open-source consumer genomics<\/p>/u);
    for (const text of ["Find a provider", "Upload your raw data", "Read what your file actually supports",
      "Ask, explore, export, delete", "BAM, CRAM and FASTQ files are not accepted."]) expect(html).toContain(text);
  });

  it("makes each science link card's text column the card less its arrow", () => {
    const html = renderToStaticMarkup(createElement(SciencePage));
    for (const [title, body] of [["Limits and uncertainty", "Coverage, reference populations, and resolution."],
      ["Positions and builds", "How observed variants are normalized to GRCh38."]]) {
      expect(html).toContain(`<div class="min-w-0 flex-1"><h2 class="title">${title}</h2><p class="mt-2 text-sm text-ink-muted">${body}</p></div>`);
    }
  });

  it("marks the provider page's heading and directory as its two top-level sections, leaving the product blocks as they are", () => {
    const page = source("src/app/(marketing)/providers/page.tsx");
    expect(page).toContain('<header className="reading-head" data-density-top-level-section>');
    expect(page).toContain('<div className="mt-section" data-density-top-level-section>');
    expect([...page.matchAll(/data-density-top-level-section/gu)]).toHaveLength(2);
    const directory = source("src/components/providers/directory.tsx");
    expect(directory).toContain('className="surface-inset surface-pad-sm"');
    expect(directory).not.toContain("data-density-top-level-section");
  });
});
