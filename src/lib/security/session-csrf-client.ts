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
 *
 * One rendered value is one chain, and a chain has one request in flight at a
 * time. Two requests that read the chain's value before the first answer
 * arrived would carry the same token, and the server spends it once, so the
 * second would be refused. A request is therefore sent through `send`, which
 * waits for the chain's request in flight to settle and then reads the latest
 * successor. The server's rule is unchanged: each token is still spent by one
 * request and a repeat is refused. Different routes, and different rendered
 * values of one route, are different chains and never wait for each other.
 */

/** The header name a request sends the token in, as the register writes it. */
export const CSRF_HEADER = "X-Inherit-CSRF";

const TOKEN = /^\d{13}\.[A-Za-z0-9_-]{43}\.[0-9a-f]{64}$/;
const successors = new Map<string, string>();
/** Each chain's last request, settled either way: the next request of the chain starts after it. */
const inFlight = new Map<string, Promise<void>>();

/** The latest successor of the rendered value, or the value itself: what the chain's next request carries. */
export function csrfValue(rendered: string): string {
  return successors.get(rendered) ?? rendered;
}

/** Keeps the successor a response issued for the rendered value, when it issued one. */
export function acceptCsrf(rendered: string, response: Pick<Response, "headers">): void {
  const next = response.headers.get(CSRF_HEADER);
  if (rendered && next && TOKEN.test(next)) successors.set(rendered, next);
}

/**
 * Sends one request of the rendered value's chain: once the chain's request
 * in flight has settled, `request` is called with the value to carry in
 * `X-Inherit-CSRF`, and the successor its answer issues is kept before the
 * chain's next request may start. A request that fails without an answer, or
 * is answered without a successor, leaves the chain's value as it was; the
 * next request carries that value, and the server decides whether it was
 * spent. With no chain in flight the request starts at once, in the caller's
 * turn. A page that rendered no value sends "" and waits for nothing.
 */
export function sendWithCsrf<T extends Pick<Response, "headers">>(rendered: string,
  request: (token: string) => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const response = await request(csrfValue(rendered));
    acceptCsrf(rendered, response);
    return response;
  };
  if (!rendered) return run();
  const previous = inFlight.get(rendered);
  const result = previous ? previous.then(run) : run();
  const settled = result.then(() => undefined, () => undefined);
  inFlight.set(rendered, settled);
  void settled.then(() => { if (inFlight.get(rendered) === settled) inFlight.delete(rendered); });
  return result;
}

/** One route's token as a component holds it: each request goes through `send`. */
export interface CsrfHandle {
  send<T extends Pick<Response, "headers">>(request: (token: string) => Promise<T>): Promise<T>;
}

export function csrfHandle(rendered: string | undefined): CsrfHandle {
  const value = rendered ?? "";
  return { send: (request) => sendWithCsrf(value, request) };
}
