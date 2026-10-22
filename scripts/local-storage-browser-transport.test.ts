import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chromium } from "@playwright/test";
import { ciRuntimeFailureDiagnostic } from "./ci-browser-runtime-failure";
import { verifyBrowserTransport } from "./local-storage-browser-transport";

vi.mock("@playwright/test", () => ({ chromium: { launch: vi.fn() }, request: { newContext: vi.fn() } }));
afterEach(() => vi.restoreAllMocks());
const canary = "PRIVATE_TRANSPORT_EXCEPTION";
const close = async (server: http.Server) => {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
};
const listen = (server: http.Server, port = 0) => new Promise<void>((resolve, reject) => {
  server.once("error", reject); server.listen(port, "127.0.0.1", resolve);
});

// Real owned ephemeral sockets, injected browser refusals only. These do not
// launch Chromium or qualify a native provider/publication.
describe("closed transport listen and cleanup boundaries", () => {
  function probe(port: number) {
    const server = http.createServer(), originalListen = server.listen.bind(server);
    vi.spyOn(server, "listen").mockImplementation(((_port: number, callback: () => void) =>
      originalListen(port, "127.0.0.1", callback)) as typeof server.listen);
    vi.spyOn(http, "createServer").mockReturnValue(server);
    return server;
  }
  it("retains a real port collision as listen refusal without launching a browser or closing its other owner", async () => {
    const owner = http.createServer(); await listen(owner);
    const address = owner.address(); if (!address || typeof address === "string") throw new Error("Expected owned port");
    const server = probe(address.port); vi.mocked(chromium.launch).mockClear();
    try {
      const error = await verifyBrowserTransport("http://127.0.0.1:45678", () => 0).catch(error => error);
      expect(ciRuntimeFailureDiagnostic(error)).toEqual({ runtimeStage: "transport-listen",
        classification: "setup-refused", exitCode: null, signal: null });
      expect(String(error)).not.toContain("EADDRINUSE");
      expect(chromium.launch).not.toHaveBeenCalled();
      expect(owner.listening).toBe(true); expect(server.listening).toBe(false);
    } finally { await close(server); await close(owner); }
  });
  it("retains the original precise operation and separate uncertain browser cleanup without raw values", async () => {
    const server = probe(0), cleanup = vi.fn(async () => { throw new Error(canary); });
    vi.mocked(chromium.launch).mockResolvedValue({ newContext: async () => { throw new SyntaxError(canary); },
      close: cleanup } as unknown as Awaited<ReturnType<typeof chromium.launch>>);
    try {
      const error = await verifyBrowserTransport("http://127.0.0.1:45678", () => 0).catch(error => error);
      expect(ciRuntimeFailureDiagnostic(error)).toEqual({ runtimeStage: "transport-browser-page",
        classification: "invalid-response", exitCode: null, signal: null,
        cleanupFailure: { runtimeStage: "transport-cleanup", classification: "setup-refused", exitCode: null, signal: null } });
      expect(String(error)).not.toContain(canary); expect(cleanup).toHaveBeenCalledTimes(1);
      // A refused cleanup remains uncertain; the disposable test owner alone
      // disposes this socket after checking the genuine production failure.
      expect(server.listening).toBe(true);
    } finally { await close(server); }
  });
});
