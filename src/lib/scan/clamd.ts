import crypto from "node:crypto";
import net from "node:net";
import {
  MAXIMUM_SCANNED_BYTES,
  signaturesFresh,
  type MalwareScanner,
  type ScanSignatures,
  type ScanVerdict,
} from "./malware-scanner";

/**
 * A `MalwareScanner` backed by a clamd daemon the operator runs beside the
 * scan worker (docs/claim-document-scanning.md). It speaks clamd's own
 * protocol over a unix socket or TCP, with null-terminated commands:
 *
 * 1. `zVERSION` names the engine, the signature database version and when
 *    it was published. Signatures older than the freshness bound, or a reply
 *    that cannot be read, end the scan as UNAVAILABLE before any byte moves.
 * 2. `zINSTREAM` streams the bytes in length-prefixed chunks and a
 *    zero-length terminator, and reads one reply.
 *
 * Only the exact reply `stream: OK` is clean. `stream: <name> FOUND` is
 * infected; the signature name is not kept, logged or returned. clamd's own
 * size-limit error is OVERSIZE. Every other reply, a closed socket or a
 * time-out is UNAVAILABLE, so a fault can never read as clean.
 *
 * clamd prints the publication time in its host's local time. Run it with
 * TZ=UTC; this adapter reads the time as UTC.
 */

export type ClamdAddress = { kind: "unix"; path: string } | { kind: "tcp"; host: string; port: number };

/** `unix:/run/clamav/clamd.ctl` or `tcp:127.0.0.1:3310`; null for anything else. */
export function parseClamdAddress(value: string | undefined): ClamdAddress | null {
  if (!value) return null;
  const unix = /^unix:(\/[^\0]{1,200})$/u.exec(value);
  if (unix) return { kind: "unix", path: unix[1]! };
  const tcp = /^tcp:([A-Za-z0-9.-]{1,253}|\[[0-9a-fA-F:]{2,45}\]):(\d{1,5})$/u.exec(value);
  if (tcp) {
    const port = Number(tcp[2]);
    if (port < 1 || port > 65535) return null;
    return { kind: "tcp", host: tcp[1]!.replace(/^\[|\]$/gu, ""), port };
  }
  return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `ClamAV 1.4.1/27400/Mon Sep 28 08:12:00 2026` → the signatures; null when unreadable. */
export function parseClamdVersion(reply: string): ScanSignatures | null {
  const match = /^ClamAV ([0-9][0-9A-Za-z.+-]{0,40})\/([1-9][0-9]{0,9})\/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([A-Z][a-z]{2}) {1,2}([0-9]{1,2}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) ([0-9]{4})$/u
    .exec(reply);
  if (!match) return null;
  const month = MONTHS.indexOf(match[3]!);
  if (month < 0) return null;
  const publishedAt = new Date(Date.UTC(Number(match[8]), month, Number(match[4]), Number(match[5]),
    Number(match[6]), Number(match[7])));
  if (Number.isNaN(publishedAt.getTime()) || publishedAt.getUTCDate() !== Number(match[4])) return null;
  return { engine: `ClamAV ${match[1]}`, version: Number(match[2]), publishedAt };
}

class ClamdFault extends Error {
  constructor(readonly reason: "unreachable" | "protocol" | "timeout") {
    super(reason);
  }
}

const REPLY_LIMIT = 1024;
const STREAM_CHUNK = 64 * 1024;

/** Send one null-terminated command (and optional stream) and read one null-terminated reply. */
function exchange(address: ClamdAddress, command: string, stream: Uint8Array | null, timeoutMs: number,
  signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = address.kind === "unix"
      ? net.createConnection({ path: address.path })
      : net.createConnection({ host: address.host, port: address.port });
    let reply = Buffer.alloc(0);
    let settled = false;
    const finish = (error: ClamdFault | null, value?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      socket.destroy();
      if (error) reject(error);
      else resolve(value!);
    };
    const abort = () => finish(new ClamdFault("timeout"));
    const timer = setTimeout(() => finish(new ClamdFault("timeout")), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    socket.on("error", () => finish(new ClamdFault("unreachable")));
    socket.on("data", (data: Buffer) => {
      reply = Buffer.concat([reply, data]);
      const end = reply.indexOf(0);
      if (end >= 0) finish(null, reply.subarray(0, end).toString("utf8"));
      else if (reply.length > REPLY_LIMIT) finish(new ClamdFault("protocol"));
    });
    socket.on("end", () => finish(new ClamdFault("protocol")));
    socket.on("connect", () => {
      socket.write(`z${command}\0`);
      if (!stream) return;
      for (let offset = 0; offset < stream.length; offset += STREAM_CHUNK) {
        const chunk = stream.subarray(offset, Math.min(offset + STREAM_CHUNK, stream.length));
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length, 0);
        socket.write(length);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}

export interface ClamdScannerOptions {
  address: ClamdAddress;
  timeoutMs?: number;
  now?: () => number;
}

export function clamdScanner(options: ClamdScannerOptions): MalwareScanner {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const now = options.now ?? Date.now;
  return {
    async scan(bytes, signal): Promise<ScanVerdict> {
      const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      if (bytes.length > MAXIMUM_SCANNED_BYTES) return { verdict: "OVERSIZE", sha256 };
      let signatures: ScanSignatures | null;
      try {
        signatures = parseClamdVersion(await exchange(options.address, "VERSION", null, timeoutMs, signal));
      } catch (error) {
        return { verdict: "UNAVAILABLE", reason: error instanceof ClamdFault ? error.reason : "protocol" };
      }
      if (!signatures) return { verdict: "UNAVAILABLE", reason: "protocol" };
      if (!signaturesFresh(signatures.publishedAt, now())) return { verdict: "UNAVAILABLE", reason: "stale-signatures" };
      let reply: string;
      try {
        reply = await exchange(options.address, "INSTREAM", bytes, timeoutMs, signal);
      } catch (error) {
        return { verdict: "UNAVAILABLE", reason: error instanceof ClamdFault ? error.reason : "protocol" };
      }
      if (reply === "stream: OK") return { verdict: "OK", sha256, signatures };
      if (/^stream: \S[^\0\n]{0,200} FOUND$/u.test(reply)) return { verdict: "FOUND", sha256, signatures };
      if (reply === "INSTREAM size limit exceeded. ERROR") return { verdict: "OVERSIZE", sha256 };
      return { verdict: "UNAVAILABLE", reason: "protocol" };
    },
  };
}
