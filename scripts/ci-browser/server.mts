/** Host launcher and unprivileged container entrypoint. App configuration uses
 * stdin only; the daemon has a separate clean environment. */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { createInterface } from "node:readline";
import { checkedCiLauncherEnvironment, checkedAppEnvironment, CI_RUNTIME_CONTAINER } from "../ci-browser-config";
const mode = process.argv[2];
const port = Number(process.argv[3]);
const children = new Set<ChildProcess>();
const sockets = new Set<net.Socket>();
let stopping = false;
const closers: Array<() => void> = [];
function stop(failed = false) {
  if (stopping) return;
  stopping = true;
  if (failed) process.exitCode = 1;
  for (const close of closers) close();
  for (const socket of sockets) socket.destroy();
  for (const child of children) {
    child.stdin?.end();
    if (mode === "inside" && child.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
    else child.kill("SIGTERM");
  }
  setTimeout(() => {
    for (const child of children) if (child.pid) { try {
      if (mode === "inside") process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL");
    } catch {} }
    process.exit(process.exitCode ?? 0);
  }, 5000).unref();
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => stop());
function own(child: ChildProcess) {
  children.add(child); child.stdin?.on("error", () => {});
  child.once("error", () => stop(true));
  child.once("exit", () => { children.delete(child); if (!stopping) stop(true); });
  return child;
}
function track(...items: net.Socket[]) {
  for (const socket of items) {
    sockets.add(socket); socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => items.forEach(item => item.destroy()));
    socket.setTimeout(60_000, () => items.forEach(item => item.destroy()));
  }
}
const cleanEnv = { NODE_ENV: "production" as const, PATH: "/usr/local/bin:/usr/bin:/bin", NEXT_TELEMETRY_DISABLED: "1" };
try {
  if (mode === "host") {
    const env = checkedCiLauncherEnvironment(process.env, port);
    const user = `${process.env.INHERIT_CI_RUNTIME_UID}:${process.env.INHERIT_CI_RUNTIME_GID}`;
    assert(/^[1-9][0-9]*:[1-9][0-9]*$/.test(user), "Unprivileged runtime identity required");
    const exec = (args: string[]) => own(spawn("docker", ["exec", "-i", "--user", user, CI_RUNTIME_CONTAINER, "node", "--import", "tsx", "/app/scripts/ci-browser/server.mts", ...args], { stdio: ["pipe", "pipe", "pipe"] }));
    if (port === 3100) {
      const relay = exec(["mail"]);
      relay.stderr?.resume();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Mail relay readiness failed")), 10_000);
        relay.once("exit", () => { clearTimeout(timer); reject(new Error("Mail relay exited")); });
        const lines = createInterface({ input: relay.stdout! });
        closers.push(() => lines.close());
        lines.on("line", line => {
          if (line === "MAIL_RELAY_READY") { clearTimeout(timer); resolve(); return; }
          try {
            assert(line.length <= 1_500_000);
            const request = JSON.parse(line) as { id: number; headers: http.OutgoingHttpHeaders; body: string };
            assert(Number.isSafeInteger(request.id) && typeof request.body === "string");
            const body = Buffer.from(request.body, "base64"); assert(body.length <= 1_048_576);
            // Fixed local mock only; no target from the message and no redirects.
            const local = http.request({ hostname: "127.0.0.1", port: 8124, path: "/emails", method: "POST",
              headers: { ...request.headers, "content-length": body.length } }, response => {
              const chunks: Buffer[] = []; let size = 0;
              response.on("data", chunk => { size += chunk.length; if (size > 1_048_576) response.destroy(); else chunks.push(chunk); });
              response.on("end", () => relay.stdin?.write(JSON.stringify({ id: request.id, status: response.statusCode, body: Buffer.concat(chunks).toString("base64") }) + "\n"));
              response.on("error", () => stop(true));
            });
            local.once("socket", socket => track(socket));
            local.setTimeout(8000, () => local.destroy());
            local.on("error", () => relay.stdin?.write(JSON.stringify({ id: request.id, status: 503, body: "" }) + "\n"));
            local.end(body);
          } catch { clearTimeout(timer); reject(new Error("Mail relay protocol refused")); stop(true); }
        });
      });
    }
    const child = exec(["inside", String(port), process.env.INHERIT_CI_GATEWAY ?? ""]);
    child.stdout?.pipe(process.stdout); child.stderr?.resume();
    child.stdin!.write(JSON.stringify(env) + "\n");
  } else {
    assert(process.getuid!() > 0);
    assert.match(readFileSync("/proc/self/status", "utf8"), /^CapEff:\s+0+$/m);
    const input = createInterface({ input: process.stdin });
    closers.push(() => input.close()); input.once("close", () => stop());
    if (mode === "mail") {
      const pending = new Map<number, { response: http.ServerResponse; timer: NodeJS.Timeout }>(); let sequence = 0;
      closers.push(() => { for (const item of pending.values()) { clearTimeout(item.timer); item.response.destroy(); } pending.clear(); });
      const server = http.createServer((request, response) => {
        if (request.method !== "POST" || request.url !== "/emails") { response.writeHead(404).end(); return; }
        const chunks: Buffer[] = []; let size = 0;
        request.on("data", chunk => { size += chunk.length; if (size > 1_048_576) request.destroy(); else chunks.push(chunk); });
        request.on("end", () => {
          const id = ++sequence;
          const timer = setTimeout(() => { pending.delete(id); response.writeHead(503).end(); }, 10_000);
          pending.set(id, { response, timer });
          process.stdout.write(JSON.stringify({ id, headers: request.headers, body: Buffer.concat(chunks).toString("base64") }) + "\n");
        });
      });
      server.on("connection", socket => track(socket));
      server.on("error", () => stop(true)); closers.push(() => server.close());
      input.on("line", line => {
        try {
          assert(line.length <= 1_500_000);
          const reply = JSON.parse(line) as { id: number; status: number; body: string };
          const item = pending.get(reply.id); if (!item) return;
          assert(Number.isInteger(reply.status) && reply.status >= 200 && reply.status <= 599 && typeof reply.body === "string");
          const body = Buffer.from(reply.body, "base64"); assert(body.length <= 1_048_576);
          clearTimeout(item.timer); pending.delete(reply.id);
          item.response.writeHead(reply.status, { "content-type": "application/json", "content-length": body.length }).end(body);
        } catch { stop(true); }
      });
      server.listen(8124, "127.0.0.1", () => process.stdout.write("MAIL_RELAY_READY\n"));
    } else {
      assert(mode === "inside"); let initialized = false;
      input.on("line", line => { void (async () => {
        assert(!initialized && line.length < 65_536, "Single bounded app configuration required"); initialized = true;
        const env = checkedAppEnvironment(JSON.parse(line), port);
        if (port === 3100) {
          const gateway = process.argv[4]; assert(net.isIP(gateway) === 4);
          const proxy = net.createServer(downstream => {
            const upstream = net.connect({ host: gateway, port: 8000 }); track(downstream, upstream);
            downstream.pipe(upstream); upstream.pipe(downstream);
          });
          closers.push(() => proxy.close());
          await new Promise<void>((resolve, reject) => { proxy.once("error", reject); proxy.listen(54321, "127.0.0.1", resolve); });
          const daemon = own(spawn("node", ["--import", "tsx", "/app/e2e/fixtures/canonical-copilot-daemon.run.mts"],
            { cwd: "/app", env: cleanEnv, detached: true, stdio: ["ignore", "pipe", "pipe"] }));
          daemon.stderr?.resume();
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Synthetic fixture readiness failed")), 10_000);
            daemon.once("exit", () => { clearTimeout(timer); reject(new Error("Synthetic fixture exited")); });
            const lines = createInterface({ input: daemon.stdout! }); closers.push(() => lines.close());
            lines.on("line", value => { if (value === "Synthetic Copilot fixture control is ready on port 8130.") { clearTimeout(timer); resolve(); } });
          });
        }
        if (stopping) return;
        const app = own(spawn("node", ["/app/node_modules/next/dist/bin/next", "start", "--port", String(port)], {
          cwd: "/app", env: { ...cleanEnv, ...env, NODE_ENV: "production", NODE_EXTRA_CA_CERTS: "/tls/fixture/ca.crt" },
          detached: true, stdio: ["ignore", "pipe", "pipe"],
        }));
        // Drain app diagnostics without persisting request/provider secrets.
        app.stdout?.resume(); app.stderr?.resume();
        console.log(`Started isolated production app variant ${port}`);
      })().catch(() => { console.error("Isolated app initialization failed; no request or environment details retained"); stop(true); }); });
    }
  }
} catch { console.error("Isolated browser launcher failed; no request or environment details retained"); stop(true); }
