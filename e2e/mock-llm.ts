// In-process OpenAI-compatible mock for copilot E2E: first call returns a
// streamed get_genotype tool call; once a tool result is in the messages,
// streams a final answer citing the report and the genotype the tool
// returned. Listens on 127.0.0.1; the spec reaches it via the mock-llm.test
// hosts alias so the app classifies it as a CLOUD provider (consent gate).
import http from "node:http";

interface ChatMessage {
  role: string;
  content?: unknown;
  tool_calls?: unknown[];
}

function sse(res: http.ServerResponse, payload: unknown) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function chunk(delta: Record<string, unknown>, finish: string | null = null) {
  return {
    id: "chatcmpl-mock",
    object: "chat.completion.chunk",
    created: 1756389600,
    model: "mock-model",
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

export function startMockLlm(port: number): Promise<() => Promise<void>> {
  const server = http.createServer((req, res) => {
    if (!req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const parsed = JSON.parse(body) as { messages: ChatMessage[] };
      const hasToolResult = parsed.messages.some((m) => m.role === "tool");

      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });

      if (!hasToolResult) {
        sse(res, chunk({ role: "assistant", content: "" }));
        sse(
          res,
          chunk({
            tool_calls: [
              {
                index: 0,
                id: "call_mock_1",
                type: "function",
                function: {
                  name: "get_genotype",
                  arguments: JSON.stringify({ rsid: "rs762551" }),
                },
              },
            ],
          }),
        );
        sse(res, chunk({}, "tool_calls"));
      } else {
        const toolMsg = parsed.messages.find((m) => m.role === "tool");
        const toolText =
          typeof toolMsg?.content === "string"
            ? toolMsg.content
            : JSON.stringify(toolMsg?.content ?? "");
        const genotype = /"genotype"\s*:\s*"([^"]+)"/.exec(toolText)?.[1];
        const answer = `According to your Caffeine metabolism report (CYP1A2, rs762551), your genotype is ${genotype ?? "unknown"}. This is informational, not medical advice.`;
        sse(res, chunk({ role: "assistant", content: "" }));
        for (const word of answer.split(" ")) {
          sse(res, chunk({ content: word + " " }));
        }
        sse(res, chunk({}, "stop"));
      }
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve(
        () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
      );
    });
  });
}
