import http from "node:http";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import bindings from "./bindings.json";
import { createFreshComprehensionBrowser } from "./fresh-t6-browser";

const injected = vi.hoisted(() => ({ storage: vi.fn(), runtime: vi.fn(), configuration: vi.fn(), closeStack: vi.fn() }));
vi.mock("./fresh-t6-resources", async importOriginal => ({
  ...await importOriginal<typeof import("./fresh-t6-resources")>(),
  actualResourceIO: { command: async () => "" },
  infrastructureChildEnvironment: () => ({}),
  acquireFreshStack: async () => ({ keys: {}, close: injected.closeStack }),
}));
vi.mock("../ci-browser-runtime", () => ({ startCiBrowserRuntime: injected.runtime }));
vi.mock("../local-storage-browser-proxy", () => ({ startLocalStorageProxy: injected.storage }));
vi.mock("./fresh-t6-app-environment", () => ({ freshT6AppEnvironments: injected.configuration }));
afterEach(() => vi.restoreAllMocks());
const close = (server: http.Server) => new Promise<void>(resolve => server.close(() => resolve()));
const listen = (server: http.Server, port = 0) => new Promise<void>((resolve, reject) => {
  server.once("error", reject); server.listen(port, "127.0.0.1", resolve);
});

it("settles the real transport port before runtime reservation and keeps both mandatory before app configuration", async () => {
  const allocation = http.createServer(); await listen(allocation);
  const address = allocation.address(); if (!address || typeof address === "string") throw new Error("Expected owned port");
  await close(allocation);
  const transport = http.createServer(), runtime = http.createServer(), events: string[] = [];
  injected.storage.mockImplementation(async () => {
    await listen(transport, address.port); events.push("transport-listen");
    await close(transport); events.push("transport-settled");
    return { url: "http://127.0.0.1:45678", close: async () => { events.push("storage-close"); } };
  });
  injected.runtime.mockImplementation(async () => {
    await listen(runtime, address.port); events.push("runtime-reserved");
    return { env: {}, stop: () => { events.push("runtime-stop"); runtime.close(); } };
  });
  injected.configuration.mockImplementation(() => { events.push("configuration"); throw new Error("Injected pre-app stop"); });
  injected.closeStack.mockImplementation(async () => { events.push("stack-close"); });
  const diagnostics: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => { diagnostics.push(String(chunk)); return true; });
  const task = bindings.tasks.find(task => task.id === "T6")!;
  try {
    await expect(createFreshComprehensionBrowser()({ id: randomUUID(), taskId: "T6", account: task.account,
      fixtures: task.fixtures }, new AbortController().signal)).rejects.toThrow("Fresh comprehension setup refused");
    expect(events).toEqual(["transport-listen", "transport-settled", "runtime-reserved", "configuration",
      "storage-close", "runtime-stop", "stack-close"]);
    expect(diagnostics.map(line => JSON.parse(line))).toEqual([{ kind: "fresh-native-setup-failure",
      stage: "app-configuration", classification: "setup-refused", exitCode: null, signal: null, cleanup: "complete" }]);
    expect(transport.listening).toBe(false); expect(runtime.listening).toBe(false);
  } finally { await close(transport); await close(runtime); }
});
