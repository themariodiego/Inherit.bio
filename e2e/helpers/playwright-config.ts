import type { PlaywrightTestConfig } from "@playwright/test";

/**
 * The suite's own configuration, loaded at run time. A dynamic import of the
 * CommonJS-compiled config arrives wrapped once more than a static import
 * (`{ default: { default: config } }`), so unwrap it before reading
 * `webServer`; a static import is unwrapped by the loader itself.
 */
export async function loadPlaywrightConfig(): Promise<PlaywrightTestConfig> {
  // Loaded on demand: the configuration refuses to load outside a browser run.
  const loaded = (await import("../../playwright.config")).default as PlaywrightTestConfig & { default?: PlaywrightTestConfig };
  return loaded.default ?? loaded;
}
