import { describe, expect, it } from "vitest";
import {
  crossSubjectRefusal,
  REFUSAL_IDS,
  REFUSAL_SELECTION_ADVICE,
  REFUSAL_TREATMENT,
  REFUSAL_UNSUPPORTED_NUMBER,
  refusalFor,
} from "./refusals";

describe("copilot refusals", () => {
  it("ships the three strings the brief quotes, character for character apart from the apostrophe", () => {
    expect(REFUSAL_TREATMENT).toBe(
      "I can’t tell you what to take or what to do about this. I can explain what your file says and what it doesn’t. For advice about your health, speak to a doctor or a genetic counsellor.",
    );
    expect(REFUSAL_SELECTION_ADVICE).toBe(
      "Inherit does not recommend which embryo to choose. That decision belongs to you and your clinical team. I can explain what any number on this page means.",
    );
    expect(REFUSAL_UNSUPPORTED_NUMBER).toBe("I can’t answer that from your data without guessing, so I won’t.");
    expect(crossSubjectRefusal("You")).toBe("This thread is about You. Start a new thread to ask about a different file.");
  });

  it("serves one distinct string per id, with typographic apostrophes and no deferral", () => {
    const strings = REFUSAL_IDS.map((id) => refusalFor(id, "Alex"));
    expect(new Set(strings).size).toBe(REFUSAL_IDS.length);
    for (const text of strings) {
      expect(text).not.toMatch(/'/);
      expect(text).not.toMatch(/coming soon|\bsoon\b|\byet\b|currently/i);
      expect(text).not.toMatch(/your (child|baby) will|your future child is/i);
      expect(text.trim()).toBe(text);
      expect(text.endsWith(".")).toBe(true);
    }
  });

  it("says what Inherit does instead wherever that is true", () => {
    for (const id of REFUSAL_IDS) {
      if (id === "cross-subject" || id === "unsupported-number") continue;
      expect(refusalFor(id, "Alex")).toMatch(/I can explain/);
    }
  });

  it("keeps every sentence at or under 25 words", () => {
    for (const id of REFUSAL_IDS) {
      for (const sentence of refusalFor(id, "Alex").split(/(?<=\.)\s+/)) {
        expect(sentence.split(/\s+/).length).toBeLessThanOrEqual(25);
      }
    }
  });
});
