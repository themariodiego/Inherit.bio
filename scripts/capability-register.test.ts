import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `docs/capability-register.md` is binding authority for what ships. It drifted
 * because nothing checked it: the stated counts disagreed with its own table,
 * and a row claimed `withheld` with no dossier behind it. These assertions make
 * both a failure rather than a discovery. They check the register against
 * itself and against the filesystem, never against a copy of its numbers here.
 */
const STATUSES = ["shipped", "shipped-degraded", "withheld", "not shipped"] as const;
type Status = (typeof STATUSES)[number];

const register = readFileSync("docs/capability-register.md", "utf8");

function rows(): { capability: string; status: Status; body: string }[] {
  return register.split("\n")
    .filter(line => line.startsWith("| "))
    .map(line => line.split("|").map(cell => cell.trim()))
    .filter(cells => (STATUSES as readonly string[]).includes(cells[2] ?? ""))
    .map(cells => ({ capability: cells[1]!, status: cells[2] as Status, body: cells.slice(3).join(" ") }));
}

/**
 * The counts live in one sentence of the form
 * "Counts on this revision: shipped 7 · shipped-degraded 12 · ... 7."
 * Split it on the separator rather than pattern-matching each label, so
 * "shipped" cannot be read out of "shipped-degraded" or "not shipped".
 */
const statedCounts = new Map<string, number>(
  (/Counts on this revision:([\s\S]*?)\./.exec(register)?.[1] ?? "")
    .split("·")
    .map(part => part.trim().replace(/\s+/g, " "))
    .flatMap(part => {
      const match = /^(.*?) (\d+)$/.exec(part);
      return match ? [[match[1]!, Number(match[2])] as [string, number]] : [];
    }),
);
function statedCount(status: Status): number {
  return statedCounts.get(status) ?? Number.NaN;
}

describe("the capability register", () => {
  it("lists at least one capability under every heading it defines", () => {
    expect(rows().length).toBeGreaterThan(20);
    for (const status of STATUSES) expect(Number.isFinite(statedCount(status))).toBe(true);
  });

  it.each(STATUSES)("states a count for %s that matches its own table", status => {
    expect(statedCount(status)).toBe(rows().filter(row => row.status === status).length);
  });

  it("accounts for every row in the stated counts", () => {
    const stated = STATUSES.reduce((total, status) => total + statedCount(status), 0);
    expect(stated).toBe(rows().length);
  });

  it("backs every withheld capability with a dossier that exists", () => {
    // The register's own rule: a withholding is an evidenced impossibility with
    // a dossier. Ordinary unfinished work is `not shipped`, never `withheld`.
    for (const row of rows().filter(row => row.status === "withheld")) {
      const referenced = [...row.body.matchAll(/docs\/withheld\/[a-z0-9-]+\.md/g)].map(match => match[0]);
      expect(referenced.length, `${row.capability} claims withheld without naming a dossier`).toBeGreaterThan(0);
      for (const path of referenced) {
        expect(existsSync(path), `${row.capability} names a missing dossier ${path}`).toBe(true);
      }
    }
  });

  it("names no capability twice", () => {
    const names = rows().map(row => row.capability);
    expect(new Set(names).size).toBe(names.length);
  });
});

/**
 * The decision index drifted silently: three accepted ADRs existed on disk
 * without a row in `docs/adr/README.md`, which is where a reader looks for the
 * decisions a feature must conform to. An unindexed decision is an invisible
 * one, so make both directions a failure.
 */
describe("the decision index", () => {
  const readme = readFileSync("docs/adr/README.md", "utf8");
  const indexed = [...readme.matchAll(/^\| \[(\d{4})\]\(\.\/([^)]+)\)/gm)]
    .map(match => ({ number: match[1]!, file: match[2]! }));

  it("indexes every decision record on disk", () => {
    const onDisk = readdirSync("docs/adr")
      .filter(name => /^\d{4}-.*\.md$/.test(name)).sort();
    expect(onDisk.length).toBeGreaterThan(20);
    expect(indexed.map(entry => entry.file).sort()).toEqual(onDisk);
  });

  it("points every index row at a file that exists, under its own number", () => {
    for (const { number, file } of indexed) {
      expect(existsSync(`docs/adr/${file}`), `${file} is indexed but missing`).toBe(true);
      expect(file.startsWith(`${number}-`), `${file} is indexed under ${number}`).toBe(true);
    }
  });
});
