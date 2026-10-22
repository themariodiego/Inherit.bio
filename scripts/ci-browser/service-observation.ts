import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { types } from "node:util";
import type { Readable } from "node:stream";
import { APP_PORTS, admittedAppEnvironmentNames, checkedAppEnvironment } from "../ci-browser-config";

export const APP_SERVICE_OBSERVATION_PREFIX = "INHERIT_APP_SERVICE_V1 ";
export const APP_SERVICE_OBSERVATION_BYTES = 2048;
export const APP_SERVICE_OBSERVATION_OPTION = "--observe-service";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export interface AppServiceObservation {
  version: 1; port: typeof APP_PORTS[number]; appOrigin: string; appConfigurationSha256: string;
  buildId: string; appPid: number; appStartTicks: string; bootId: string; uid: number; gid: number;
}
function data(value: unknown): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value));
  const proto = Object.getPrototypeOf(value); assert(proto === null || proto === Object.prototype);
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    assert(typeof key === "string");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    assert(descriptor?.enumerable && Object.hasOwn(descriptor, "value")); result[key] = descriptor.value;
  }
  return result;
}
export function scopedAppConfiguration(value: unknown, port: number): Record<string, string> {
  try { return checkedAppEnvironment(data(value), port); }
  catch { throw new Error("Actual scoped app configuration refused"); }
}
export function appConfigurationSha256(value: unknown, port: number): string {
  const env = scopedAppConfiguration(value, port);
  return hash(JSON.stringify(admittedAppEnvironmentNames(port).map(name => [name, env[name]])));
}
export function checkedAppServiceObservation(value: unknown): AppServiceObservation {
  try {
    const x = data(value);
    const keys = ["version", "port", "appOrigin", "appConfigurationSha256", "buildId", "appPid", "appStartTicks", "bootId", "uid", "gid"];
    assert(Object.keys(x).length === keys.length && keys.every(key => Object.hasOwn(x, key)));
    assert(x.version === 1 && APP_PORTS.some(port => port === x.port));
    const port = x.port as typeof APP_PORTS[number];
    assert(typeof x.appOrigin === "string" && x.appOrigin === `http://localhost:${port}` && typeof x.appConfigurationSha256 === "string"
      && /^[a-f0-9]{64}$/.test(x.appConfigurationSha256));
    assert(typeof x.buildId === "string" && x.buildId.length > 0 && x.buildId.length <= 256
      && /^[\x21-\x7e]+$/.test(x.buildId));
    assert(typeof x.appPid === "number" && Number.isSafeInteger(x.appPid) && x.appPid > 0);
    assert(typeof x.appStartTicks === "string" && /^[0-9]{1,20}$/.test(x.appStartTicks));
    assert(typeof x.bootId === "string" && uuid.test(x.bootId));
    assert(typeof x.uid === "number" && Number.isSafeInteger(x.uid) && x.uid > 0
      && typeof x.gid === "number" && Number.isSafeInteger(x.gid) && x.gid > 0);
    return { version: 1, port, appOrigin: x.appOrigin, appConfigurationSha256: x.appConfigurationSha256,
      buildId: x.buildId, appPid: x.appPid, appStartTicks: x.appStartTicks, bootId: x.bootId, uid: x.uid, gid: x.gid };
  } catch { throw new Error("Complete public app service observation refused"); }
}
/** Only public metadata and a complete admitted-order digest cross the pipe. */
export function appServiceObservationLine(value: unknown): string {
  const result = APP_SERVICE_OBSERVATION_PREFIX + JSON.stringify(checkedAppServiceObservation(value));
  assert(Buffer.byteLength(result) < APP_SERVICE_OBSERVATION_BYTES, "Bounded app service observation required");
  return result;
}
/** Unknown ordinary app output is ignored. A malformed observation frame refuses
 * the observation channel; it is never forwarded or accepted as readiness. */
export function readAppServiceObservationLine(line: string): AppServiceObservation | null {
  if (!line.startsWith(APP_SERVICE_OBSERVATION_PREFIX)) return null;
  try {
    assert(Buffer.byteLength(line) < APP_SERVICE_OBSERVATION_BYTES && /^[\x20-\x7e]+$/.test(line));
    const value = checkedAppServiceObservation(JSON.parse(line.slice(APP_SERVICE_OBSERVATION_PREFIX.length)));
    assert(appServiceObservationLine(value) === line); return value;
  } catch { throw new Error("Public app service observation frame refused"); }
}
/** Dedicated additional pipe listener; the original profile diagnostic filter
 * and all app readiness/cleanup remain unchanged. At most one frame qualifies. */
export function collectAppServiceObservation(source: Readable, receive: (value: AppServiceObservation) => void,
  refused: () => void): () => void {
  let bytes: number[] = [], dropping = false, seen = false, invalid = false;
  const fail = () => { if (!invalid) { invalid = true; bytes = []; refused(); } };
  const consume = (chunk: Buffer | string) => {
    if (invalid) return;
    for (const byte of Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) {
      if (byte === 10) {
        if (dropping) {
          if (Buffer.from(bytes).toString("ascii").startsWith(APP_SERVICE_OBSERVATION_PREFIX)) fail();
        } else {
          try {
            const frame = readAppServiceObservationLine(Buffer.from(bytes).toString("utf8"));
            if (frame) { if (seen) { fail(); return; } seen = true; receive(frame); }
          } catch { fail(); return; }
        }
        bytes = []; dropping = false;
      } else if (!dropping) {
        bytes.push(byte); if (bytes.length >= APP_SERVICE_OBSERVATION_BYTES) dropping = true;
      }
    }
  };
  const end = () => { if (Buffer.from(bytes).toString("ascii").startsWith(APP_SERVICE_OBSERVATION_PREFIX)) fail(); };
  source.on("data", consume); source.on("end", end); source.on("error", fail);
  return () => { source.off("data", consume); source.off("end", end); source.off("error", fail); bytes = []; invalid = true; };
}
