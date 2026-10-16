/** Fixed public metadata probes. No credentials, app env, raw logs, user rows,
 * provider calls or state-producing SQL are read. Only the runtime owner can
 * execute these through the already-owned disposable container handle. */
export const ACTIVE_APP_PROCESS_OBSERVATION = String.raw`
import assert from "node:assert/strict";
import { readFileSync, readlinkSync, readdirSync } from "node:fs";
const pid = process.argv[1], port = process.argv[2];
assert(/^[1-9][0-9]{0,9}$/.test(pid) && /^310[0-5]$/.test(port));
const root = "/proc/" + pid;
const before = readFileSync(root + "/stat", "utf8");
const fields = before.slice(before.lastIndexOf(") ") + 2).trim().split(/\s+/);
assert(fields.length >= 20 && /^[0-9]{1,20}$/.test(fields[19]));
const status = readFileSync(root + "/status", "utf8");
const uids = status.match(/^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/m);
const gids = status.match(/^Gid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/m);
assert(uids && gids && process.getuid() > 0 && process.getgid() > 0);
assert(uids.slice(1).every(value => Number(value) === process.getuid())
  && gids.slice(1).every(value => Number(value) === process.getgid()) && /^CapEff:\s+0+$/m.test(status));
const cwd = readlinkSync(root + "/cwd"), executable = readlinkSync(root + "/exe");
assert(cwd === "/app" && executable === "/usr/local/bin/node");
const descriptors = readdirSync(root + "/fd"); assert(descriptors.length <= 4096);
const socketInodes = new Set(descriptors.map(fd => readlinkSync(root + "/fd/" + fd)).map(link => link.match(/^socket:\[(\d+)\]$/)?.[1]).filter(Boolean));
const hexPort = Number(port).toString(16).toUpperCase().padStart(4, "0");
const listening = ["/proc/net/tcp", "/proc/net/tcp6"].some(file => readFileSync(file, "utf8").split("\n").slice(1).some(line => {
  const columns = line.trim().split(/\s+/);
  return columns[1]?.endsWith(":" + hexPort) && columns[3] === "0A" && socketInodes.has(columns[9]);
}));
const after = readFileSync(root + "/stat", "utf8");
assert(listening && after.slice(after.lastIndexOf(") ") + 2).trim().split(/\s+/)[19] === fields[19]);
process.stdout.write(JSON.stringify({ appPid: Number(pid), appStartTicks: fields[19],
  bootId: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(), uid: process.getuid(), gid: process.getgid(), cwd, executable, listening }) + "\n");
`;
export const ACTIVE_NATIVE_DATABASE_OBSERVATION = `begin isolation level repeatable read read only;
set local statement_timeout='45s';set local lock_timeout='250ms';
select jsonb_build_object('systemIdentifier',s.system_identifier::text,'databaseOid',d.oid::integer,
 'databaseName',current_database(),'readOnly',current_setting('transaction_read_only')='on')
from pg_catalog.pg_control_system() s join pg_catalog.pg_database d on d.datname=current_database();
rollback;`;
