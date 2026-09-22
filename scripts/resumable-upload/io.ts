import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { open, lstat, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { refuse, validateCredentials } from "./contract";
import { serializeReceipt, type ProbeReceipt } from "./receipt";

async function protectedParent(filename: string) {
  if (!path.isAbsolute(filename) || path.normalize(filename) !== filename) refuse();
  const parent = await lstat(path.dirname(filename));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o777) !== 0o700
    || parent.uid !== process.getuid?.()) refuse();
  // Resolve ancestor symlinks (for example macOS /tmp) before ruling out any
  // Git checkout, including linked worktrees whose .git entry is a file.
  let directory = await realpath(path.dirname(filename));
  for (;;) {
    try { await lstat(path.join(directory, ".git")); refuse(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const ancestor = path.dirname(directory);
    if (ancestor === directory) break;
    directory = ancestor;
  }
}

/** Read only a private, owned regular file. No environment or key fallback. */
export async function readCredentials(filename: string, now: number) {
  try {
    await protectedParent(filename);
    const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600
        || stat.uid !== process.getuid?.() || stat.size > 32_768) refuse();
      const buffer = Buffer.alloc(32_769);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 32_768) refuse();
      return validateCredentials(JSON.parse(buffer.subarray(0, bytesRead).toString("utf8")), now);
    } finally { await handle.close(); }
  } catch { return refuse(); }
}

/** Refuse an existing supplied path; later updates replace only our receipt. */
export async function createReceiptWriter(filename: string) {
  try {
    await protectedParent(filename);
    const reservation = await open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    await reservation.close();
    let closed = false, saving = false;
    return {
      async save(receipt: ProbeReceipt) {
        if (closed || saving) refuse();
        saving = true;
        let temporary: string | undefined;
        try {
          const text = serializeReceipt(receipt);
          await protectedParent(filename);
          const current = await lstat(filename);
          if (!current.isFile() || current.nlink !== 1 || (current.mode & 0o777) !== 0o600
            || current.uid !== process.getuid?.()) refuse();
          temporary = path.join(path.dirname(filename), `.receipt-${randomUUID()}.tmp`);
          const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          try { await handle.writeFile(text, { encoding: "utf8" }); await handle.sync(); }
          finally { await handle.close(); }
          // Never truncate the previous durable uncertainty marker. A crash
          // before rename preserves it; a crash afterward leaves a full JSON.
          await rename(temporary, filename);
          temporary = undefined;
          const directory = await open(path.dirname(filename), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
          try { await directory.sync(); } finally { await directory.close(); }
        } catch { refuse(); }
        finally {
          saving = false;
          if (temporary) await unlink(temporary).catch(() => {});
        }
      },
      async close() { if (saving) refuse(); closed = true; },
    };
  } catch { return refuse(); }
}
