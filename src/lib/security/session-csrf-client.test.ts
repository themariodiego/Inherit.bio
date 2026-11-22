import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acceptCsrf, csrfHandle, csrfValue } from "./session-csrf-client";

const token = (n: number) => `${String(1_800_000_000_000 + n)}.${"A".repeat(42)}${n % 10}.${"0".repeat(63)}${n % 10}`;
const answer = (next: string | null) => new Response(null, { headers: next ? { "X-Inherit-CSRF": next } : {} });

/** A request the test answers when it chooses, recording the token it was sent with. */
function controlled() {
  const sent: string[] = [];
  const replies: ((response: Response) => void)[] = [];
  const failures: ((error: Error) => void)[] = [];
  const request = (value: string) => {
    sent.push(value);
    return new Promise<Response>((resolve, reject) => { replies.push(resolve); failures.push(reject); });
  };
  return { sent, request, reply: (index: number, response: Response) => replies[index]!(response),
    fail: (index: number) => failures[index]!(new Error("offline")) };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the browser's one-time X-Inherit-CSRF value", () => {
  it("sends the rendered value first and the successor each response issued after that", () => {
    const rendered = token(1);
    expect(csrfValue(rendered)).toBe(rendered);
    acceptCsrf(rendered, answer(token(2)));
    expect(csrfValue(rendered)).toBe(token(2));
    acceptCsrf(rendered, answer(token(3)));
    expect(csrfValue(rendered), "the chain is followed from the value the page rendered").toBe(token(3));
  });

  it("keeps the last good value when a response issues none or something else", () => {
    const rendered = token(4);
    acceptCsrf(rendered, answer(token(5)));
    for (const next of [null, "", "not-a-token", `${token(6)}, ${token(7)}`]) acceptCsrf(rendered, answer(next));
    expect(csrfValue(rendered)).toBe(token(5));
  });

  it("keeps each rendered value's chain apart, so a newly rendered page starts from its own value", async () => {
    const first = token(8), second = token(9);
    acceptCsrf(first, answer(token(10)));
    expect(csrfValue(second)).toBe(second);
    const handle = csrfHandle(second);
    // 2026-11-19: the handle sends through its chain instead of handing out
    // value() and taking accept(); the chain it follows is the same.
    await handle.send(async () => answer(token(11)));
    let carried: string | undefined;
    await handle.send(async (value) => { carried = value; return answer(null); });
    expect(carried).toBe(token(11));
    expect(csrfValue(first)).toBe(token(10));
    let unrendered: string | undefined;
    await csrfHandle(undefined).send(async (value) => { unrendered = value; return answer(null); });
    expect(unrendered, "no rendered token sends nothing valid").toBe("");
  });
});

/**
 * Two requests of one page to one route: the server spends each token once,
 * so a second request that read the chain's value before the first answer
 * arrived would carry a spent token and be refused. The chain lets one request
 * be in flight at a time, and the next carries the successor.
 */
describe("one chain, one request in flight", () => {
  it("sends a second same-route request only after the first answer, with the successor that answer issued", async () => {
    const rendered = token(20), handle = csrfHandle(rendered), wire = controlled();
    const first = handle.send(wire.request);
    const second = handle.send(wire.request);
    await settle();
    expect(wire.sent, "the second waits while the first is in flight").toEqual([rendered]);
    wire.reply(0, answer(token(21)));
    expect((await first).headers.get("X-Inherit-CSRF")).toBe(token(21));
    await settle();
    expect(wire.sent, "the second carries the first answer's successor, never the spent value").toEqual([rendered, token(21)]);
    wire.reply(1, answer(token(22)));
    await second;
    expect(csrfValue(rendered)).toBe(token(22));
  });

  it("orders three overlapping requests from two components that hold the same rendered value", async () => {
    const rendered = token(30), wire = controlled();
    const sends = [csrfHandle(rendered).send(wire.request), csrfHandle(rendered).send(wire.request), csrfHandle(rendered).send(wire.request)];
    for (let index = 0; index < 3; index += 1) {
      await settle();
      expect(wire.sent).toHaveLength(index + 1);
      wire.reply(index, answer(token(31 + index)));
    }
    await Promise.all(sends);
    expect(wire.sent).toEqual([rendered, token(31), token(32)]);
    expect(new Set(wire.sent).size, "no two requests shared a token").toBe(3);
  });

  it("after a first request that failed without an answer, sends the same value again and is not stuck", async () => {
    const rendered = token(40), handle = csrfHandle(rendered), wire = controlled();
    const first = handle.send(wire.request);
    const second = handle.send(wire.request);
    wire.fail(0);
    await expect(first).rejects.toThrow("offline");
    await settle();
    // No successor arrived, so the chain still holds the value the first
    // carried; the server says whether that request spent it.
    expect(wire.sent).toEqual([rendered, rendered]);
    wire.reply(1, answer(token(41)));
    await second;
    expect(csrfValue(rendered)).toBe(token(41));
  });

  it("after a first answer with no successor (a refusal), sends the same value again", async () => {
    const rendered = token(50), handle = csrfHandle(rendered), wire = controlled();
    const first = handle.send(wire.request), second = handle.send(wire.request);
    wire.reply(0, new Response('{"error":"request_forbidden"}', { status: 403 }));
    expect((await first).status).toBe(403);
    await settle();
    expect(wire.sent).toEqual([rendered, rendered]);
    wire.reply(1, answer(null));
    await second;
  });

  it("after a request whose own code throws before it is sent, lets the next one go", async () => {
    const rendered = token(55), handle = csrfHandle(rendered), wire = controlled();
    await expect(handle.send(() => { throw new Error("no body"); })).rejects.toThrow("no body");
    const next = handle.send(wire.request);
    expect(wire.sent).toEqual([rendered]);
    wire.reply(0, answer(token(56)));
    await next;
  });

  it("lets different routes, and another rendered value of the same route, proceed without waiting", async () => {
    const chat = token(60), jurisdiction = token(61), rerendered = token(62), wire = controlled();
    const sends = [csrfHandle(chat).send(wire.request), csrfHandle(jurisdiction).send(wire.request), csrfHandle(rerendered).send(wire.request)];
    expect(wire.sent, "all three are in flight together").toEqual([chat, jurisdiction, rerendered]);
    wire.reply(2, answer(token(63))); wire.reply(1, answer(token(64))); wire.reply(0, answer(token(65)));
    await Promise.all(sends);
    expect([csrfValue(chat), csrfValue(jurisdiction), csrfValue(rerendered)]).toEqual([token(65), token(64), token(63)]);
  });

  it("starts a request with no other in flight in the caller's turn, as a direct fetch did", () => {
    const wire = controlled();
    void csrfHandle(token(70)).send(wire.request);
    expect(wire.sent).toEqual([token(70)]);
    wire.reply(0, answer(null));
  });

  it("is the only way the app's code reads or keeps a successor", () => {
    const offenders: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.(ts|tsx)$/u.test(entry.name) || /\.test\.ts$/u.test(entry.name) || full.endsWith("session-csrf-client.ts")) continue;
        const text = readFileSync(full, "utf8");
        for (const [, names] of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["'][^"']*session-csrf-client["']/gu)) {
          const imported = names!.split(",").map((name) => name.replace(/^\s*type\s+/u, "").trim()).filter(Boolean);
          if (imported.some((name) => !["csrfHandle", "CsrfHandle", "CSRF_HEADER"].includes(name))) offenders.push(`${full}: ${imported.join(", ")}`);
        }
        if (/session-csrf-client["']/u.test(text) && !/import\s+(?:type\s+)?\{[^}]*\}\s+from\s+["'][^"']*session-csrf-client["']/u.test(text)) {
          offenders.push(`${full}: an import this check cannot read`);
        }
      }
    };
    walk("src");
    expect(offenders, "every request goes through a handle's send, so its chain sees it").toEqual([]);
  });
});
