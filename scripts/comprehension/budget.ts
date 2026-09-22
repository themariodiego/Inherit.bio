import { open, mkdir, readFile, rmdir } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

/** Integer millionths of a dollar; never round a request down. */
export interface TokenPrice {
  inputMicroDollarsPerMillion: number;
  outputMicroDollarsPerMillion: number;
}

function nonnegative(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid budget quantity");
}

/** Include every billable output token, including hidden reasoning. No cache discount is assumed. */
export function maximumTokenCost(inputTokens: number, outputTokens: number, price: TokenPrice): number {
  for (const value of [inputTokens, outputTokens, ...Object.values(price)]) nonnegative(value);
  const numerator = BigInt(inputTokens) * BigInt(price.inputMicroDollarsPerMillion)
    + BigInt(outputTokens) * BigInt(price.outputMicroDollarsPerMillion);
  const cost = Number((numerator + BigInt(999_999)) / BigInt(1_000_000));
  nonnegative(cost);
  return cost;
}

type Entry = { kind: "reserve"; id: string; maximum: number }
  | { kind: "settle"; id: string; actual: number };
interface Header { kind: "budget"; version: 1; limit: number; otherCosts: number }

/**
 * One journal covers all participant runs, graders, retries and calibration.
 * The owner process holds an exclusive directory lock until close. A crashed
 * owner's lock is never stolen automatically. Its outstanding reservations
 * remain charged at their maximum until the provider supplies certain usage.
 * Neither answers, credentials nor provider/model identities enter this file.
 */
export class SpendJournal {
  private readonly calls = new Map<string, { maximum: number; actual?: number }>();
  private tail: Promise<unknown> = Promise.resolve();
  private poisoned = false;
  private closed = false;
  private closing = false;

  private constructor(private readonly file: FileHandle, private readonly lock: string,
    private readonly header: Header) {}

  static async open(filename: string, limit: number, otherCosts: number): Promise<SpendJournal> {
    nonnegative(limit); nonnegative(otherCosts);
    if (limit === 0 || otherCosts > limit || !path.isAbsolute(filename)) throw new Error("Invalid budget approval");
    const lock = `${filename}.lock`;
    // EEXIST means another owner or an uncertain prior run. Do not spend.
    await mkdir(lock, { mode: 0o700 });
    let file: FileHandle | undefined;
    try {
      const header: Header = { kind: "budget", version: 1, limit, otherCosts };
      let existing: string | null;
      try { existing = await readFile(filename, "utf8"); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        existing = null;
      }
      file = await open(filename, existing === null ? "ax" : "a", 0o600);
      const journal = new SpendJournal(file, lock, header);
      if (existing === null) {
        await journal.append(header);
      } else {
        if (!existing.endsWith("\n")) throw new Error("Incomplete budget journal; spending stopped");
        const [first, ...entries] = existing.trimEnd().split("\n").map(line => JSON.parse(line));
        if (JSON.stringify(first) !== JSON.stringify(header)) throw new Error("Budget approval differs from the existing journal");
        for (const entry of entries) journal.apply(entry);
      }
      return journal;
    } catch (error) {
      await file?.close();
      await rmdir(lock);
      throw error;
    }
  }

  get remaining(): number {
    return this.header.limit - this.header.otherCosts
      - [...this.calls.values()].reduce((sum, call) => sum + (call.actual ?? call.maximum), 0);
  }

  private apply(entry: Entry): void {
    if (!entry || typeof entry.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(entry.id)) {
      throw new Error("Invalid budget entry");
    }
    if (entry.kind === "reserve") {
      nonnegative(entry.maximum);
      if (entry.maximum === 0 || this.calls.has(entry.id) || entry.maximum > this.remaining) {
        throw new Error("Budget reservation refused");
      }
      this.calls.set(entry.id, { maximum: entry.maximum });
    } else if (entry.kind === "settle") {
      nonnegative(entry.actual);
      const call = this.calls.get(entry.id);
      if (!call || call.actual !== undefined || entry.actual > call.maximum) throw new Error("Uncertain or inconsistent provider charge");
      call.actual = entry.actual;
    } else throw new Error("Unknown budget entry");
  }

  private async append(entry: Entry | Header): Promise<void> {
    await this.file.writeFile(JSON.stringify(entry) + "\n", "utf8");
    await this.file.sync();
  }

  private queue(entry: Entry): Promise<void> {
    if (this.closing) return Promise.reject(new Error("Budget journal is closing"));
    const operation = this.tail.then(async () => {
      if (this.closed || this.poisoned) throw new Error("Budget journal is closed or uncertain");
      // Apply first, persist second, authorize the caller only after fsync.
      // If persistence fails, poison this instance and keep its lock on close.
      try { this.apply(entry); }
      catch (error) {
        // A refused reservation has spent nothing. An inconsistent usage
        // report may describe money already spent: halt instead of retrying.
        if (entry.kind === "settle") this.poisoned = true;
        throw error;
      }
      try { await this.append(entry); }
      catch (error) { this.poisoned = true; throw error; }
    });
    this.tail = operation.catch(() => undefined);
    return operation;
  }

  /** Must resolve before sending a paid request. Never reuse an id for a retry. */
  reserve(id: string, maximum: number): Promise<void> {
    return this.queue({ kind: "reserve", id, maximum });
  }

  /** Call only with certain, complete billable usage. Timeouts keep the full reserve. */
  settle(id: string, actual: number): Promise<void> {
    return this.queue({ kind: "settle", id, actual });
  }

  async close(): Promise<void> {
    this.closing = true;
    await this.tail;
    if (this.closed) return;
    this.closed = true;
    await this.file.close();
    if (!this.poisoned) await rmdir(this.lock);
  }
}
