import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SOURCE_LABEL_FIELDS, isRegisteredSourceLabel, sourceLabelText, sourceLabels } from "./source-labels";

/**
 * The bounded source-label registry (R2): closed, withheld and empty
 * today, every id unique and bound to the fields it may fill; a raw
 * laboratory string is never accepted and never rendered.
 */
describe("source labels", () => {
  it("is a closed registry, withheld until reviewed names are registered", () => {
    const raw = JSON.parse(readFileSync(new URL("../../../data/embryo/source_labels.json", import.meta.url), "utf8")) as {
      schemaVersion: number;
      note: string;
      labels: unknown[];
    };
    expect(raw.schemaVersion).toBe(1);
    expect(raw.note).toMatch(/withheld/i);
    expect(raw.labels).toEqual([]);
    expect(sourceLabels()).toEqual([]);
  });

  it("binds every id to registered fields, once", () => {
    const ids = sourceLabels().map((label) => label.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const label of sourceLabels()) {
      expect(label.fields.length).toBeGreaterThan(0);
      for (const field of label.fields) expect(SOURCE_LABEL_FIELDS).toContain(field);
      expect(label.displayText.trim()).not.toBe("");
      // Every registered id is one the validator and the renderers use.
      for (const field of label.fields) {
        expect(isRegisteredSourceLabel(field, label.id)).toBe(true);
        expect(sourceLabelText(field, label.id)).toBe(label.displayText);
      }
    }
  });

  it("accepts null and refuses any unregistered string; a raw column never renders", () => {
    for (const field of SOURCE_LABEL_FIELDS) {
      expect(isRegisteredSourceLabel(field, null)).toBe(true);
      expect(isRegisteredSourceLabel(field, "Acme Fertility Lab")).toBe(false);
      expect(isRegisteredSourceLabel(field, 3)).toBe(false);
      expect(sourceLabelText(field, "Acme Fertility Lab")).toBeNull();
      expect(sourceLabelText(field, null)).toBeNull();
    }
  });
});
