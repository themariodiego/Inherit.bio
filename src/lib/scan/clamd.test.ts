import crypto from "node:crypto";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { clamdScanner, parseClamdAddress, parseClamdVersion, type ClamdAddress } from "./clamd";
import { EICAR_TEST_STRING } from "./test-double-scanner";

/** 28 September 2026, 12:00 UTC. */
const NOW = Date.UTC(2026, 8, 28, 12);
const FRESH_VERSION = "ClamAV 1.4.1/27400/Mon Sep 28 08:12:00 2026";
const STALE_VERSION = "ClamAV 1.4.1/27300/Fri Sep 25 08:12:00 2026";

interface FakeClamd {
  address: ClamdAddress;
  commands: string[];
  streamed: Buffer[];
  close(): Promise<void>;
}

/**
 * A clamd stand-in speaking the real protocol: null-terminated z-commands,
 * INSTREAM as 4-byte big-endian lengths and a zero terminator. It finds the
 * EICAR string the way clamd does, or answers with `reply` when given.
 */
async function fakeClamd(options: { version?: string; reply?: (bytes: Buffer) => string | null } = {}): Promise<FakeClamd> {
  const commands: string[] = [];
  const streamed: Buffer[] = [];
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let command: string | null = null;
    const received: Buffer[] = [];
    socket.on("data", (data: Buffer) => {
      buffer = Buffer.concat([buffer, data]);
      if (command === null) {
        const end = buffer.indexOf(0);
        if (end < 0) return;
        command = buffer.subarray(0, end).toString("utf8");
        commands.push(command);
        buffer = buffer.subarray(end + 1);
        if (command === "zVERSION") {
          socket.end(`${options.version ?? FRESH_VERSION}\0`);
          return;
        }
      }
      if (command !== "zINSTREAM") return;
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        if (length === 0) {
          const bytes = Buffer.concat(received);
          streamed.push(bytes);
          const custom = options.reply?.(bytes);
          if (custom === null) { socket.destroy(); return; }
          const found = bytes.includes(Buffer.from(EICAR_TEST_STRING, "ascii"));
          socket.end(`${custom ?? (found ? "stream: Eicar-Test-Signature FOUND" : "stream: OK")}\0`);
          return;
        }
        if (buffer.length < 4 + length) return;
        received.push(buffer.subarray(4, 4 + length));
        buffer = buffer.subarray(4 + length);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    address: { kind: "tcp", host: "127.0.0.1", port },
    commands,
    streamed,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const servers: FakeClamd[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
async function started(options?: Parameters<typeof fakeClamd>[0]) {
  const server = await fakeClamd(options);
  servers.push(server);
  return server;
}
const sha = (bytes: Uint8Array) => crypto.createHash("sha256").update(bytes).digest("hex");

describe("clamd addresses", () => {
  it.each([
    ["unix:/run/clamav/clamd.ctl", { kind: "unix", path: "/run/clamav/clamd.ctl" }],
    ["tcp:127.0.0.1:3310", { kind: "tcp", host: "127.0.0.1", port: 3310 }],
    ["tcp:localhost:3310", { kind: "tcp", host: "localhost", port: 3310 }],
    ["tcp:[::1]:3310", { kind: "tcp", host: "::1", port: 3310 }],
  ])("reads %s", (value, expected) => {
    expect(parseClamdAddress(value)).toEqual(expected);
  });

  it.each([undefined, "", "clamd", "unix:relative", "tcp:host", "tcp:host:0", "tcp:host:70000", "udp:localhost:3310"])(
    "refuses %s",
    (value) => {
      expect(parseClamdAddress(value)).toBeNull();
    },
  );
});

describe("the signature database clamd reports", () => {
  it("reads the engine, the daily version and its publication time as UTC", () => {
    expect(parseClamdVersion(FRESH_VERSION)).toEqual({
      engine: "ClamAV 1.4.1", version: 27400, publishedAt: new Date(Date.UTC(2026, 8, 28, 8, 12)),
    });
    expect(parseClamdVersion("ClamAV 1.4.1/27400/Mon Sep  7 08:12:00 2026")?.publishedAt)
      .toEqual(new Date(Date.UTC(2026, 8, 7, 8, 12)));
    expect(parseClamdVersion("ClamAV 1.4.1/27400/Mon Sep 28 23:59:59 2026")?.publishedAt)
      .toEqual(new Date(Date.UTC(2026, 8, 28, 23, 59, 59)));
  });

  it.each(["ClamAV 1.4.1", "ClamAV 1.4.1/27400", "ClamAV 1.4.1/0/Mon Sep 28 08:12:00 2026",
    "ClamAV 1.4.1/27400/Mon Foo 28 08:12:00 2026", "ClamAV 1.4.1/27400/Mon Feb 30 08:12:00 2026",
    "ClamAV 1.4.1/27400/Mon Sep 28 24:12:00 2026", "ClamAV 1.4.1/27400/Mon Sep 28 08:60:00 2026",
    "ClamAV 1.4.1/27400/Mon Sep 28 08:99:00 2026", "ClamAV 1.4.1/27400/Mon Sep 28 08:12:60 2026",
    "ClamAV 1.4.1/27400/Mon Sep 28 08:12:99 2026", "OK"])(
    "reads nothing from %s",
    (reply) => {
      expect(parseClamdVersion(reply)).toBeNull();
    },
  );
});

describe("the clamd scanner", () => {
  it("clears only on stream: OK, bound to the SHA-256 of exactly the bytes it streamed", async () => {
    const server = await started();
    const bytes = crypto.randomBytes(200_000);
    const verdict = await clamdScanner({ address: server.address, now: () => NOW }).scan(bytes);
    expect(verdict).toEqual({
      verdict: "OK", sha256: sha(bytes),
      signatures: { engine: "ClamAV 1.4.1", version: 27400, publishedAt: new Date(Date.UTC(2026, 8, 28, 8, 12)) },
    });
    expect(server.commands).toEqual(["zVERSION", "zINSTREAM"]);
    expect(server.streamed[0]!.equals(bytes)).toBe(true);
  });

  it("finds the EICAR test file", async () => {
    const server = await started();
    const bytes = Buffer.from(`%PDF-1.4\n${EICAR_TEST_STRING}\n`, "ascii");
    const verdict = await clamdScanner({ address: server.address, now: () => NOW }).scan(bytes);
    expect(verdict.verdict).toBe("FOUND");
    expect(verdict).toMatchObject({ sha256: sha(bytes) });
    // The signature name is not carried anywhere.
    expect(JSON.stringify(verdict)).not.toContain("Eicar");
  });

  it("fails closed on stale signatures, before a single byte is streamed", async () => {
    const server = await started({ version: STALE_VERSION });
    const verdict = await clamdScanner({ address: server.address, now: () => NOW }).scan(Buffer.from("%PDF-1.4"));
    expect(verdict).toEqual({ verdict: "UNAVAILABLE", reason: "stale-signatures" });
    expect(server.commands).toEqual(["zVERSION"]);
  });

  it("fails closed on signatures dated in the future", async () => {
    const server = await started({ version: "ClamAV 1.4.1/27400/Tue Sep 29 12:00:00 2026" });
    const verdict = await clamdScanner({ address: server.address, now: () => NOW }).scan(Buffer.from("x"));
    expect(verdict).toEqual({ verdict: "UNAVAILABLE", reason: "stale-signatures" });
  });

  it("fails closed when the version cannot be read", async () => {
    const server = await started({ version: "PONG" });
    expect(await clamdScanner({ address: server.address, now: () => NOW }).scan(Buffer.from("x")))
      .toEqual({ verdict: "UNAVAILABLE", reason: "protocol" });
  });

  it.each(["08:60:00", "08:12:60"])("refuses the malformed signature clock %s before streaming", async (clock) => {
    const server = await started({ version: FRESH_VERSION.replace("08:12:00", clock) });
    expect(await clamdScanner({ address: server.address, now: () => NOW }).scan(Buffer.from("%PDF-1.4")))
      .toEqual({ verdict: "UNAVAILABLE", reason: "protocol" });
    expect(server.commands).toEqual(["zVERSION"]);
    expect(server.streamed).toEqual([]);
  });

  it("fails closed when clamd is unreachable", async () => {
    const server = await started();
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    expect(await clamdScanner({ address: server.address, now: () => NOW }).scan(Buffer.from("x")))
      .toEqual({ verdict: "UNAVAILABLE", reason: "unreachable" });
  });

  it.each([
    ["an error", "Can't allocate memory ERROR"],
    ["an OK with more after it", "stream: OK extra"],
    ["an OK for a file", "/tmp/x: OK"],
    ["an empty reply", ""],
  ])("never reads %s as clean", async (_label, reply) => {
    const server = await started({ reply: () => reply });
    expect(await clamdScanner({ address: server.address, now: () => NOW }).scan(Buffer.from("x")))
      .toEqual({ verdict: "UNAVAILABLE", reason: "protocol" });
  });

  it("fails closed when clamd hangs up mid-scan", async () => {
    const server = await started({ reply: () => null });
    expect(await clamdScanner({ address: server.address, now: () => NOW }).scan(Buffer.from("x")))
      .toEqual({ verdict: "UNAVAILABLE", reason: "protocol" });
  });

  it("fails closed when clamd does not answer in time", async () => {
    const silent = net.createServer(() => undefined);
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const port = (silent.address() as net.AddressInfo).port;
    try {
      const verdict = await clamdScanner({ address: { kind: "tcp", host: "127.0.0.1", port }, timeoutMs: 100, now: () => NOW })
        .scan(Buffer.from("x"));
      expect(verdict).toEqual({ verdict: "UNAVAILABLE", reason: "timeout" });
    } finally {
      silent.close();
    }
  });

  it("reads clamd's size-limit error as oversize", async () => {
    const server = await started({ reply: () => "INSTREAM size limit exceeded. ERROR" });
    const bytes = Buffer.from("x");
    expect(await clamdScanner({ address: server.address, now: () => NOW }).scan(bytes))
      .toEqual({ verdict: "OVERSIZE", sha256: sha(bytes) });
  });

  it("does not stream a document over 20,000,000 bytes at all", async () => {
    const server = await started();
    const bytes = Buffer.alloc(20_000_001);
    expect((await clamdScanner({ address: server.address, now: () => NOW }).scan(bytes)).verdict).toBe("OVERSIZE");
    expect(server.commands).toEqual([]);
  });
});
