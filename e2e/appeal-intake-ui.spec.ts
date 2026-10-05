import { createHash } from "node:crypto";
import type { Page, Request, Route } from "@playwright/test";
import { expect, test } from "./audited-test";

/**
 * Page UI only. The actual paused TEST app serves the form, cookie and token.
 * The browser sends its real same-origin POST, which this case holds and then
 * answers deliberately. Native POST/nonce consumption, persistence, evidence,
 * mail, archive and every full-flow hold are outside this controlled reply.
 * No private person or genetic values enter the request or the test output.
 */
const origin = "http://localhost:3102";
const endpoint = `${origin}/api/appeals`;
const submitted = {
  kind: "subject-objection", claimantName: "Synthetic UI requester",
  contactEmail: "synthetic-appeal-ui@e2e.local",
  statement: "This is a synthetic request for a page UI test.", affirmed: true,
  subjectReference: "synthetic-ui-reference",
};

async function fillForm(page: Page) {
  const form = page.locator("main form");
  await form.getByLabel("Request type", { exact: true }).selectOption(submitted.kind);
  await form.getByLabel("Your name", { exact: true }).fill(submitted.claimantName);
  await form.getByLabel("Your email address", { exact: true }).fill(submitted.contactEmail);
  await form.getByLabel("Request or record reference, if available", { exact: true }).fill(submitted.subjectReference);
  await form.getByLabel("Why do you want to make this request? Use 20 to 8,000 characters.", { exact: true }).fill(submitted.statement);
  await form.getByRole("checkbox", { name: "These details match what I know.", exact: true }).check();
}

async function checkControlledReply(page: Page, outcome: "received" | "invalid") {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let entered!: (request: Request) => void;
  const incoming = new Promise<Request>(resolve => { entered = resolve; });
  const pending = new Set<Promise<void>>();
  let intercepted = 0, originalFailed = false, routeError: unknown;
  const handler = (route: Route) => {
    intercepted += 1;
    entered(route.request());
    const operation = (async () => {
    try {
      await held;
      await route.fulfill({ status: outcome === "received" ? 202 : 422,
        headers: { "content-type": "application/json", "cache-control": "private, no-store", "referrer-policy": "no-referrer" },
        body: outcome === "received" ? '{"status":"received"}' : '{"error":"invalid_request","issues":["request"]}' });
    } catch (error) { routeError ??= error; }
    })();
    pending.add(operation);
    void operation.then(() => pending.delete(operation), error => { routeError ??= error; pending.delete(operation); });
    return operation;
  };
  await page.route(endpoint, handler);
  try {
    await page.context().clearCookies();
    const response = await page.goto(`${origin}/legal/appeals`);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"]).toBe("private, no-store");
    expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
    await expect(page.getByRole("heading", { name: "Send a request", exact: true })).toBeVisible();
    const cookies = (await page.context().cookies()).filter(cookie => cookie.name === "__Host-inherit-appeal-form");
    expect(cookies.length).toBe(1);
    const cookie = cookies[0]!;
    // Assert attributes separately so a failed assertion never prints the cookie value.
    expect(cookie.httpOnly && cookie.secure && cookie.sameSite === "Strict" && cookie.path === "/").toBe(true);
    expect(await page.evaluate(() => document.cookie.includes("inherit-appeal-form"))).toBe(false);
    await fillForm(page);
    const form = page.locator("main form");
    await form.getByRole("button", { name: "Send request", exact: true }).click();
    const request = await incoming;
    expect(request.url()).toBe(endpoint);
    expect(request.method()).toBe("POST");
    const headers = await request.allHeaders();
    expect(headers.origin).toBe(origin);
    expect(headers["sec-fetch-site"]).toBe("same-origin");
    expect(headers["content-type"]).toBe("application/json");
    expect(request.postDataJSON()).toEqual(submitted);
    const token = headers["x-inherit-csrf"] ?? "";
    // Read the actual served token only in memory; never fabricate or print one.
    const parts = token.split(".");
    expect(parts.length === 2 && /^[A-Za-z0-9_-]+$/.test(parts[0] ?? "") && /^[0-9a-f]{64}$/.test(parts[1] ?? "")).toBe(true);
    const raw = Buffer.from(parts[0]!, "base64url");
    try {
      let claims: Record<string, unknown>;
      try { claims = JSON.parse(raw.toString("utf8")) as Record<string, unknown>; }
      catch { throw new Error("The served appeal form token is invalid."); }
      const now = Date.now();
      expect(Object.keys(claims).sort()).toEqual(["candidateHash", "expiresAt", "form", "nonce", "version"]);
      expect(claims.version === 1 && claims.form === "appeal-intake"
        && typeof claims.nonce === "string" && /^[A-Za-z0-9_-]{32}$/.test(claims.nonce)
        && claims.candidateHash === createHash("sha256").update(cookie.value, "utf8").digest("hex")
        && typeof claims.expiresAt === "number" && Number.isSafeInteger(claims.expiresAt)
        && claims.expiresAt > now && claims.expiresAt <= now + 600_000).toBe(true);
    } finally { raw.fill(0); }
    const sending = form.getByRole("button", { name: "We send your request now", exact: true });
    await expect(sending).toBeVisible();
    await expect(sending).toBeDisabled();
    await expect(form.getByRole("button", { name: "Send request", exact: true })).toHaveCount(0);
    await expect(form).toBeVisible();
    await expect(page.locator("main").getByRole("status")).toBeEmpty();
    expect(intercepted).toBe(1);
    const answered = page.waitForResponse(endpoint);
    release();
    const reply = await answered;
    expect(reply.status()).toBe(outcome === "received" ? 202 : 422);
    expect(await reply.text()).toBe(outcome === "received" ? '{"status":"received"}' : '{"error":"invalid_request","issues":["request"]}');
    if (outcome === "received") {
      await expect(page.locator("main").getByRole("status")).toHaveText("Request sent.");
      await expect(form).toBeHidden();
    } else {
      await expect(page.locator("main").getByRole("status")).toHaveText("The request could not be sent. Check your details and try again.");
      await expect(form).toBeVisible();
      await expect(form.getByRole("button", { name: "Send request", exact: true })).toBeEnabled();
      await expect(form.getByLabel("Your name", { exact: true })).toHaveValue(submitted.claimantName);
      await expect(form.getByLabel("Your email address", { exact: true })).toHaveValue(submitted.contactEmail);
      await expect(form.getByLabel("Why do you want to make this request? Use 20 to 8,000 characters.", { exact: true })).toHaveValue(submitted.statement);
    }
    expect(intercepted, "one actual submit sends one request").toBe(1);
  } catch (error) { originalFailed = true; throw error; }
  finally {
    release();
    // Settle every actual handler, including a duplicate from a defective app.
    while (pending.size > 0) await Promise.all([...pending]);
    try { await page.unroute(endpoint, handler); }
    catch (error) { routeError ??= error; }
    if (routeError && !originalFailed) throw routeError;
    if (routeError && originalFailed) console.error(JSON.stringify({ event: "appeal-ui-secondary-cleanup-failure", errorName: routeError instanceof Error ? routeError.name : "unknown" }));
  }
}

test("/legal/appeals processing: the real form waits once, then shows the controlled received reply (UI only)", async ({ page }) => {
  await checkControlledReply(page, "received");
});
test("/legal/appeals processing: the real form waits once, then retains its fields after the controlled invalid reply (UI only)", async ({ page }) => {
  await checkControlledReply(page, "invalid");
});
