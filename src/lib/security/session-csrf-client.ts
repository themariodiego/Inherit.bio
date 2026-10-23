/**
 * The browser side of the one-time `X-Inherit-CSRF` token
 * (`session-csrf-core.ts`). A page renders one token per route; each value is
 * spent by the first request that carries it, and the response that spends it
 * carries the next one in the same header. So a page sends its rendered value
 * the first time and the latest successor after that.
 *
 * Successors are kept here, keyed by the value the page rendered, rather than
 * in a component: a page restored from the client router's cache comes back
 * with the value it was first rendered with, already spent, and this finds
 * its successor. Nothing is stored beyond this page's memory.
 */

/** The header name a request sends the token in, as the register writes it. */
export const CSRF_HEADER = "X-Inherit-CSRF";

const TOKEN = /^\d{13}\.[A-Za-z0-9_-]{43}\.[0-9a-f]{64}$/;
const successors = new Map<string, string>();

/** What a request sends: the latest successor of the rendered value, or the value itself. */
export function csrfValue(rendered: string): string {
  return successors.get(rendered) ?? rendered;
}

/** Keeps the successor a response issued for the rendered value, when it issued one. */
export function acceptCsrf(rendered: string, response: Pick<Response, "headers">): void {
  const next = response.headers.get(CSRF_HEADER);
  if (rendered && next && TOKEN.test(next)) successors.set(rendered, next);
}

/** One route's token as a component holds it: read it for a request, then hand back the response. */
export interface CsrfHandle {
  value(): string;
  accept(response: Pick<Response, "headers">): void;
}

export function csrfHandle(rendered: string | undefined): CsrfHandle {
  const value = rendered ?? "";
  return { value: () => csrfValue(value), accept: (response) => acceptCsrf(value, response) };
}
