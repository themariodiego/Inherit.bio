/**
 * One simulated participant's browser (G3.1).
 *
 * Every session gets its own Playwright browser context, so no cookie,
 * storage, service worker or history crosses between simulations, and the
 * caller gives it its own freshly seeded account. The context can reach only
 * the local build and its local Supabase API; every other origin is refused,
 * so a participant can read nothing but the product.
 *
 * The participant sees the page as text: headings, paragraphs and every
 * visible control as `[id kind] label`. It acts on those ids. Actions are
 * counted the way G2.4 counts them: a listener installed in the capture phase
 * bumps a `sessionStorage` counter on every real `click` and `submit` event,
 * exactly as `e2e/task-depth.spec.ts` does, so what is counted is what the
 * browser dispatched rather than what was asked for. Mailed-link and
 * typed-URL entries are recorded separately and never counted. No
 * confirmation exclusion is applied, which can only raise a count.
 *
 * A control that has gone stale, or a value the environment refuses, does not
 * end the run: the next view says it did not work, as a page would.
 */
import type { Browser, BrowserContext, Page } from "@playwright/test";
import type { BrowserAction, BrowserAdapter, BrowserRecord } from "./conductor-contract";

export const CONTROL_ATTRIBUTE = "data-comprehension-control";
const COUNTER_KEY = "__inheritComprehensionActions";
const SYNTHETIC_EMAIL = /@(?:[a-z0-9-]+\.)*(?:e2e\.local|invalid)$/i;

/** Runs in the page. Self-contained: Playwright serialises it. */
export function snapshotDocument(attribute: string): { title: string; lines: string[]; controls: string[] } {
  const root = document.documentElement;
  let next = Number(root.getAttribute(`${attribute}-next`) ?? "0");
  const lines: string[] = [], controls: string[] = [];
  let buffer = "";
  const flush = () => { const text = buffer.replace(/\s+/g, " ").trim(); if (text) lines.push(text); buffer = ""; };
  const interactive = "a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],"
    + "[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=switch],[role=option]";
  const block = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|BR|CAPTION|DD|DETAILS|DIALOG|DIV|DL|DT|FIELDSET|FIGCAPTION|FIGURE|FOOTER|FORM|H[1-6]|HEADER|HR|LABEL|LEGEND|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TD|TH|TR|UL)$/;
  const hidden = (element: Element) => {
    if (element.getAttribute("aria-hidden") === "true" || (element as HTMLElement).hidden) return true;
    if (typeof element.checkVisibility === "function") return !element.checkVisibility({ visibilityProperty: true });
    const style = getComputedStyle(element);
    return style.display === "none" || style.visibility === "hidden";
  };
  const labelOf = (element: Element): string => {
    const aria = element.getAttribute("aria-label");
    if (aria) return aria;
    const by = element.getAttribute("aria-labelledby");
    if (by) {
      const text = by.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? "").join(" ").trim();
      if (text) return text;
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      const label = element.labels?.[0]?.textContent?.trim();
      if (label) return label;
      const placeholder = element.getAttribute("placeholder");
      if (placeholder) return placeholder;
      if (element instanceof HTMLInputElement && element.value && (element.type === "submit" || element.type === "button")) return element.value;
    }
    const text = (element as HTMLElement).innerText?.trim();
    if (text) return text;
    return element.querySelector("img[alt]")?.getAttribute("alt") ?? element.getAttribute("title") ?? element.getAttribute("name") ?? "";
  };
  const kindOf = (element: Element): string => {
    const role = element.getAttribute("role");
    if (role) return role;
    const tag = element.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (element instanceof HTMLInputElement) return element.type === "submit" || element.type === "button" ? "button" : `${element.type} field`;
    if (tag === "textarea") return "text field";
    if (tag === "select") return "choice";
    return tag;
  };
  const stateOf = (element: Element): string => {
    if (element instanceof HTMLInputElement) {
      if (element.type === "checkbox" || element.type === "radio") return element.checked ? " (checked)" : " (not checked)";
      if (element.type === "password") return element.value ? " (filled in)" : "";
      if (element.type === "submit" || element.type === "button") return element.disabled ? " (disabled)" : "";
      return element.value ? ` (currently: "${element.value.slice(0, 200)}")` : "";
    }
    if (element instanceof HTMLTextAreaElement) return element.value ? ` (currently: "${element.value.slice(0, 200)}")` : "";
    if (element instanceof HTMLSelectElement) {
      return ` (options: ${[...element.options].map(option => `${option.selected ? "* " : ""}${option.text.trim()}`).join(" | ")})`;
    }
    if ((element as HTMLButtonElement).disabled || element.getAttribute("aria-disabled") === "true") return " (disabled)";
    const expanded = element.getAttribute("aria-expanded");
    if (expanded) return expanded === "true" ? " (open)" : " (closed)";
    return "";
  };
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { buffer += ` ${node.textContent ?? ""}`; return; }
    if (!(node instanceof Element)) return;
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|IFRAME|CANVAS|svg)$/i.test(node.tagName) || hidden(node)) return;
    if (node.matches(interactive)) {
      flush();
      let id = node.getAttribute(attribute);
      if (!id) { id = `c${next++}`; node.setAttribute(attribute, id); }
      controls.push(id);
      lines.push(`[${id} ${kindOf(node)}] ${labelOf(node).replace(/\s+/g, " ").trim().slice(0, 200)}${stateOf(node)}`);
      return;
    }
    const isBlock = block.test(node.tagName);
    if (isBlock) flush();
    const heading = /^H([1-6])$/.exec(node.tagName);
    if (heading) buffer += `${"#".repeat(Number(heading[1]))} `;
    node.childNodes.forEach(child => visit(child));
    if (isBlock) flush();
  };
  visit(document.body);
  flush();
  root.setAttribute(`${attribute}-next`, String(next));
  return { title: document.title, lines, controls };
}

/** Lines from `offset` until the character budget is spent. */
export function windowLines(lines: readonly string[], offset: number, limit: number) {
  const start = Math.max(0, Math.min(offset, Math.max(0, lines.length - 1)));
  let end = start, size = 0;
  while (end < lines.length && (end === start || size + lines[end].length + 1 <= limit)) { size += lines[end].length + 1; end++; }
  return { start, end, lines: lines.slice(start, end).map(line => line.slice(0, limit)) };
}

export interface InboxMessage { subject: string; text: string; links: { id: string; label: string; url: string }[] }
export interface SessionDiagnostics {
  entryChannels: ("mailed-link" | "typed-url")[];
  failedActions: number;
  refusedValues: number;
  typedEmails: string[];
}
export interface LiveSessionOptions {
  browser: Browser;
  sessionId: string;
  baseURL: string;
  /** Exact origins the participant's context may reach; everything else is refused. */
  allowedOrigins: readonly string[];
  startPath: string;
  textLimit: number;
  actionTimeoutMs: number;
  /** Runs before counting starts, in its own tab: signing in is not the task. */
  prepare?: (page: Page) => Promise<void>;
  inbox?: readonly InboxMessage[];
  /** Decides completion after the session, from the path and any database fact. */
  complete: (state: { paths: readonly string[]; context: BrowserContext; diagnostics: SessionDiagnostics }) => Promise<boolean>;
}
export type LiveSession = Omit<BrowserAdapter, "record"> & { record(): Promise<BrowserRecord>;
  diagnostics(): SessionDiagnostics; paths(): readonly string[] };

export async function openLiveSession(options: LiveSessionOptions): Promise<LiveSession> {
  const allowed = new Set(options.allowedOrigins.map(origin => new URL(origin).origin));
  const context = await options.browser.newContext({ baseURL: options.baseURL, serviceWorkers: "block" });
  try {
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      return (url.protocol === "http:" || url.protocol === "https:") && !allowed.has(url.origin)
        ? route.abort("blockedbyclient") : route.continue();
    });
    if (options.prepare) {
      const setup = await context.newPage();
      await options.prepare(setup);
      await setup.close();
    }
    await context.addInitScript(key => {
      const bump = () => {
        // A refused storage reads back as zero actions, which can only fail a
        // ceiling-free task and never passes a task with a floor.
        try { window.sessionStorage.setItem(key, String(Number(window.sessionStorage.getItem(key) ?? "0") + 1)); } catch { /* counted as zero */ }
      };
      for (const name of ["click", "submit"]) window.addEventListener(name, bump, true);
    }, COUNTER_KEY);
    let page = await context.newPage();
    context.on("page", opened => { page = opened; });
    const paths: string[] = [];
    const track = () => {
      try {
        const url = new URL(page.url());
        if (allowed.has(url.origin) && paths.at(-1) !== url.pathname) paths.push(url.pathname);
      } catch { /* about:blank */ }
    };
    page.on("framenavigated", frame => { if (frame === page.mainFrame()) track(); });
    await page.goto(options.startPath, { waitUntil: "domcontentloaded" });
    track();
    const inboxLinks = new Map((options.inbox ?? []).flatMap(message => message.links.map(link => [link.id, link.url] as const)));
    const diagnostics: SessionDiagnostics = { entryChannels: [], failedActions: 0, refusedValues: 0, typedEmails: [] };
    let counted = 0, offset = 0, lastPath = options.startPath, note: string | undefined, lastWindowEnd = 0;
    const readCount = async () => {
      try {
        const raw = await page.evaluate(key => window.sessionStorage.getItem(key), COUNTER_KEY);
        counted = Math.max(counted, Number(raw ?? "0"));
      } catch { /* a page mid-navigation keeps the last count */ }
    };
    const settle = async () => {
      await page.waitForLoadState("domcontentloaded", { timeout: options.actionTimeoutMs }).catch(() => {});
      await page.waitForTimeout(300);
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
    };
    const guard = (value: string) => {
      const emails = value.match(/[^\s@<>"']+@[^\s@<>"']+/g) ?? [];
      for (const email of emails) {
        if (!SYNTHETIC_EMAIL.test(email)) {
          diagnostics.refusedValues++;
          note = "This test environment only accepts made-up email addresses ending in @e2e.local.";
          return false;
        }
        diagnostics.typedEmails.push(email.toLowerCase());
      }
      return true;
    };
    const control = (target: string) => page.locator(`[${CONTROL_ATTRIBUTE}="${target}"]`).first();
    const session: LiveSession = {
      id: options.sessionId,
      diagnostics: () => structuredClone(diagnostics),
      paths: () => [...paths],
      async observe() {
        await readCount();
        let snapshot = { title: "", lines: [] as string[], controls: [] as string[] };
        try { snapshot = await page.evaluate(snapshotDocument, CONTROL_ATTRIBUTE); }
        catch { note ??= "The page is still loading."; }
        const path = (() => { try { return new URL(page.url()).pathname || "/"; } catch { return "/"; } })();
        if (path !== lastPath) { offset = 0; lastPath = path; }
        const shown = windowLines(snapshot.lines, offset, options.textLimit);
        lastWindowEnd = shown.end;
        const visible = new Set(shown.lines.map(line => /^\[([A-Za-z0-9_-]+) /.exec(line)?.[1]).filter(Boolean));
        const text = [
          `Page title: ${snapshot.title || "(none)"}`,
          ...(note ? [`Note: ${note}`] : []),
          ...(shown.start > 0 || shown.end < snapshot.lines.length
            ? [`(Showing part of this page: lines ${shown.start + 1} to ${shown.end} of ${snapshot.lines.length}. Scroll to see more.)`] : []),
          ...shown.lines,
          ...(options.inbox?.length ? ["", "--- Your email inbox (outside the website) ---",
            ...options.inbox.flatMap(message => [`Email: "${message.subject}"`, message.text,
              ...message.links.map(link => `[${link.id} mailed-link] ${link.label}`)])] : []),
        ].join("\n");
        note = undefined;
        return { path, visibleText: text.slice(0, 65_536),
          controls: [...snapshot.controls.filter(id => visible.has(id)), ...inboxLinks.keys()] };
      },
      async act(action: BrowserAction) {
        const before = page.url();
        try {
          if (action.kind === "click") {
            const mailed = inboxLinks.get(action.target);
            if (mailed) { diagnostics.entryChannels.push("mailed-link"); await page.goto(mailed, { waitUntil: "domcontentloaded" }); }
            else await control(action.target).click({ timeout: options.actionTimeoutMs });
          } else if (action.kind === "type" || action.kind === "submit") {
            if (guard(action.value)) {
              await control(action.target).fill(action.value, { timeout: options.actionTimeoutMs });
              if (action.kind === "submit") await control(action.target).press("Enter", { timeout: options.actionTimeoutMs });
            }
          } else if (action.kind === "scroll") {
            offset = action.direction === "down" ? Math.max(0, lastWindowEnd - 2) : Math.max(0, offset - Math.max(1, lastWindowEnd - offset));
          } else if (action.kind === "entry") {
            const target = new URL(action.path, options.baseURL);
            const mailed = [...inboxLinks.values()].find(url => new URL(url).pathname === target.pathname);
            if (action.channel === "mailed-link" && !mailed) note = "There is no email with that link.";
            else {
              diagnostics.entryChannels.push(action.channel);
              await page.goto(action.channel === "mailed-link" ? mailed! : target.href, { waitUntil: "domcontentloaded" });
            }
          }
          if (action.kind !== "scroll") await settle();
        } catch {
          diagnostics.failedActions++;
          note = "That did not work. The page may have changed; look at it again.";
        }
        if (page.url() !== before) track();
        await readCount();
      },
      async record(): Promise<BrowserRecord> {
        await readCount();
        const completed = await options.complete({ paths, context, diagnostics });
        return { completed, path: paths.length ? [...paths] : [options.startPath], actions: counted,
          entries: diagnostics.entryChannels.length, confirmationExclusions: [] };
      },
      async close() { await context.close(); },
    };
    return session;
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}
