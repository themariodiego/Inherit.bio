import type { Page } from "@playwright/test";
import { installKeyboardAudit } from "./keyboard-traversal";

/** The existing first-viewport budget, including controls in open shadow
 * roots and slots. Persistent navigation, the skip link and the dock retain
 * their explicit exclusions across the same composed ancestry as the UI. */
export async function firstViewportInteractives(page: Page): Promise<string[]> {
  await page.evaluate(installKeyboardAudit);
  return page.evaluate(() => {
    const probe = window.__keyboardAudit;
    if (!probe) throw new Error("composed control census not installed");
    const selector =
      'a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[contenteditable="true"],[tabindex]:not([tabindex="-1"])';
    const found: string[] = [];
    for (const element of probe.elements().filter(element => element.matches(selector))) {
      if (element.matches('a[href="#main"]')) continue;
      if (probe.closest(element, "nav,[data-copilot-entry]")) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (element.getClientRects().length === 0) continue;
      if (rect.top >= window.innerHeight) continue;
      const name = element.getAttribute("aria-label") ?? element.textContent ?? "";
      found.push(`${element.tagName.toLowerCase()}:${name.trim().slice(0, 40)}`);
    }
    return found;
  });
}
