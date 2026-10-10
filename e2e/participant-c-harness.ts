import type { Browser, Page } from "@playwright/test";
import { expect } from "./audited-test";
import { signIn, SUPABASE_URL } from "./helpers";
import { currentNativeReadSession } from "../scripts/comprehension/fresh-native-session";
import { openLiveSession } from "../scripts/comprehension/live-browser";
import { participantCPublication, participantCNoModelSurface } from "../scripts/comprehension/participant-c-seed";
import { EMBRYO_APP_PORT } from "../scripts/ci-browser-config";
import { GATE_BUTTON } from "@/copy/embryos/gate";
import { NO_ROWS_SENTENCE } from "@/copy/embryos/compare";

/** One native rehearsal consumes the just-completed journey's credentials.
 * It never seeds or reuses a cohort across persona simulations. Its caller
 * reads the actual DB and isolated worker proof before setup and completion. */
export async function openParticipantCReadSession(options: {
  browser: Browser; sessionId: string; ownerId: string; cohortId: string;
  email: string; password: string; read: () => Promise<unknown>;
}) {
  const current = async () => participantCPublication(await options.read(), options.ownerId, options.cohortId);
  const noModelSurface = async (page: Page) => {
    await expect(page.locator('[data-slot="no-rows"]').first()).toBeVisible();
    await expect(page.locator('[data-slot="no-rows"]').first()).toHaveText(NO_ROWS_SENTENCE);
    return participantCNoModelSurface({
      notices: await page.locator('[data-slot="no-rows"]').allTextContents(),
      conditionRows: await page.locator('[data-condition-id]').count(),
      figures: await page.locator('[data-figure-kind]').evaluateAll(nodes => nodes.map(node => ({
        kind: node.getAttribute("data-figure-kind"), class: node.getAttribute("data-figure-class"),
      }))),
    });
  };
  await current();
  const origin = `http://localhost:${EMBRYO_APP_PORT}`;
  const session = await openLiveSession({ browser: options.browser, sessionId: options.sessionId,
    baseURL: origin, allowedOrigins: [origin, SUPABASE_URL], startPath: "/overview",
    textLimit: 12_000, actionTimeoutMs: 10_000,
    prepare: async page => {
      await signIn(page, options.email, options.password);
      await page.goto(`/embryos/compare?cohort=${options.cohortId}`);
      await expect(page.locator('[data-slot="cohort-permission"]')).toHaveCount(0);
      await expect(page.locator('[data-slot="consent-required"]')).toHaveCount(0);
      const gate = page.locator('[data-slot="result-gate"]');
      if (await gate.count()) {
        await gate.getByRole("checkbox").check();
        await gate.getByRole("button", { name: GATE_BUTTON }).click();
      }
      await expect(page.locator('[data-slot="result-gate"]')).toHaveCount(0);
      await current();
      await noModelSurface(page);
    },
    complete: async ({ paths, context }) => {
      await current();
      if (paths.at(-1) === "/embryos/compare") {
        const page = context.pages().find(candidate => new URL(candidate.url()).pathname === "/embryos/compare");
        if (!page) throw new Error("Participant-c comparison read unavailable");
        await noModelSurface(page);
      }
      return paths[0] === "/overview" && paths.includes("/embryos/compare");
    },
  });
  return currentNativeReadSession(session, current);
}
