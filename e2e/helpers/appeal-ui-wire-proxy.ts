import { createServer, request as forwardGet } from "node:http";
import type { Socket } from "node:net";

/** Fixed TEST page only. Native POSTs are never forwarded. Values stay in memory. */
export const APPEAL_UI_ORIGIN = "http://localhost:3102";
export const APPEAL_UI_ENDPOINT = `${APPEAL_UI_ORIGIN}/api/appeals`;

export interface AppealWireRequest {
  url(): string;
  method(): string;
  allHeaders(): Promise<Record<string, string>>;
  postDataJSON(): unknown;
}

export async function createAppealUiWireProxy(outcome: "received" | "invalid") {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let entered!: (request: AppealWireRequest) => void;
  let rejectIncoming!: (error: Error) => void;
  const incoming = new Promise<AppealWireRequest>((resolve, reject) => {
    entered = resolve; rejectIncoming = reject;
  });
  // A setup/navigation failure can occur before the test awaits this promise.
  void incoming.catch(() => undefined);
  const pending = new Set<Promise<void>>();
  const sockets = new Set<Socket>();
  const upstreams = new Set<ReturnType<typeof forwardGet>>();
  let intercepted = 0, closing = false, failure: Error | undefined;
  const fail = () => {
    if (!closing) {
      failure ??= new Error("The owned appeal UI wire proxy failed.");
      rejectIncoming(failure);
    }
  };
  const server = createServer((request, response) => {
    const operation = (async () => {
      try {
        const target = new URL(request.url ?? "");
        if (target.origin !== APPEAL_UI_ORIGIN || target.username || target.password || target.hash
          || request.headers.host !== "localhost:3102") {
          response.writeHead(403); response.end(); return;
        }
        if (request.method === "GET") {
          if (request.headers["transfer-encoding"] || (request.headers["content-length"] ?? "0") !== "0") {
            response.writeHead(403); response.end(); return;
          }
          await new Promise<void>((resolve, reject) => {
            // Original Host/Cookie and raw header pairs go only to the fixed TEST app.
            const upstream = forwardGet(target, { method: "GET", headers: request.rawHeaders }, reply => {
              reply.once("error", reject);
              reply.once("aborted", () => reject(new Error("The TEST GET ended early.")));
              response.once("finish", resolve);
              response.once("close", () => {
                if (!response.writableFinished) upstream.destroy();
                resolve();
              });
              // Preserve response status, raw header pairs and complete body bytes.
              // HTTP/TCP framing is owned by Node, not claimed byte-identical.
              response.writeHead(reply.statusCode ?? 502, reply.statusMessage, reply.rawHeaders);
              reply.pipe(response);
            });
            upstreams.add(upstream);
            upstream.once("close", () => {
              upstreams.delete(upstream);
              if (closing) resolve();
            });
            upstream.once("error", reject);
            upstream.end();
          });
          return;
        }
        if (request.method !== "POST" || request.url !== APPEAL_UI_ENDPOINT) {
          response.writeHead(403); response.end(); return;
        }
        intercepted += 1;
        const headers: Record<string, string> = {};
        for (let index = 0; index < request.rawHeaders.length; index += 2) {
          const name = request.rawHeaders[index]!.toLowerCase();
          if (Object.hasOwn(headers, name)) throw new Error("Duplicate wire header.");
          headers[name] = request.rawHeaders[index + 1]!;
        }
        const pieces: Buffer[] = [];
        let bytes = 0;
        try {
          for await (const piece of request) {
            const buffer = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
            bytes += buffer.length;
            if (bytes > 32_768) throw new Error("The synthetic request is too large.");
            pieces.push(buffer);
          }
          const raw = Buffer.concat(pieces);
          try {
            const body: unknown = JSON.parse(raw.toString("utf8"));
            const actualUrl = request.url;
            const actualMethod = request.method;
            entered({ url: () => actualUrl!, method: () => actualMethod!,
              allHeaders: async () => ({ ...headers }), postDataJSON: () => body });
          } finally { raw.fill(0); }
        } finally { for (const piece of pieces) piece.fill(0); }
        await held;
        if (!response.destroyed) {
          response.writeHead(outcome === "received" ? 202 : 422,
            { "content-type": "application/json", "cache-control": "private, no-store", "referrer-policy": "no-referrer" });
          response.end(outcome === "received" ? '{"status":"received"}' : '{"error":"invalid_request","issues":["request"]}');
        }
      } catch {
        fail();
        response.destroy();
      }
    })();
    pending.add(operation);
    void operation.finally(() => pending.delete(operation));
  });
  server.on("connection", socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("connect", (_request, socket) => {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  });
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.on("clientError", (_error, socket) => { fail(); socket.destroy(); });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  });
  server.on("error", fail);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The wire proxy has no owned port.");
  return {
    server: `http://127.0.0.1:${address.port}`, incoming, release,
    count: () => intercepted,
    async close() {
      closing = true;
      release();
      const stopped = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      for (const upstream of upstreams) upstream.destroy();
      for (const socket of sockets) socket.destroy();
      while (pending.size > 0) await Promise.all([...pending]);
      await stopped;
      if (failure) throw failure;
    },
  };
}
