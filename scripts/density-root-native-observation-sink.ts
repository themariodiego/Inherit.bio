import assert from "node:assert/strict";
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, readSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { densityNativeObservationSchema } from "./density-root-native-observers";

const publicObservationSchema = z.object({ version: z.literal(1), routeId: z.string().regex(/^[a-z0-9.-]{1,128}$/u),
  state: z.string().regex(/^[a-z0-9-]{1,128}$/u), fixtureSourceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  runtimeSha256: z.string().regex(/^[a-f0-9]{64}$/u), appConfigurationSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  native: densityNativeObservationSchema }).strict();

/** Root creates ONE fresh empty directory before the approved invocation.
 * This sink only saves the already-validated public vector; it acquires no
 * credentials, native owner or runtime and emits no stderr/private payload. */
export function createDensityPublicObservationSink(directory: string) {
  assert(path.isAbsolute(directory) && path.resolve(directory) === directory && realpathSync(directory) === directory
    && process.getuid && process.getgid && process.getuid() > 0 && process.getgid() > 0);
  const before = lstatSync(directory);
  assert(before.isDirectory() && !before.isSymbolicLink() && (before.mode & 0o777) === 0o700
    && before.uid === process.getuid() && before.gid === process.getgid() && readdirSync(directory).length === 0);
  let count = 0;
  return async (input: z.infer<typeof publicObservationSchema>) => {
    try {
      const current = lstatSync(directory);
      assert(current.isDirectory() && !current.isSymbolicLink() && current.dev === before.dev && current.ino === before.ino
        && current.uid === before.uid && current.gid === before.gid && (current.mode & 0o777) === 0o700);
      const value = publicObservationSchema.parse(input), bytes = Buffer.from(JSON.stringify(value) + "\n");
      assert(bytes.length <= 32_768 && ++count <= 10_000);
      const file = path.join(directory, `native-${String(count).padStart(6, "0")}.json`);
      const fd = openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
      try {
        writeFileSync(fd, bytes); fsyncSync(fd);
        const saved = fstatSync(fd); assert(saved.isFile() && saved.nlink === 1 && saved.uid === before.uid && saved.gid === before.gid
          && (saved.mode & 0o777) === 0o600 && saved.size === bytes.length);
        const copy = Buffer.alloc(bytes.length); let offset = 0;
        while (offset < copy.length) {
          const got = readSync(fd, copy, offset, copy.length - offset, offset); assert(got > 0); offset += got;
        }
        assert(copy.equals(bytes) && readSync(fd, Buffer.alloc(1), 0, 1, bytes.length) === 0);
      } finally { closeSync(fd); }
      const after = lstatSync(directory);
      assert(after.dev === before.dev && after.ino === before.ino && after.uid === before.uid && after.gid === before.gid
        && (after.mode & 0o777) === 0o700);
    } catch { throw new Error("Actual public native observation custody refused"); }
  };
}
