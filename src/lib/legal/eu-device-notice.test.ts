import { describe, expect, it } from "vitest";
import { CATEGORY_TAXONOMY } from "@/lib/genome/taxonomy";
import { euDeviceNoticeApplies } from "./eu-device-notice";

describe("euDeviceNoticeApplies", () => {
  const health = CATEGORY_TAXONOMY.map((category) => category.id).filter((id) => id !== "everyday-traits");

  it.each(["DE", "FR", "DK", "CZ", "SE", "NO", "IS", "LI", "GF", "AX"])(
    "adds the sentence to every health category for a viewer in %s",
    (code) => {
      for (const id of health) expect(euDeviceNoticeApplies(id, code)).toBe(true);
    },
  );

  it("leaves everyday traits alone", () => {
    expect(euDeviceNoticeApplies("everyday-traits", "DE")).toBe(false);
  });

  it("adds it when the category is unknown", () => {
    expect(euDeviceNoticeApplies(null, "DE")).toBe(true);
  });

  it.each(["GB", "CH", "US", "BL", "PM", "GL", null])("does not add it for a viewer in %s", (code) => {
    expect(euDeviceNoticeApplies("medicines", code)).toBe(false);
  });
});
