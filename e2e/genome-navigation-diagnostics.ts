import type { Page, Request, Response } from "@playwright/test";

type Stage = "my-genome" | "upload";
type Route = "browser" | "my-genome" | "upload";
type Event = { stage: Stage; kind: "request" | "response" | "request-failed"; route: Route; status?: number };

function routeName(url: string): Route | null {
  const pathname = new URL(url).pathname;
  if (pathname === "/genome/me/data/browser") return "browser";
  if (pathname === "/genome/me") return "my-genome";
  if (pathname === "/files/upload") return "upload";
  return null;
}

/** A bounded failure receipt, never URLs, headers, bodies or error messages. */
export function watchGenomeNavigation(page: Page) {
  let stage: Stage = "my-genome";
  let droppedEvents = 0, pageErrors = 0, consoleErrors = 0;
  const events: Event[] = [];
  const record = (kind: Event["kind"], url: string, status?: number) => {
    const route = routeName(url);
    if (!route) return;
    if (events.length === 50) { droppedEvents++; return; }
    events.push({ stage, kind, route, ...(status === undefined ? {} : { status }) });
  };
  const request = (value: Request) => record("request", value.url());
  const response = (value: Response) => record("response", value.url(), value.status());
  const failed = (value: Request) => record("request-failed", value.url());
  const error = () => { pageErrors++; };
  const console = (value: { type(): string }) => { if (value.type() === "error") consoleErrors++; };
  page.on("request", request);
  page.on("response", response);
  page.on("requestfailed", failed);
  page.on("pageerror", error);
  page.on("console", console);
  return {
    stage(value: Stage) { stage = value; },
    snapshot() {
      return { stage, currentRoute: routeName(page.url()) ?? "other", events: [...events], droppedEvents, pageErrors, consoleErrors };
    },
    stop() {
      page.off("request", request);
      page.off("response", response);
      page.off("requestfailed", failed);
      page.off("pageerror", error);
      page.off("console", console);
    },
  };
}
