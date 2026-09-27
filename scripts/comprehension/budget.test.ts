import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { maximumTokenCost, SpendJournal } from "./budget";

const directories: string[] = [];
const journals: SpendJournal[] = [];
async function fixture(limit = 50_000_000, otherCosts = 5_000_000) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "inherit-comprehension-budget-"));
  directories.push(directory);
  const filename = path.join(directory, "spend.jsonl");
  const journal = await SpendJournal.open(filename, limit, otherCosts);
  journals.push(journal);
  return { filename, journal };
}
afterEach(async () => {
  for (const journal of journals.splice(0)) await journal.close();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("comprehension spending stops at the approved cumulative cap", () => {
  it("rounds fractional microdollars up and charges all output tokens", () => {
    const prices = { inputMicroDollarsPerMillion: 350_000, outputMicroDollarsPerMillion: 750_000 };
    expect(maximumTokenCost(1, 1, prices)).toBe(2);
    expect(maximumTokenCost(1_000_000, 2_000_000, prices)).toBe(1_850_000);
    expect(() => maximumTokenCost(-1, 1, prices)).toThrow();
    expect(() => maximumTokenCost(1, 1, { ...prices, outputMicroDollarsPerMillion: NaN })).toThrow();
  });

  it("reserves other costs and refuses a call before spending beyond the cap", async () => {
    const { journal, filename } = await fixture();
    await journal.reserve("first", 45_000_000);
    expect(journal.remaining).toBe(0);
    await expect(journal.reserve("too-much", 1)).rejects.toThrow("refused");
    expect((await readFile(filename, "utf8")).split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("serializes concurrent reservations so they cannot both use the same balance", async () => {
    const { journal } = await fixture(100, 0);
    const attempts = await Promise.allSettled([journal.reserve("a", 70), journal.reserve("b", 70)]);
    expect(attempts.map(value => value.status)).toEqual(["fulfilled", "rejected"]);
    expect(journal.remaining).toBe(30);
  });

  it("holds an uncertain call at its maximum across process restarts", async () => {
    const { journal, filename } = await fixture(100, 10);
    await journal.reserve("timed-out", 80);
    await journal.close();
    const resumed = await SpendJournal.open(filename, 100, 10); journals.push(resumed);
    expect(resumed.remaining).toBe(10);
    await expect(resumed.reserve("retry", 80)).rejects.toThrow("refused");
    await expect(resumed.reserve("timed-out", 1)).rejects.toThrow("refused");
  });

  it("releases unused reserve only once after certain usage is recorded", async () => {
    const { journal, filename } = await fixture(100, 10);
    await journal.reserve("a", 80);
    await journal.settle("a", 20);
    expect(journal.remaining).toBe(70);
    await journal.close();
    const resumed = await SpendJournal.open(filename, 100, 10); journals.push(resumed);
    expect(resumed.remaining).toBe(70);
    await expect(resumed.settle("a", 0)).rejects.toThrow("inconsistent");
    await expect(resumed.reserve("must-stop", 1)).rejects.toThrow("uncertain");
  });

  it("does not turn unknown or larger charges into a refund", async () => {
    const { journal } = await fixture(100, 0);
    await journal.reserve("a", 80);
    await expect(journal.settle("a", 90)).rejects.toThrow();
    expect(journal.remaining).toBe(20);
    await expect(journal.reserve("must-stop", 1)).rejects.toThrow("uncertain");
  });

  it("prevents a second process opening the same spending journal", async () => {
    const { filename } = await fixture();
    await expect(SpendJournal.open(filename, 50_000_000, 5_000_000)).rejects.toThrow();
  });

  it("refuses an increased limit or a lower non-inference reserve on restart", async () => {
    const { journal, filename } = await fixture(100, 10);
    await journal.close();
    await expect(SpendJournal.open(filename, 200, 10)).rejects.toThrow("approval differs");
    await expect(SpendJournal.open(filename, 100, 0)).rejects.toThrow("approval differs");
  });

  it("refuses truncated or corrupt journals instead of resetting the balance", async () => {
    const { journal, filename } = await fixture(100, 0);
    await journal.close();
    await writeFile(filename, '{"kind":"budget"');
    await expect(SpendJournal.open(filename, 100, 0)).rejects.toThrow("Incomplete");
    await writeFile(filename, '{"kind":"budget","version":1,"limit":100,"otherCosts":0}\n{"kind":"reserve","id":"a","maximum":101}\n');
    await expect(SpendJournal.open(filename, 100, 0)).rejects.toThrow("refused");
  });
});
