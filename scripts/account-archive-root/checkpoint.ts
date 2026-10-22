import { constants, chownSync, closeSync, fstatSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const count = z.number().int().nonnegative().safe();
const allocations = z.object({ count: count.positive(), written: count, disposed: count, absent: count, deleted: count,
  identitySha256: hash, deadlinePassed: z.boolean(), stopped: z.boolean(), cleanupDue: z.boolean() }).strict();
export const rootAccountArchiveCheckpointSchema = z.object({
  version: z.literal("account-archive-root-delivery-checkpoint-v1"), accountId: uuid,
  delivery: z.object({ version: z.literal("account-archive-test-delivery-proof-v1"),
    admission: z.object({ version: z.literal("account-archive-test-fixture-admission-v1"), configurationSha256: hash,
      accountJobs: z.literal(0), liveDownloads: z.literal(0), undisposedAllocations: z.literal(0) }).strict(),
    exportId: uuid, attemptId: uuid, expiresAt: z.iso.datetime({ offset: true }), sizeBytes: count.positive(),
    sha256: hash, captureSha256: hash, allocations,
  }).strict(),
}).strict().superRefine((value, context) => {
  const bag = value.delivery.allocations;
  if (bag.written !== bag.count || bag.disposed !== 0 || bag.absent !== 0 || bag.deleted !== 0)
    context.addIssue({ code: "custom", message: "Incomplete actual delivery allocation bag" });
});
export type RootAccountArchiveCheckpoint = z.infer<typeof rootAccountArchiveCheckpointSchema>;
const unavailable = () => new Error("root_account_archive_checkpoint_unavailable");
export function parseRootAccountArchiveCheckpoint(value: unknown): RootAccountArchiveCheckpoint {
  const parsed = rootAccountArchiveCheckpointSchema.safeParse(value);
  if (!parsed.success) throw unavailable();
  return parsed.data;
}

// This fixed synthetic proof file contains no credential, source bytes, cookie,
// URL or account address. It grants no authority: the later helper recaptures
// the complete native allocation bag before the original disposal operation.
function location() {
  const uid = process.getuid?.(), gid = process.getgid?.();
  if (!uid || gid === undefined) throw unavailable();
  const root = realpathSync(process.cwd());
  const parent = path.dirname(root);
  if (realpathSync(parent) !== parent) throw unavailable();
  // A fixed sibling of this exact checkout survives test/build output cleanup.
  // mkdir below still refuses every existing obligation; no override/adoption.
  const directory = path.join(parent, `.${path.basename(root)}-account-archive-root-obligation`);
  return { uid, gid, directory, filename: path.join(directory, "checkpoint.json") };
}
export function saveRootAccountArchiveCheckpoint(value: unknown): void {
  const parsed = parseRootAccountArchiveCheckpoint(value);
  const bytes = Buffer.from(JSON.stringify(parsed) + "\n");
  if (bytes.length > 8192) throw unavailable();
  const target = location();
  mkdirSync(target.directory, { mode: 0o700 }); // Existing obligation refuses; never overwrite/adopt it.
  chownSync(target.directory, target.uid, target.gid);
  const directory = statSync(target.directory);
  if (realpathSync(target.directory) !== target.directory || !directory.isDirectory()
    || directory.uid !== target.uid || directory.gid !== target.gid || (directory.mode & 0o777) !== 0o700) throw unavailable();
  writeFileSync(target.filename, bytes, { mode: 0o600, flag: "wx" });
}
export function readRootAccountArchiveCheckpoint(): RootAccountArchiveCheckpoint {
  let fd: number | undefined;
  try {
    const target = location(), directory = statSync(target.directory);
    if (realpathSync(target.directory) !== target.directory || !directory.isDirectory()
      || directory.uid !== target.uid || directory.gid !== target.gid || (directory.mode & 0o777) !== 0o700) throw unavailable();
    fd = openSync(target.filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.uid !== target.uid || before.gid !== target.gid
      || (before.mode & 0o777) !== 0o600 || before.size < 1 || before.size > 8192) throw unavailable();
    const bytes = readFileSync(fd), after = fstatSync(fd);
    if (bytes.length !== before.size || before.dev !== after.dev || before.ino !== after.ino
      || before.uid !== after.uid || before.gid !== after.gid || before.mode !== after.mode
      || before.nlink !== after.nlink || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw unavailable();
    const text = bytes.toString("utf8");
    if (!Buffer.from(text).equals(bytes)) throw unavailable();
    return parseRootAccountArchiveCheckpoint(JSON.parse(text));
  } catch { throw unavailable(); }
  finally { if (fd !== undefined) closeSync(fd); }
}
