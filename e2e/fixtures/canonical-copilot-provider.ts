import http, { type ServerResponse } from "node:http";

type ToolName = "get_genotype" | "search_variants" | "list_reports" | "get_report" | "get_prs";
interface Message { role: string; content?: unknown; tool_call_id?: string }
export interface CanonicalProviderPlan {
  prompt: string;
  tool: { name: ToolName; arguments: Record<string, unknown> };
  answer: string;
  /** Before tool-call response, or after receiving the tool result but before
   * final answer. Neither claims to pause inside the app's tool executor. */
  pauseBefore?: "tool" | "answer";
}
const signal = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
function chunk(delta: Record<string, unknown>, finish: string | null = null) {
  return { id: "chatcmpl-canonical-local", object: "chat.completion.chunk", created: 1756389600,
    model: "canonical-local", choices: [{ index: 0, delta, finish_reason: finish }] };
}
function send(response: ServerResponse, payload: unknown) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/** Controlled fake provider only. The application, tools, Storage, grants and
 * mutations remain real. Listens exclusively on loopback and never fetches.
 * Each plan makes exactly one chosen tool request and at most one completion.
 */
export async function startCanonicalCopilotProvider(port: number) {
  let calls = 0, sequence = 0;
  let active: { plan: CanonicalProviderPlan; id: string; stage: "tool" | "answer" | "done";
    reached: ReturnType<typeof signal>; released: ReturnType<typeof signal> } | null = null;
  const requests: Array<{ prompt: string; stage: "tool" | "answer"; messages: Message[] }> = [];
  const server = http.createServer(async (request, response) => {
    calls++;
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") { response.writeHead(404).end(); return; }
    try {
      const buffers: Buffer[] = []; let size = 0;
      for await (const value of request) {
        const buffer = Buffer.from(value); size += buffer.length;
        if (size > 262_144) { response.writeHead(413).end(); return; }
        buffers.push(buffer);
      }
      const parsed = JSON.parse(Buffer.concat(buffers).toString("utf8")) as { messages?: Message[]; stream?: boolean };
      if (!active || active.stage === "done" || parsed.stream !== true || !Array.isArray(parsed.messages)) {
        response.writeHead(409).end(); return;
      }
      const current = active;
      if (current.stage === "done") { response.writeHead(409).end(); return; }
      const lastUser = [...parsed.messages].reverse().find(message => message.role === "user");
      const prompt = typeof lastUser?.content === "string" ? lastUser.content : JSON.stringify(lastUser?.content);
      if (prompt !== current.plan.prompt) { response.writeHead(409).end(); return; }
      const last = parsed.messages.at(-1), stage = current.stage;
      if ((stage === "tool" && last?.role !== "user")
        || (stage === "answer" && (last?.role !== "tool" || last.tool_call_id !== current.id))) {
        response.writeHead(409).end(); return;
      }
      requests.push({ prompt, stage, messages: structuredClone(parsed.messages) });
      // Advance before pausing so duplicate/retried requests cannot perform the same step.
      current.stage = stage === "tool" ? "answer" : "done";
      if (current.plan.pauseBefore === stage) {
        current.reached.resolve();
        await current.released.promise;
      }
      if (response.destroyed) return;
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      send(response, chunk({ role: "assistant", content: "" }));
      if (stage === "tool") {
        send(response, chunk({ tool_calls: [{ index: 0, id: current.id, type: "function",
          function: { name: current.plan.tool.name, arguments: JSON.stringify(current.plan.tool.arguments) } }] }));
        send(response, chunk({}, "tool_calls"));
      } else {
        // Character deltas preserve the output gate's whole-completion test boundary.
        for (const content of current.plan.answer) send(response, chunk({ content }));
        send(response, chunk({}, "stop"));
      }
      response.end("data: [DONE]\n\n");
    } catch { if (!response.headersSent) response.writeHead(400); response.end(); }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    port: (server.address() as { port: number }).port,
    configure(plan: CanonicalProviderPlan) {
      active?.released.resolve();
      active = { plan, id: `call_canonical_${++sequence}`, stage: "tool", reached: signal(), released: signal() };
    },
    calls: () => calls,
    requests: () => structuredClone(requests),
    async waitUntilPaused() {
      if (!active?.plan.pauseBefore) throw new Error("Configure an explicit provider pause first");
      const current = active;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([current.reached.promise, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Expected local provider pause was not reached")), 30_000);
        })]);
      } finally { if (timer) clearTimeout(timer); }
    },
    release: () => active?.released.resolve(),
    async stop() {
      active?.released.resolve();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
