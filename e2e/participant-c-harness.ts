import type { Browser, Page } from "@playwright/test";
import { expect } from "./audited-test";
import { signIn, SUPABASE_URL } from "./helpers";
import { currentNativeReadSession } from "../scripts/comprehension/fresh-native-session";
import { openLiveSession } from "../scripts/comprehension/live-browser";
import { participantCPublication, participantCNoModelSurface, type ParticipantCReadDiagnostic, type ParticipantCReadStage } from "../scripts/comprehension/participant-c-seed";
import { EMBRYO_APP_PORT } from "../scripts/ci-browser-config";
import { GATE_BUTTON } from "@/copy/embryos/gate";
import { NO_ROWS_SENTENCE } from "@/copy/embryos/compare";

/** One native rehearsal consumes the just-completed journey's credentials.
 * It never seeds or reuses a cohort across persona simulations. Its caller
 * reads the actual DB and isolated worker proof before setup and completion. */
export async function openParticipantCReadSession(options: {
  browser: Browser; sessionId: string; ownerId: string; cohortId: string;
  email: string; password: string; read: () => Promise<unknown>; diagnostic?: ParticipantCReadDiagnostic;
}) {
  const diagnose = async <T>(stage: ParticipantCReadStage, work: () => Promise<T>): Promise<T> => {
    try { return await work(); }
    catch (error) {
      try { options.diagnostic?.(stage, error, "unreturned"); } catch { /* Original refusal remains. */ }
      throw error;
    }
  };
  const current = async () => {
    const value = await diagnose("read-native-publication", () => options.read());
    return diagnose("read-publication-contract", async () => participantCPublication(value, options.ownerId, options.cohortId));
  };
  const noModelSurface = async (page: Page) => diagnose("read-no-model-surface", async () => {
    await diagnose("read-no-model-visible", () => expect(page.locator('[data-slot="no-rows"]').first()).toBeVisible());
    await diagnose("read-no-model-text", () => expect(page.locator('[data-slot="no-rows"]').first()).toHaveText(NO_ROWS_SENTENCE));
    const surface = await diagnose("read-no-model-dom", async () => ({
      notices: await page.locator('[data-slot="no-rows"]').allTextContents(),
      conditionRows: await page.locator('[data-condition-id]').count(),
      figures: await page.locator('[data-figure-kind]').evaluateAll(nodes => nodes.map(node => ({
        kind: node.getAttribute("data-figure-kind"), class: node.getAttribute("data-figure-class"),
      }))),
    }));
    return participantCNoModelSurface(surface, (stage, error) => {
      try { options.diagnostic?.(stage, error, "unreturned"); } catch { /* Original schema refusal remains. */ }
    });
  });
  await current();
  const origin = `http://localhost:${EMBRYO_APP_PORT}`;
  const session = await openLiveSession({ browser: options.browser, sessionId: options.sessionId,
    baseURL: origin, allowedOrigins: [origin, SUPABASE_URL], startPath: "/overview",
    textLimit: 12_000, actionTimeoutMs: 10_000, setupDiagnostic: options.diagnostic,
    prepare: async page => {
      await diagnose("read-sign-in", () => signIn(page, options.email, options.password));
      await diagnose("read-comparison-navigation", async () => { await page.goto(`/embryos/compare?cohort=${options.cohortId}`); });
      await diagnose("read-permission", async () => {
        await expect(page.locator('[data-slot="cohort-permission"]')).toHaveCount(0);
        await expect(page.locator('[data-slot="consent-required"]')).toHaveCount(0);
      });
      await diagnose("read-result-gate", async () => {
        const gate = page.locator('[data-slot="result-gate"]');
        if (await gate.count()) {
          await gate.getByRole("checkbox").check();
          await gate.getByRole("button", { name: GATE_BUTTON }).click();
        }
        await expect(page.locator('[data-slot="result-gate"]')).toHaveCount(0);
      });
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
