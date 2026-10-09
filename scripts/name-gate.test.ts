import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import externalFixturesRegister from "./name-gate-fixtures.json";
import allowedNames from "../data/allowed-external-names.json";
import {
  containsName,
  foldWords,
  parseCommitMessageRecords,
  scanCommitMessages,
  scanDenylist,
  scanEvaluativeProximity,
  scanExternalHosts,
  validateExternalHostFixtures,
} from "./name-gate";

describe("complete batched commit history", () => {
  const repositories: string[] = [];
  afterEach(() => {
    for (const repository of repositories.splice(0)) {
      fs.rmSync(repository, { recursive: true, force: true });
    }
  });
  const frame = (commit: string, time: string, message: string) =>
    [commit, time, message, ""].join("\0");

  it("retains complete multiline messages and the original trim semantics", () => {
    const message = " \tSubject\n\nSecond paragraph\n\nLast line \n\t";
    expect(parseCommitMessageRecords(frame("a".repeat(40), "123", message)))
      .toEqual([{ commit: "a".repeat(40), timestamp: 123, message: message.trim() }]);
  });

  it.each([
    "", frame("a".repeat(40), "123", "message").slice(0, -1), frame("invalid", "123", "message"),
    frame("a".repeat(40), "not-a-time", "message"),
    frame("a".repeat(40), "9007199254740992", "message"),
    frame("a".repeat(40), "123", "message") + "extra\0",
    frame("a".repeat(40), "123", "message").repeat(2),
  ])("refuses malformed or duplicate history framing", raw => {
    expect(() => parseCommitMessageRecords(raw)).toThrow("Malformed NUL-framed commit history");
  });

  it("keeps merge ancestry beyond an old timestamp and the exact baseline cutoff", () => {
    const repository = fs.mkdtempSync(path.join(os.tmpdir(), "inherit-name-history-"));
    repositories.push(repository);
    const run = (args: string[], input?: string, timestamp = 100) =>
      execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null",
        "-c", "gc.auto=0", "-c", "maintenance.auto=false", ...args], {
        cwd: repository, encoding: "utf8", input,
        env: { ...process.env, GIT_AUTHOR_NAME: "Synthetic fixture", GIT_COMMITTER_NAME: "Synthetic fixture",
          GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
          GIT_AUTHOR_DATE: "@" + timestamp + " +0000", GIT_COMMITTER_DATE: "@" + timestamp + " +0000" },
      }).trim();
    run(["init", "-q"]);
    const tree = run(["mktree"], "");
    const commit = (parents: string[], timestamp: number, message: string) =>
      run(["commit-tree", tree, ...parents.flatMap(parent => ["-p", parent])], message, timestamp);
    const denied = ["outside", "genome"].join("");
    const baseline = commit([], 100, denied + "\n");
    const atCutoff = commit([baseline], 100, denied + "\n");
    const ancestor = commit([atCutoff], 150, ["Subject", "", denied, "Last paragraph", ""].join("\n"));
    const oldParent = commit([ancestor], 90, denied + "\n");
    const target = ["https", "://unreviewed.com/path"].join("");
    const side = commit([baseline], 160, ["Side subject", "", target, "Last paragraph", ""].join("\n"));
    const organisation = ["Synthetic Research", " Institute"].join("");
    const merge = commit([oldParent, side], 170, ["Merge subject", "", organisation, ""].join("\n"));
    run(["update-ref", "HEAD", merge]);

    const records = parseCommitMessageRecords(run(["log", "--full-history", "--no-patch",
      "-z", "--format=%H%x00%ct%x00%B", "HEAD"]));
    expect(new Set(records.map(record => record.commit)))
      .toEqual(new Set([baseline, atCutoff, ancestor, oldParent, side, merge]));
    expect(records.find(record => record.commit === ancestor)?.message)
      .toBe(run(["show", "-s", "--format=%B", ancestor]));
    const result = scanCommitMessages(repository, baseline, [denied], []);
    expect(result.commitCount).toBe(3);
    expect(result.findings).toHaveLength(3);
    expect(result.findings).toEqual(expect.arrayContaining([
      { rule: "denylist", path: "<commit-message>", line: 3, value: denied, commit: ancestor },
      { rule: "external-host", path: "<commit-message>", line: 3, value: "unreviewed.com", commit: side },
      { rule: "organisation-shape", path: "<commit-message>", line: 3, value: organisation, commit: merge },
    ]));
  });
});

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
    ["NCRAD APOE joint-marker chart", "ncrad.iu.edu/bank-samples/apoe-genotyping/", "apoe"],
    ["JAMA APOE meta-analysis abstract", "jamanetwork.com/journals/jama/article-abstract/418446", "apoe"],
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


describe("exact negative-test external-host declarations", () => {
  const fixtures = externalFixturesRegister.externalHostFixtures;
  const declaredPath = "scripts/keyless-review-origin-audit.test.ts";
  const scan = (text: string, file = declaredPath) => scanExternalHosts(text, file, [], fixtures);

  it("registers only the two genuine unchanged privacy refusal literals", () => {
    expect(fixtures).toHaveLength(2);
    expect(fixtures.map(row => row.path)).toEqual([declaredPath, declaredPath]);
    expect(fixtures.map(row => new URL(row.url).pathname)).toEqual(["/collect", "/pay"]);
    expect(validateExternalHostFixtures(fixtures, process.cwd())).toEqual({ fixtures, failures: [] });
  });

  it.each(fixtures)("classifies only the exact quoted test literal $url", fixture => {
    expect(scan(`push(${JSON.stringify(fixture.url)});`)).toEqual([]);
    expect(scan(`<form action=${JSON.stringify(fixture.url)}></form>`)).toEqual([]);
    for (const file of ["src/privacy.ts", "e2e/network-audit.spec.ts", "scripts/another.test.ts",
      "docs/review.md", "<commit-message>", `${declaredPath}.bak`]) {
      expect(scan(JSON.stringify(fixture.url), file)).toHaveLength(1);
    }
    const url = new URL(fixture.url);
    for (const other of [url.origin, `${fixture.url}/other`, `${fixture.url}?query=1`, `${fixture.url}#fragment`,
      fixture.url.replace(url.hostname, `sub.${url.hostname}`), fixture.url.replace(url.hostname, `${url.hostname}.unreviewed.com`),
      fixture.url.replace(url.hostname, `${url.hostname}@unreviewed.com`), fixture.url.replace("https:", "http:")]) {
      expect(scan(JSON.stringify(other))).toHaveLength(1);
    }
    expect(scan(fixture.url)).toHaveLength(1);
    expect(scan(`'${fixture.url}'`)).toHaveLength(1);
    expect(scanExternalHosts(JSON.stringify(fixture.url), declaredPath, [])).toHaveLength(1);
  });

  it("permits only the exact structured declaration line in the fixture register", () => {
    for (const fixture of fixtures) {
      expect(scan(`      "url": ${JSON.stringify(fixture.url)},`, "scripts/name-gate-fixtures.json")).toEqual([]);
      expect(scan(`"reason": ${JSON.stringify(fixture.url)},`, "scripts/name-gate-fixtures.json")).toHaveLength(1);
      expect(scan(`push(${JSON.stringify(fixture.url)});`, "scripts/name-gate-fixtures.json")).toHaveLength(1);
    }
  });

  it("retains the private denylist for each declared literal, path and commit", () => {
    for (const fixture of fixtures) {
      const denied = new URL(fixture.url).hostname;
      const text = JSON.stringify(fixture.url);
      expect(scan(text)).toEqual([]);
      expect(scanDenylist(text, declaredPath, [denied])).toHaveLength(1);
      expect(scanDenylist(text, "<commit-message>", [denied], "a".repeat(40))).toHaveLength(1);
    }
  });

  it("fails closed on missing, malformed, broad, duplicate and orphan declarations", () => {
    expect(validateExternalHostFixtures(undefined, process.cwd())).toEqual({ fixtures: [], failures: [] });
    const valid = fixtures[0];
    for (const malformed of [null, {}, "*", [null], [{}], [{ ...valid, extra: "allowed" }],
      [{ ...valid, path: "src/privacy.ts" }], [{ ...valid, path: "scripts/*.test.ts" }],
      [{ ...valid, path: "../outside.test.ts" }], [{ ...valid, path: "scripts/nonexistent.test.ts" }],
      [{ ...valid, url: new URL(valid.url).origin }], [{ ...valid, url: `${valid.url}?query=1` }],
      [{ ...valid, url: valid.url.replace("https:", "http:") }], [{ ...valid, reason: "short" }],
      [{ ...valid, reason: "substantive reason\nwith second line" }], [valid, valid],
      [valid, { ...valid, url: `${valid.url}/missing-literal` }]]) {
      const result = validateExternalHostFixtures(malformed, process.cwd());
      expect(result.failures.length).toBeGreaterThan(0);
      expect(result.fixtures).toEqual([]);
    }
  });
});

describe("the registered isolated scanner instructions", () => {
  it("admits the reviewed path while retaining unrelated-host and private-name refusals", () => {
    const entry = allowedNames.entries.find(row => row.name === "ClamAV");
    expect(entry).toBeDefined();
    const allowed = [entry!];
    const target = (suffix: string) => ["https", "://docs.clamav.net", suffix].join("");
    const reviewed = target("/manual/Installing/Docker.html");
    expect(scanExternalHosts(reviewed, "docs/claim-scanner-real-proof.md", allowed)).toEqual([]);
    for (const suffix of ["", "/manual/Usage/Scanning.html", "/manual/Installing/Other.html"]) {
      expect(scanExternalHosts(target(suffix), "src/fixture.test.ts", allowed)).toHaveLength(1);
    }
    const lookalike = ["https", "://docs.clamav.net", ".unreviewed.com/manual/Installing/Docker.html"].join("");
    expect(scanExternalHosts(lookalike, "src/fixture.test.ts", allowed)).toHaveLength(1);
    const denied = ["outside", "genome"].join("");
    const text = `${reviewed}?note=${denied}`;
    expect(scanExternalHosts(text, "src/fixture.test.ts", allowed)).toEqual([]);
    expect(scanDenylist(text, "src/fixture.test.ts", [denied])).toHaveLength(1);
    expect(scanDenylist(text, "<commit-message>", [denied], "a".repeat(40))).toHaveLength(1);
  });
});
