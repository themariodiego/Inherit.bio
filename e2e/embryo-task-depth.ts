import type { Page } from "@playwright/test";
import register from "../docs/route-register.json";
import { taskSixTrace } from "../scripts/comprehension/participant-c-seed";

const KEY = "__inheritTaskSixActions";
export async function startTaskSixTrace(page: Page) {
  const events = register.navigationContract.taskDepthActions.countedEvents;
  if (events.join(",") !== "click,submit") throw new Error("Task-depth event contract changed");
  const install = ({ key, events }: { key: string; events: string[] }) => {
    for (const event of events) window.addEventListener(event, () => {
      const raw = window.sessionStorage.getItem(key);
      if (raw === null) throw new Error("Task T6 trace lost");
      const trace = JSON.parse(raw);
      trace.push({ event, path: window.location.pathname });
      window.sessionStorage.setItem(key, JSON.stringify(trace));
    }, true);
  };
  await page.evaluate(key => window.sessionStorage.setItem(key, "[]"), KEY);
  await page.addInitScript(install, { key: KEY, events });
  await page.evaluate(install, { key: KEY, events });
}
export async function readTaskSixTrace(page: Page) {
  return taskSixTrace(await page.evaluate(key => window.sessionStorage.getItem(key), KEY),
    register.navigationContract.taskDepthActions.ceilings.T6);
}
