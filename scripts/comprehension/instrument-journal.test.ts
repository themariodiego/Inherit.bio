import { afterEach, describe, expect, it } from "vitest";
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { InstrumentJournal } from "./instrument-journal";
import { manifest } from "./conductor-fixtures";

const roots: string[] = [];
async function directory() { const root = await mkdtemp(path.join(tmpdir(), "inherit-instrument-persistence-")); roots.push(root); return root; }
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("durable instrument accounting", () => {
  it("prevents duplicate owners and refuses changed approval or incomplete history on reopen", async () => {
    const root = await directory(), journal = await InstrumentJournal.open(root, 100, 10);
    await expect(InstrumentJournal.open(root, 100, 10)).rejects.toThrow();
    await journal.close();
    await expect(InstrumentJournal.open(root, 200, 10)).rejects.toThrow("approval differs");
    await writeFile(path.join(root, "dry-history.jsonl"), '{"kind":');
    await expect(InstrumentJournal.open(root, 100, 10)).rejects.toThrow("Incomplete history");
  });

  it("requires protected out-of-checkout storage for raw instrument traces", async () => {
    const root = await directory();
    await chmod(root, 0o750);
    await expect(InstrumentJournal.open(root, 100, 0)).rejects.toThrow("Private");
    await chmod(root, 0o700); await writeFile(path.join(root, ".git"), "gitdir: synthetic");
    await expect(InstrumentJournal.open(root, 100, 0)).rejects.toThrow("outside Git");
  });

  it("refuses a linked spend journal without following or modifying its target", async () => {
    const root = await directory(), target = path.join(root, "not-a-journal");
    await writeFile(target, "untouched synthetic data");
    await symlink(target, path.join(root, "dry-spend.jsonl"));
    await expect(InstrumentJournal.open(root, 100, 0)).rejects.toThrow("Invalid instrument spend");
    expect(await readFile(target, "utf8")).toBe("untouched synthetic data");
  });

  it("retains full reservations and exclusive locks after actual owner-process death", async () => {
    const root = await directory(), runner = path.join(root, "crash.mts");
    const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    await writeFile(runner, `import { InstrumentJournal } from ${JSON.stringify(path.join(repository, "scripts/comprehension/instrument-journal.ts"))};
const journal = await InstrumentJournal.open(${JSON.stringify(root)}, 100, 0);
await journal.append({kind:"start",manifest:${JSON.stringify(manifest())}});
await journal.budget.reserve("pending-request",80);
process.on("message",()=>{});
process.send?.({reserved:true});
`);
    const child = fork(runner, [], { cwd: repository, execArgv: ["--import", "tsx"], silent: true });
    let stderr = ""; child.stderr?.on("data", chunk => { stderr += String(chunk); });
    try {
      const outcome = await Promise.race([once(child, "message").then(([message]) => message),
        once(child, "exit").then(() => { throw new Error(`Crash fixture exited before reservation: ${stderr}`); })]);
      expect(outcome).toEqual({ reserved: true });
      const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
      await expect(InstrumentJournal.open(root, 100, 0)).rejects.toThrow();
      expect((await lstat(path.join(root, "dry-history.lock"))).isDirectory()).toBe(true);
      expect((await lstat(path.join(root, "dry-spend.jsonl.lock"))).isDirectory()).toBe(true);
      const entries = (await readFile(path.join(root, "dry-spend.jsonl"), "utf8")).trimEnd().split("\n").map(line => JSON.parse(line));
      expect(entries).toEqual([{ kind: "budget", version: 1, limit: 100, otherCosts: 0 },
        { kind: "reserve", id: "pending-request", maximum: 80 }]);
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
  }, 15_000);
});
