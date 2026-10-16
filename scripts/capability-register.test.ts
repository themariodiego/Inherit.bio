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

/** The same rows, cell by cell: capability, status, UI state, evidence, open work. */
function capabilityRows(): { capability: string; status: Status; uiState: string; evidence: string; openWork: string }[] {
  return register.split("\n")
    .filter(line => line.startsWith("| "))
    .map(line => line.split("|").map(cell => cell.trim()))
    .filter(cells => (STATUSES as readonly string[]).includes(cells[2] ?? ""))
    .map(cells => ({
      capability: cells[1]!,
      status: cells[2] as Status,
      uiState: cells[3] ?? "",
      evidence: cells[4] ?? "",
      openWork: cells[5] ?? "",
    }));
}

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

  it("names the honest UI state, its evidence and its open work on every shipped-degraded row", () => {
    // G7.4: `shipped-degraded` is only a status when the row names "the honest
    // UI state that communicates the degradation". An empty or dashed cell is
    // a degradation nobody can find.
    const degraded = capabilityRows().filter(row => row.status === "shipped-degraded");
    expect(degraded.length).toBe(statedCount("shipped-degraded"));
    for (const row of degraded) {
      for (const [cell, value] of [["UI state", row.uiState], ["evidence", row.evidence], ["open work", row.openWork]] as const) {
        expect(value.replace(/[—\s-]/g, "").length, `${row.capability} has no ${cell}`).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * Owner decision, 16 October 2026 ("TEST-LOCAL capabilities in the capability
 * register"; brief line 2580): a capability that works end to end under
 * TEST-LOCAL, but is off in production because no real jurisdiction permits
 * it, is `shipped-degraded`, and its row names the jurisdiction-unavailable
 * state production users see. Such a row opens its UI-state cell with the
 * register's marker. These checks hold the marker to the facts it asserts:
 * no real jurisdiction permits the guarding capability, the row quotes the
 * copy production renders for it from `data/jurisdictions.json`, and the
 * browser test it cites exists and pins that copy. If a real jurisdiction
 * ever permits the capability, the row is no longer true and fails here.
 */
describe("jurisdiction-only degradations under the TEST-LOCAL reading", () => {
  const MARKER = "**Production: `jurisdiction-unavailable`.**";
  const DECIDED = ["Embryo ingest", "Embryo quality", "Embryo comparison"];
  const jurisdictions = JSON.parse(readFileSync("data/jurisdictions.json", "utf8")) as {
    capabilities: string[];
    defaultRealJurisdiction: { capabilities: Record<string, { status: string; userFacingCopy: string }> };
    realJurisdictions: Record<string, { capabilities: Record<string, { status: string }> }>;
  };
  const marked = () => capabilityRows().filter(row => row.uiState.startsWith(MARKER));

  it("applies the reading to the three capabilities the decision names, and only as shipped-degraded", () => {
    const names = marked().map(row => row.capability);
    for (const name of DECIDED) expect(names).toContain(name);
    for (const row of marked()) expect(row.status, row.capability).toBe("shipped-degraded");
  });

  it("holds every marked row to its guard, its production copy and its jurisdiction-off browser test", () => {
    expect(marked().length).toBeGreaterThanOrEqual(DECIDED.length);
    for (const row of marked()) {
      const name = row.capability;
      const guards = [...row.uiState.matchAll(/`([a-z_]+)`/g)].map(match => match[1]!)
        .filter(token => jurisdictions.capabilities.includes(token));
      expect(guards.length, `${name} names no capability from data/jurisdictions.json`).toBeGreaterThan(0);
      for (const capability of guards) {
        const real = [
          jurisdictions.defaultRealJurisdiction.capabilities[capability]?.status,
          ...Object.values(jurisdictions.realJurisdictions).map(entry => entry.capabilities[capability]?.status),
        ];
        expect(real.length).toBeGreaterThan(1);
        expect(real.filter(status => status === undefined), `${capability} is undecided somewhere real`).toEqual([]);
        expect(real.filter(status => status === "permitted"), `${capability} is permitted somewhere real`).toEqual([]);
        const copy = jurisdictions.defaultRealJurisdiction.capabilities[capability]!.userFacingCopy;
        expect(copy.trim().length).toBeGreaterThan(0);
        expect(row.uiState, `${name} does not quote the copy production renders for ${capability}`).toContain(`"${copy}"`);
        const specs = [...row.evidence.matchAll(/e2e\/[a-z0-9.-]+\.nojurisdiction\.spec\.ts/g)].map(match => match[0]);
        expect(specs.length, `${name} cites no jurisdiction-off browser test`).toBeGreaterThan(0);
        for (const spec of specs) {
          expect(existsSync(spec), `${name} cites a missing ${spec}`).toBe(true);
          expect(readFileSync(spec, "utf8"), `${spec} does not pin the copy`).toContain(copy);
          expect(readFileSync(spec, "utf8"), `${spec} does not read the state`).toContain('[data-slot="jurisdiction-unavailable"]');
        }
      }
      expect(row.uiState, name).toContain('data-slot="jurisdiction-unavailable"');
      expect(row.uiState, `${name} does not say what TEST-LOCAL delivers`).toContain("**Under TEST-LOCAL**");
    }
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
