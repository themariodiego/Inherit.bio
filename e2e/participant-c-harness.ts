import type { Browser } from "@playwright/test";
import { expect } from "./audited-test";
import { signIn, SUPABASE_URL } from "./helpers";
import { openLiveSession } from "../scripts/comprehension/live-browser";
import { participantCPublication } from "../scripts/comprehension/participant-c-seed";
import { EMBRYO_APP_PORT } from "../scripts/ci-browser-config";
import { GATE_BUTTON } from "@/copy/embryos/gate";

/** One native rehearsal consumes the just-completed journey's credentials.
 * It never seeds or reuses a cohort across persona simulations. Its caller
 * reads the actual DB and isolated worker proof before setup and completion. */
export async function openParticipantCReadSession(options: {
  browser: Browser; sessionId: string; ownerId: string; cohortId: string;
  email: string; password: string; read: () => Promise<unknown>;
}) {
  const current = async () => participantCPublication(await options.read(), options.ownerId, options.cohortId);
  await current();
  const origin = `http://localhost:${EMBRYO_APP_PORT}`;
  return openLiveSession({ browser: options.browser, sessionId: options.sessionId,
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
    },
    complete: async ({ paths }) => {
      await current();
      return paths[0] === "/overview" && paths.includes("/embryos/compare");
    },
  });
}
