// CI gate: legal/consent surfaces must contain no placeholder text — the
// incumbent pattern this project exists to avoid ("[Nebula to specify…]",
// "N/A" sections). Checks rendered pages when SERVER_URL is set (E2E/CI
// with a running server); otherwise greps the page sources.
import fs from "node:fs";
import path from "node:path";

const PATTERNS: [RegExp, string][] = [
  [/\[[^\]\n]{0,60}(specify|insert|company|todo|tbd|date here)[^\]\n]{0,60}\]/i, "bracketed placeholder"],
  [/\bTODO\b/, "TODO"],
  [/\bFIXME\b/, "FIXME"],
  [/\bTBD\b/, "TBD"],
  [/\bXXX\b/, "XXX"],
  [/lorem ipsum/i, "lorem ipsum"],
  [/\bN\/A\b/i, "N/A section"],
  [/\bPLACEHOLDER\b/i, "PLACEHOLDER"],
  [/\[\s*\]/, "empty brackets"],
];

const ROUTES = [
  "/about",
  "/privacy",
  "/terms",
  "/legal/research-consent",
  "/legal/law-enforcement",
  "/legal/deceased",
  "/legal/gina",
];

const SOURCE_DIRS = [
  "src/app/(marketing)/about",
  "src/app/(marketing)/privacy",
  "src/app/(marketing)/terms",
  "src/app/(marketing)/legal",
  "src/components/legal",
];

function check(name: string, text: string, failures: string[]) {
  for (const [re, label] of PATTERNS) {
    const m = re.exec(text);
    if (m) {
      failures.push(`${name}: ${label} — "…${text.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, " ")}…"`);
    }
  }
}

async function main() {
  const failures: string[] = [];
  const serverUrl = process.env.SERVER_URL;

  if (serverUrl) {
    for (const route of ROUTES) {
      const res = await fetch(`${serverUrl}${route}`);
      if (!res.ok) {
        failures.push(`${route}: HTTP ${res.status} — legal page missing`);
        continue;
      }
      const html = await res.text();
      // Strip tags/scripts so we test the rendered text, not code.
      const text = html
        .replace(/<script[\s\S]*?<\/script>/g, "")
        .replace(/<style[\s\S]*?<\/style>/g, "")
        .replace(/<[^>]+>/g, " ");
      check(route, text, failures);
    }
    console.log(`checked ${ROUTES.length} rendered routes`);
  } else {
    let count = 0;
    for (const dir of SOURCE_DIRS) {
      const full = path.join(process.cwd(), dir);
      if (!fs.existsSync(full)) {
        failures.push(`${dir}: missing — legal surface not implemented`);
        continue;
      }
      const walk = (d: string) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, entry.name);
          if (entry.isDirectory()) walk(p);
          else if (/\.(tsx|ts|mdx?)$/.test(entry.name)) {
            count++;
            check(path.relative(process.cwd(), p), fs.readFileSync(p, "utf8"), failures);
          }
        }
      };
      walk(full);
    }
    console.log(`checked ${count} source files (set SERVER_URL for rendered-page mode)`);
  }

  if (failures.length > 0) {
    console.error(`\nLEGAL PLACEHOLDER GATE FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("legal placeholder gate passed");
}

void main();
