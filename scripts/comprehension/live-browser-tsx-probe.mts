/**
 * Test probe for `live-browser.test.ts`: reads the test's synthetic site
 * through `openLiveSession` under tsx, the loader the owned and fresh
 * launchers use, and prints what a participant would see as one JSON line.
 * Vitest's own transform hides loader-dependent page code, so the session
 * must be driven from a tsx-loaded module to prove the owned path.
 * Nothing here is the product or a participant.
 */
import { chromium } from "@playwright/test";
import { openLiveSession } from "./live-browser";

const origin = process.argv[2];
if (!origin || new URL(origin).origin !== origin) throw new Error("Synthetic site origin required");
const browser = await chromium.launch();
try {
  const session = await openLiveSession({ browser, sessionId: "tsx-probe", baseURL: origin, allowedOrigins: [origin],
    startPath: "/", textLimit: 4000, actionTimeoutMs: 3000, complete: async ({ paths }) => paths.includes("/second") });
  try {
    const first = await session.observe();
    await session.act({ kind: "click", target: "c0" });
    const second = await session.observe();
    const record = await session.record();
    process.stdout.write(`${JSON.stringify({ first, second, record, diagnostics: session.diagnostics() })}\n`);
  } finally { await session.close(); }
} finally { await browser.close(); }
