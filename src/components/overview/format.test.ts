import { describe, expect, it } from "vitest";
import { countNoun, formatDuration, initialOf, pluralise } from "./format";

describe("overview format helpers", () => {
  it("pluralises with an explicit singular", () => {
    expect(countNoun(1, "file", "files")).toBe("1 file");
    expect(countNoun(0, "file", "files")).toBe("0 files");
    expect(countNoun(2, "file", "files")).toBe("2 files");
    expect(pluralise(1, "minute", "minutes")).toBe("minute");
  });

  it("formats measured durations in plain words, never zero of a unit", () => {
    expect(formatDuration(0)).toBe("1 second");
    expect(formatDuration(0.4)).toBe("1 second");
    expect(formatDuration(1)).toBe("1 second");
    expect(formatDuration(40.2)).toBe("40 seconds");
    expect(formatDuration(59.4)).toBe("59 seconds");
    expect(formatDuration(60)).toBe("1 minute");
    expect(formatDuration(89)).toBe("1 minute");
    expect(formatDuration(90)).toBe("2 minutes");
    expect(formatDuration(600)).toBe("10 minutes");
    expect(formatDuration(3600)).toBe("1 hour");
    expect(formatDuration(7500)).toBe("2 hours");
  });

  it("takes the first character of a label for the identity disc", () => {
    expect(initialOf("Maya")).toBe("M");
    expect(initialOf("  éva")).toBe("É");
    expect(initialOf("")).toBe("?");
  });
});
