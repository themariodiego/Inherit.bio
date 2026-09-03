import { describe, expect, it } from "vitest";
import { GROUP_ORDER } from "@/lib/search/match";
import { SEARCH, SEARCH_GROUP_LABELS, SETTINGS_SEARCH_PAGES } from "./search";

function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => allStrings(v, out));
  else if (value && typeof value === "object")
    Object.values(value).forEach((v) => allStrings(v, out));
  return out;
}

describe("search copy", () => {
  it("names exactly the four groups, in the mandated order, with no Help group", () => {
    expect(GROUP_ORDER.map((id) => SEARCH_GROUP_LABELS[id])).toEqual([
      "People and embryos",
      "Reports",
      "Ancestry regions",
      "Settings",
    ]);
    expect(Object.keys(SEARCH_GROUP_LABELS)).toHaveLength(4);
    expect(Object.values(SEARCH_GROUP_LABELS)).not.toContain("Help");
  });

  it("labels the button Search and the dialog by its title", () => {
    expect(SEARCH.button).toBe("Search");
    expect(SEARCH.title).toBe("Search Inherit");
    expect(SEARCH.inputLabel.length).toBeGreaterThan(0);
    expect(SEARCH.placeholder.length).toBeGreaterThan(0);
    expect(SEARCH.shortcut).toEqual({ mac: "⌘K", other: "Ctrl K" });
    expect(SEARCH.ariaKeyShortcuts).toBe("Meta+K Control+K");
  });

  it("lists the five registered settings pages by their register ids and hrefs", () => {
    expect(SETTINGS_SEARCH_PAGES.map((page) => [page.id, page.href])).toEqual([
      ["settings.index", "/settings"],
      ["settings.data", "/settings/data"],
      ["settings.copilot", "/settings/copilot"],
      ["settings.people", "/settings/people"],
      ["settings.consents", "/settings/consents"],
    ]);
    for (const page of SETTINGS_SEARCH_PAGES) expect(page.terms).toContain("Settings");
  });

  it("uses typographic apostrophes and no placeholder tokens", () => {
    const strings = allStrings({ SEARCH, SEARCH_GROUP_LABELS, SETTINGS_SEARCH_PAGES });
    expect(strings.length).toBeGreaterThan(10);
    for (const text of strings) {
      expect(text, text).not.toMatch(/'/);
      expect(text, text).not.toMatch(/\bN\/A\b|\bTBD\b|Coming soon/);
    }
  });
});
