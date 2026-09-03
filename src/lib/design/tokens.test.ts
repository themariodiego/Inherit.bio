import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// G2.7: the visual identity is frozen. This test reads src/app/globals.css
// and pins the identity tokens to their baseline values; X2.4: the eight
// subject colours must clear 3:1 against --paper and --card in both themes.

const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`missing ${selector} block`);
  const end = css.indexOf("}", start);
  return css.slice(start, end);
}

function token(scope: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`).exec(block(scope));
  if (!match) throw new Error(`missing --${name} in ${scope}`);
  return match[1].toLowerCase();
}

function luminance(hex: string): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const FROZEN_LIGHT = {
  paper: "#f7f8f1",
  ink: "#14201b",
  "ink-muted": "#4c5a52",
  forest: "#2e5c45",
  "forest-deep": "#234837",
  tint: "#e9efc4",
  card: "#fdfdf9",
  line: "#dde2d3",
  danger: "#a03d2e",
} as const;

const FROZEN_DARK = {
  paper: "#101713",
  ink: "#e8ede2",
  "ink-muted": "#a3b0a7",
  forest: "#7fb298",
  "forest-deep": "#9cc7af",
  tint: "#2a3320",
  card: "#171f1a",
  line: "#2b352e",
  danger: "#e08a7a",
} as const;

describe("frozen visual identity (G2.7)", () => {
  it("keeps every light identity token at its baseline value", () => {
    for (const [name, value] of Object.entries(FROZEN_LIGHT)) {
      expect(token(":root", name), name).toBe(value);
    }
  });
  it("keeps every dark identity token at its baseline value", () => {
    for (const [name, value] of Object.entries(FROZEN_DARK)) {
      expect(token(".dark", name), name).toBe(value);
    }
  });
  it("keeps the Fraunces display and Inter sans pairing", () => {
    expect(css).toMatch(/--font-display:\s*var\(--font-fraunces\)/);
    expect(css).toMatch(/--font-sans:\s*var\(--font-inter\)/);
    expect(css).toMatch(/\.display\s*\{[^}]*font-family:\s*var\(--font-fraunces\)/);
  });
});

describe("subject colour tokens (X2.4)", () => {
  const scopes: Array<[string, string]> = [
    [":root", "light"],
    [".dark", "dark"],
  ];
  for (const [scope, theme] of scopes) {
    it(`defines eight subject tokens at 3:1 or better in the ${theme} theme`, () => {
      const paper = token(scope, "paper");
      const card = token(scope, "card");
      const seen = new Set<string>();
      for (let i = 0; i < 8; i++) {
        const colour = token(scope, `subject-${i}`);
        expect(seen.has(colour), `subject-${i} duplicates another token`).toBe(false);
        seen.add(colour);
        expect(contrastRatio(colour, paper), `subject-${i} on paper (${theme})`).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(colour, card), `subject-${i} on card (${theme})`).toBeGreaterThanOrEqual(3);
      }
    });
  }
  it("maps every subject token into the Tailwind theme", () => {
    for (let i = 0; i < 8; i++) {
      expect(css).toContain(`--color-subject-${i}: var(--subject-${i});`);
    }
  });
});
