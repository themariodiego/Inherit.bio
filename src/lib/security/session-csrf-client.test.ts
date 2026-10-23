import { describe, expect, it } from "vitest";
import { acceptCsrf, csrfHandle, csrfValue } from "./session-csrf-client";

const token = (n: number) => `${String(1_800_000_000_000 + n)}.${"A".repeat(42)}${n % 10}.${"0".repeat(63)}${n % 10}`;
const answer = (next: string | null) => new Response(null, { headers: next ? { "X-Inherit-CSRF": next } : {} });

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

  it("keeps each rendered value's chain apart, so a newly rendered page starts from its own value", () => {
    const first = token(8), second = token(9);
    acceptCsrf(first, answer(token(10)));
    expect(csrfValue(second)).toBe(second);
    const handle = csrfHandle(second);
    handle.accept(answer(token(11)));
    expect(handle.value()).toBe(token(11));
    expect(csrfValue(first)).toBe(token(10));
    expect(csrfHandle(undefined).value(), "no rendered token sends nothing valid").toBe("");
  });
});
