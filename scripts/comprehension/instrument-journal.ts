import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rmdir } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { SpendJournal } from "./budget";
import { RunHistory, type HistoryEvent } from "./run-history";

async function privateDirectory(directory: string) {
  if (!path.isAbsolute(directory)) throw new Error("Absolute instrument directory required");
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700
    || stat.uid !== process.getuid?.()) throw new Error("Private instrument directory required");
  for (let current = await realpath(directory); ; current = path.dirname(current)) {
    try { await lstat(path.join(current, ".git")); throw new Error("Instrument evidence must stay outside Git"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (path.dirname(current) === current) break;
  }
}

/** Dry accounting only, separate from the owner's real expense journal.
 * History and spending share one fixed directory across every dry run/retry. */
export class InstrumentJournal {
  readonly history = new RunHistory();
  private poisoned = false;
  private closed = false;
  private closing = false;
  private tail: Promise<unknown> = Promise.resolve();
  private constructor(private file: FileHandle, private lock: string, readonly budget: SpendJournal) {}

  static async open(directory: string, limit: number, otherCosts: number) {
    await privateDirectory(directory);
    if (limit > 50_000_000) throw new Error("Instrument cap exceeds approved maximum");
    const lock = path.join(directory, "dry-history.lock"), filename = path.join(directory, "dry-history.jsonl");
    await mkdir(lock, { mode: 0o700 });
    let file: FileHandle | undefined, budget: SpendJournal | undefined;
    try {
      let existing = "";
      try {
        const stat = await lstat(filename);
        if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid?.()) throw new Error("Invalid history file");
        existing = await readFile(filename, "utf8");
        if (!existing.endsWith("\n")) throw new Error("Incomplete history; manual reconciliation required");
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      file = await open(filename, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
      const spendFile = path.join(directory, "dry-spend.jsonl");
      try {
        const stat = await lstat(spendFile);
        if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid?.()) throw new Error("Invalid instrument spend file");
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      budget = await SpendJournal.open(spendFile, limit, otherCosts);
      const journal = new InstrumentJournal(file, lock, budget);
      const header = JSON.stringify({ kind: "instrument-only-history", version: 1 });
      if (existing) {
        const [first, ...lines] = existing.trimEnd().split("\n");
        if (first !== header) throw new Error("History is not an instrument journal");
        lines.forEach(line => journal.history.apply(JSON.parse(line)));
      } else { await file.writeFile(header + "\n", "utf8"); await file.sync(); }
      const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await parent.sync(); } finally { await parent.close(); }
      return journal;
    } catch (error) { await file?.close(); await budget?.close(); await rmdir(lock); throw error; }
  }

  append(event: HistoryEvent): Promise<void> {
    if (this.closing) return Promise.reject(new Error("Instrument journal is closing"));
    const operation = this.tail.then(async () => {
      if (this.closed || this.poisoned) throw new Error("Instrument journal unavailable");
      const accepted = this.history.apply(event);
      try { await this.file.writeFile(JSON.stringify(accepted) + "\n", "utf8"); await this.file.sync(); }
      catch { this.poisoned = true; throw new Error("Instrument history persistence uncertain"); }
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }

  async close() {
    this.closing = true;
    await this.tail;
    if (this.closed) return;
    this.closed = true;
    await this.file.close(); await this.budget.close();
    if (!this.poisoned && !this.history.unfinished && !this.history.resourceStopRequired) await rmdir(this.lock);
  }
}
