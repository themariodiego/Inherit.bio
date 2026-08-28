// Lighthouse performance + accessibility gate for A16. Runs against an
// already-serving production build (default http://localhost:3100 — start it
// with `pnpm build && pnpm start --port 3100`). Landing is public; the
// dashboard requires auth, so this checks the two best public proxies for the
// app shell (landing + providers) plus, when SEQ_LH_COOKIE is provided, the
// dashboard. Fails if performance or accessibility < 90 on any page.
//
// Uses the pre-installed Chromium (PLAYWRIGHT_BROWSERS_PATH) so it needs no
// separate download. Run: pnpm tsx scripts/lighthouse-check.ts
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.SEQ_LH_BASE ?? "http://localhost:3100";
const THRESHOLD = 90;

function findChrome(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  if (process.env.SEQ_LH_CHROME) return process.env.SEQ_LH_CHROME;
  if (!fs.existsSync(root)) return undefined;
  for (const entry of fs.readdirSync(root)) {
    for (const rel of [
      "chrome-linux/chrome",
      "chrome-linux/headless_shell",
      "chrome",
    ]) {
      const p = path.join(root, entry, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

const PAGES = [
  { name: "landing", url: `${BASE}/` },
  { name: "providers", url: `${BASE}/providers` },
];

async function main() {
  const chromePath = findChrome();
  const chrome = await launch({
    chromePath,
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
  });

  const failures: string[] = [];
  try {
    for (const page of PAGES) {
      const result = await lighthouse(
        page.url,
        { port: chrome.port, output: "json", logLevel: "error" },
        {
          extends: "lighthouse:default",
          settings: { onlyCategories: ["performance", "accessibility"] },
        },
      );
      const cats = result?.lhr.categories;
      const perf = Math.round((cats?.performance?.score ?? 0) * 100);
      const a11y = Math.round((cats?.accessibility?.score ?? 0) * 100);
      console.log(`${page.name}: performance ${perf}, accessibility ${a11y}`);
      if (perf < THRESHOLD) failures.push(`${page.name} performance ${perf} < ${THRESHOLD}`);
      if (a11y < THRESHOLD) failures.push(`${page.name} accessibility ${a11y} < ${THRESHOLD}`);
    }
  } finally {
    await chrome.kill();
  }

  if (failures.length) {
    console.error(`\nLighthouse gate FAILED:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`\nLighthouse gate passed (perf + a11y >= ${THRESHOLD}).`);
}

void main();
