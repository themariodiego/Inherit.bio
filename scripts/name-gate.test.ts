import { describe, expect, it } from "vitest";
import allowedNames from "../data/allowed-external-names.json";
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

  it("admits a path-scoped alias only on a line that carries the path", () => {
    // Allowing a shared host allows everything served from it. A bucket alias
    // has to admit its own bucket and refuse the rest of the host, or the
    // entry is not an allowlist.
    const bucket = [{
      name: "public dataset bucket",
      category: "public-reference-dataset",
      aliases: ["storage.unreviewed.com/public--dataset"],
    }];
    const withBucket = (text: string) =>
      scanExternalHosts(text, "src/fixture.test.ts", bucket);
    expect(withBucket(url("storage.unreviewed.com/public--dataset/release/file.vcf.bgz"))).toEqual([]);
    expect(withBucket(url("storage.unreviewed.com/someone-elses-bucket/file"))).toHaveLength(1);
    expect(withBucket(url("storage.unreviewed.com"))).toHaveLength(1);
    // A bare host alias is unchanged: it still admits the whole host.
    expect(scan(url("doi.org/10.1000/anything"))).toEqual([]);
  });

  it("keeps the private denylist independent of reserved hosts and credentials", () => {
    const denied = ["outside", "genome"].join("");
    for (const text of [url(`${denied}.invalid`), url(`${denied}:pass@inherit.bio`), url(`doi.org/${denied}`)]) {
      expect(scan(text)).toEqual([]);
      expect(scanDenylist(text, "src/fixture.test.ts", [denied])).toHaveLength(1);
      expect(scanDenylist(text, "<commit-message>", [denied], "a".repeat(40))).toHaveLength(1);
    }
  });

  it.each([
    ["University of Zurich pharmacology archive",
      "pharma.uzh.ch/dam/jcr:00000000-2992-0cf5-0000-000020c5cb44/Retey_Clin_Pharmacol_Ther_2007.pdf",
      "adora2a"],
    ["UK Cancer Genetics Group paper archive", "ukcgg.org/media/12580/insight-apc-pi1307k.pdf", "apc"],
    ["Institute of Cancer Research paper repository",
      "repository.icr.ac.uk/server/api/core/bitstreams/99e2e771-711d-4bdd-b509-f58f0a8610f1/content", "apc"],
    ["Nature FGFR2 paper supplement", "nature.com/articles/nature05887#MOESM272", "fgfr2"],
  ])("registers only the reviewed path for %s and retains private-name refusal", (name, paper, review) => {
    const entry = allowedNames.entries.find(row => row.name === name)!;
    expect(entry.category).toBe("cited-organisation");
    expect(entry.aliases).toEqual([paper]);
    expect(entry.evidence).toContain(`docs/sources/reviews/${review}-correction-20260923.md`);
    expect(scanExternalHosts(url(`www.${paper}`), "docs/source-review.md", [entry])).toEqual([]);
    const host = paper.split("/")[0];
    for (const other of [host, `${host}/unreviewed-paper.pdf`, `${host}.unreviewed.com`]) {
      expect(scanExternalHosts(url(other), "docs/source-review.md", [entry])).toHaveLength(1);
    }
    const denied = ["outside", "genome"].join("");
    const text = `${url(`www.${paper}`)} ${denied}`;
    expect(scanExternalHosts(text, "docs/source-review.md", [entry])).toEqual([]);
    expect(scanDenylist(text, "docs/source-review.md", [denied])).toHaveLength(1);
  });
});
