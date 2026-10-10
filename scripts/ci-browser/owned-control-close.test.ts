import { spawn } from "node:child_process";
import { readFileSync, type ReadStream } from "node:fs";
import { PassThrough, Readable } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { settleOwnedControlClose } from "./owned-control-close";

afterEach(() => { vi.useRealTimers(); });
it("settles one real anonymous FD3 close before reusing its descriptor", async () => {
  const helper = new URL("./owned-control-close.ts", import.meta.url).href;
  const code = `
    import assert from "node:assert/strict";
    import { createReadStream, fstatSync, openSync, closeSync } from "node:fs";
    import { settleOwnedControlClose } from ${JSON.stringify(helper)};
    const source = createReadStream("", { fd: 3, autoClose: false });
    let errors = 0; source.on("error", () => { errors++; });
    const chunks = []; for await (const chunk of source) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString("utf8"), "public-fd3-control");
    fstatSync(3); // The unchanged receiver runs before descriptor closure.
    await settleOwnedControlClose(source);
    assert(source.closed); assert.equal(errors, 0);
    assert.throws(() => fstatSync(3), { code: "EBADF" });
    const replacement = openSync("/dev/null", "r"); assert.equal(replacement, 3);
    await new Promise(resolve => setTimeout(resolve, 25)); fstatSync(replacement);
    closeSync(replacement); process.stdout.write("PUBLIC_FD3_SETTLED\\n");
  `;
  const value = await new Promise<{ code: number | null; stdout: string; stderrBytes: number }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
      env: { PATH: "/usr/bin:/bin" }, stdio: ["ignore", "pipe", "pipe", "pipe"],
    });
    let stdout = "", stderrBytes = 0;
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Public descriptor control deadline")); }, 2000);
    child.once("error", () => { clearTimeout(timer); reject(new Error("Public descriptor control unavailable")); });
    child.stdout!.on("data", chunk => { stdout += chunk.toString("utf8"); if (stdout.length > 128) child.kill("SIGKILL"); });
    child.stderr!.on("data", chunk => { stderrBytes += chunk.length; });
    child.once("close", code => { clearTimeout(timer); resolve({ code, stdout, stderrBytes }); });
    const pipe = child.stdio[3] as NodeJS.WritableStream;
    pipe.on("error", () => {}); pipe.end("public-fd3-control");
  });
  expect(value).toEqual({ code: 0, stdout: "PUBLIC_FD3_SETTLED\n", stderrBytes: 0 });
});
it("registers actual close before destroy and removes only its own listeners", async () => {
  const source = new PassThrough(), retained = vi.fn(); source.on("error", retained);
  await settleOwnedControlClose(source as unknown as ReadStream);
  expect(source.closed).toBe(true); expect(source.listenerCount("close")).toBe(0);
  expect(source.listeners("error")).toEqual([retained]);
});
it("refuses a close error after settlement without retaining its private message", async () => {
  const source = new PassThrough(); source.destroy(new Error("private-token"));
  await expect(settleOwnedControlClose(source as unknown as ReadStream)).rejects.toThrow(/^Operator-control close unresolved$/);
  expect(source.closed).toBe(true); expect(source.listenerCount("close")).toBe(0);
  expect(source.listenerCount("error")).toBe(0);
});
it("retains the original five-second settlement bound when actual close never occurs", async () => {
  vi.useFakeTimers();
  const source = new Readable({ read() {}, destroy() {} });
  const outcome = settleOwnedControlClose(source as unknown as ReadStream).catch(error => error);
  await vi.advanceTimersByTimeAsync(4999); let settled = false; void outcome.then(() => { settled = true; });
  await Promise.resolve(); expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect((await outcome).message).toBe("Operator-control close unresolved");
  expect(source.closed).toBe(false); expect(source.listenerCount("close")).toBe(0);
  expect(source.listenerCount("error")).toBe(0);
});
it("keeps already settled closure idempotent without issuing another close", async () => {
  const source = new PassThrough(); await settleOwnedControlClose(source as unknown as ReadStream);
  const destroy = vi.spyOn(source, "destroy"); await settleOwnedControlClose(source as unknown as ReadStream);
  expect(destroy).not.toHaveBeenCalled();
});
it("retains the exact proof-input deadline, bound and receive-before-close-before-spawn order", () => {
  const source = readFileSync(new URL("./server.mts", import.meta.url), "utf8");
  expect(source).toContain('createReadStream("", { fd: 3, autoClose: false })');
  expect(source).toContain('setTimeout(() => source.destroy(new Error("Operator-control input timed out")), 10_000)');
  expect(source).toContain('assert(size < 8192, "Bounded public operator-control proof required")');
  const receive = source.indexOf('receiveOwnedLinuxChildProof(Buffer.concat(chunks).toString("utf8").trim(), 3)');
  const close = source.indexOf("await settleOwnedControlClose(source)");
  const spawn = source.indexOf('own(spawn("docker"');
  expect(receive).toBeGreaterThan(0); expect(close).toBeGreaterThan(receive); expect(spawn).toBeGreaterThan(close);
  expect(source).not.toContain("closeSync");
});
