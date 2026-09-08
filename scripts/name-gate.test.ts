import { describe, expect, it } from "vitest";
import {
  containsName,
  foldWords,
  scanDenylist,
  scanEvaluativeProximity,
  scanExternalHosts,
} from "./name-gate";

describe("name gate normalization", () => {
  it("finds lowercase domain fragments", () => {
    const denied = ["outside", "genome"].join("");
    const text = ["https", "://outside", "genome.example/results"].join("");
    expect(containsName(text, denied)).toBe(true);
  });

  it("finds camelCase, kebab-case, snake_case, and compact forms", () => {
    const denied = ["outside", "genome"].join(" ");
    for (const text of [
      ["outside", "Genome"].join(""),
      ["outside", "-genome"].join(""),
      ["outside", "_genome"].join(""),
      ["outside", "genome"].join(""),
    ]) {
      expect(containsName(text, denied)).toBe(true);
    }
  });

  it("does not match a short name inside an unrelated longer token", () => {
    expect(containsName("metadata", ["me", "ta"].join(""))).toBe(false);
  });

  it("normalizes identifier and URL punctuation consistently", () => {
    expect(foldWords("OutsideGenome.example_path")).toEqual([
      "outside",
      "genome",
      "example",
      "path",
    ]);
  });

  it("permits a denied provider only inside the narrow directory carve-out", () => {
    const denied = ["outside", "genome"].join("");
    expect(
      scanDenylist(
        `{"name":"${denied}"}`,
        "data/providers/providers.json",
        [denied],
      ),
    ).toEqual([]);
    expect(scanDenylist(denied, "README.md", [denied])).toHaveLength(1);
    expect(
      scanDenylist(denied, "data/providers/providers.json", [denied], "a".repeat(40)),
    ).toHaveLength(1);
  });

  it("finds evaluative provider proximity within the 200-character window", () => {
    const provider = ["Outside", "Genome"].join("");
    const token = ["bet", "ter than"].join("");
    expect(
      scanEvaluativeProximity(
        `${provider}${" ".repeat(150)}is ${token} the rest`,
        "docs/review.md",
        [provider],
        [token],
      ),
    ).toHaveLength(1);
    expect(
      scanEvaluativeProximity(
        `${provider}${" ".repeat(450)}is ${token} the rest`,
        "docs/review.md",
        [provider],
        [token],
      ),
    ).toEqual([]);
  });
});

describe("external hostname classification", () => {
  const allowed = [{ name: "DOI resolver", category: "cited-organisation", aliases: ["doi.org"] }];
  const scan = (text: string) => scanExternalHosts(text, "src/fixture.test.ts", allowed);
  const url = (authority: string) => ["https", "://", authority].join("");

  it.each(["model.synthetic.invalid", "provider.test", "localhost:3100", "[::1]:3100",
    "user:pass@127.0.0.1:45678", "user:pass@inherit.bio", "inherit.bio?query", "inherit.bio#fragment",
    "doi.org:443", "doi\\.org", "localhost:3000,"])("classifies the actual hostname in %s", authority => {
    expect(scan(url(authority))).toEqual([]);
  });

  it.each(["provider.test.unreviewed.com", "doi.org.unreviewed.com", "doi.org@unreviewed.com",
    "unreviewed.com?next=inherit.bio", "unreviewed.com#inherit.bio", "unreviewed.com:443"])(
    "retains unreviewed host detection for %s", authority => {
      expect(scan(url(authority))).toHaveLength(1);
    },
  );

  it("normalizes credentials and literal SQL dots without suppressing unknown hosts", () => {
    expect(scan(url("user:pass@unreviewed.com"))[0].value).toBe("unreviewed.com");
    expect(scan(url("unreviewed\\.com"))[0].value).toBe("unreviewed.com");
    expect(scan(url("unreviewed.com\\@inherit.bio"))).toHaveLength(1);
    expect(scan(url("unreviewed.com\\@sub.inherit.bio"))).toHaveLength(1);
    expect(scan(url("unreviewed.com\\@model.synthetic.invalid"))).toHaveLength(1);
    expect(scan(url("doi.org:invalid"))).toHaveLength(1);
  });

  it("keeps the private denylist independent of reserved hosts and credentials", () => {
    const denied = ["outside", "genome"].join("");
    for (const text of [url(`${denied}.invalid`), url(`${denied}:pass@inherit.bio`), url(`doi.org/${denied}`)]) {
      expect(scan(text)).toEqual([]);
      expect(scanDenylist(text, "src/fixture.test.ts", [denied])).toHaveLength(1);
      expect(scanDenylist(text, "<commit-message>", [denied], "a".repeat(40))).toHaveLength(1);
    }
  });
});
