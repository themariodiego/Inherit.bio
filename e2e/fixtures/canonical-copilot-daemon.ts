import http from "node:http";
import https from "node:https";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { startCanonicalCopilotProvider } from "./canonical-copilot-provider";

const portSchema = z.union([z.literal(8123), z.literal(8125), z.literal(8126)]);
const plan = z.object({ prompt: z.string().min(1).max(8000),
  tool: z.object({ name: z.enum(["get_genotype", "search_variants", "list_reports", "get_report", "get_prs"]),
    arguments: z.record(z.string(), z.unknown()) }).strict(),
  answer: z.string().max(100000), pauseBefore: z.enum(["tool", "answer"]).optional() }).strict();
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), port: portSchema }).strict(),
  z.object({ action: z.literal("configure"), port: portSchema, plan }).strict(),
  z.object({ action: z.enum(["snapshot", "wait", "release", "stop"]), port: portSchema }).strict(),
]);
type Provider = Awaited<ReturnType<typeof startCanonicalCopilotProvider>>;

/** Dedicated synthetic fixture daemon. TLS forwards only to a fixed, same-process
 * loopback provider. The control port must be published ONLY on host loopback.
 * No app response, Storage, consent, authorization or database is mocked here. */
export async function startCanonicalCopilotDaemon(options: {
  controlPort?: number; controlHost?: "0.0.0.0" | "127.0.0.1"; modelAddress?: "203.0.114.10" | "127.0.0.1";
  keyPath: string; certificatePath: string;
}) {
  const modelAddress = options.modelAddress ?? "203.0.114.10";
  const instances = new Map<number, { provider: Provider; tls: https.Server; denied: number }>();
  async function stop(port: number) {
    const value = instances.get(port); if (!value) return;
    value.tls.closeAllConnections();
    await value.provider.stop();
    await new Promise<void>(resolve => value.tls.close(() => resolve()));
    instances.delete(port);
  }
  const control = http.createServer(async (request, response) => {
    const json = (status: number, body: unknown) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (request.method !== "POST" || request.url !== "/fixture") { json(404, { error: "fixture_route" }); return; }
    try {
      let size = 0; const chunks: Buffer[] = [];
      for await (const part of request) { size += part.length; if (size > 262144) { json(413, { error: "fixture_size" }); return; } chunks.push(Buffer.from(part)); }
      const value = command.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (value.action === "start") {
        if (instances.has(value.port)) { json(409, { error: "fixture_already_started" }); return; }
        // Different exact addresses permit the same fixed port inside this namespace.
        // Standalone loopback checks use an ephemeral backend to avoid address overlap.
        const provider = await startCanonicalCopilotProvider(modelAddress === "127.0.0.1" ? 0 : value.port);
        const state = { provider, tls: null as unknown as https.Server, denied: 0 };
        const tls = https.createServer({ key: readFileSync(options.keyPath), cert: readFileSync(options.certificatePath) }, (req, res) => {
          if (req.method !== "POST" || req.url !== "/v1/chat/completions") { state.denied++; res.writeHead(404).end(); return; }
          const upstream = http.request({ hostname: "127.0.0.1", port: provider.port, method: "POST", path: "/v1/chat/completions", headers: req.headers }, reply => {
            res.writeHead(reply.statusCode ?? 502, reply.headers); reply.pipe(res);
          });
          upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
          req.on("aborted", () => upstream.destroy()); res.on("close", () => upstream.destroy()); req.pipe(upstream);
        });
        state.tls = tls;
        try { await new Promise<void>((resolve, reject) => { tls.once("error", reject); tls.listen(value.port, modelAddress, resolve); }); }
        catch (error) { await provider.stop(); throw error; }
        instances.set(value.port, state); json(200, { ok: true }); return;
      }
      const state = instances.get(value.port);
      if (!state) { json(409, { error: "fixture_not_started" }); return; }
      if (value.action === "configure") state.provider.configure(value.plan);
      if (value.action === "wait") await state.provider.waitUntilPaused();
      if (value.action === "release") state.provider.release();
      if (value.action === "snapshot") { json(200, { calls: state.provider.calls() + state.denied, denied: state.denied, requests: state.provider.requests() }); return; }
      if (value.action === "stop") await stop(value.port);
      json(200, { ok: true });
    } catch { json(400, { error: "fixture_command_failed" }); }
  });
  await new Promise<void>((resolve, reject) => { control.once("error", reject); control.listen(options.controlPort ?? 8130, options.controlHost ?? "0.0.0.0", resolve); });
  return { controlPort: (control.address() as { port: number }).port,
    async stop() { await Promise.all([...instances.keys()].map(stop)); control.closeAllConnections(); await new Promise<void>(resolve => control.close(() => resolve())); } };
}

