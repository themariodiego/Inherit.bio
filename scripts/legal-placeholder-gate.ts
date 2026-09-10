// CI gate: legal/consent surfaces must contain no placeholder text — for
// example a bracketed operator instruction or an "N/A" section. Checks
// rendered pages when SERVER_URL is set (E2E/CI
// with a running server); otherwise greps the page sources.
//
// Also carries the G5.7 checks, which G1.8 requires this gate to run: no
// payment processor anywhere in the application, and no price, call to action
// or marketing superlative on a legal or disclosure surface.
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
];

/**
 * G5.7, second half: a legal or disclosure surface carries no price, call to
 * action or superlative. Applied only to the legal surfaces above — third-party
 * provider prices in `data/providers/providers.json` are quotations of other
 * companies' published prices, explicitly not a fee path, and are never
 * scanned here.
 *
 * Deliberately narrow. "best" and "leading" are omitted because legal prose
 * uses both innocently ("to the best of our knowledge", "leading to"), and a
 * gate that cries wolf on a terms page gets disabled. What is left is wording
 * no legal document has a reason to contain. This does not claim to detect a
 * "marketing claim" in general; that half of the brief's sentence stays a human
 * review, and the acceptance row says so.
 */
const FEE_PATTERNS: [RegExp, string][] = [
  [/[$£€]\s?\d/, "a price"],
  [/\b\d+(?:\.\d{2})?\s?(?:USD|EUR|GBP)\b/, "a price"],
  [/\b(?:per month|per year|\/month|\/year|monthly fee|annual fee)\b/i, "a recurring charge"],
  [/\b(?:sign up now|get started|buy now|order now|upgrade now|start your free trial)\b/i, "a call to action"],
  [/\b(?:world-class|unmatched|revolutionary|cutting-edge|state-of-the-art|industry-leading)\b/i, "a superlative"],
  [/(?:^|\s)#1(?:\s|$)/, "a superlative"],
];

/**
 * G5.7, first half: no route submits to a payment processor and no
 * payment-processor origin appears in a response. Checked as origins and
 * package names rather than words like "checkout" or "billing", which the
 * repository uses innocently — `capture-emails.ts` means a git checkout, and
 * the export route carries a comment saying there is deliberately no billing.
 * Matching those would make the gate noise. Provider names are word-bounded
 * because an unbounded "adyen" matches "ReadyEnvelope".
 */
const PAYMENT_ORIGINS = /\b(?:js|api|checkout|connect)?\.?(?:stripe|paypal|paddle|lemonsqueezy|braintreegateway|adyen|razorpay|klarna|squareup|mollie|worldpay)\.com\b/i;
const PAYMENT_PACKAGES = /^(?:@?(?:stripe|paddle|lemonsqueezy|braintree|adyen|razorpay|klarna|square|mollie)\b|paypal-|react-stripe)/i;

function paymentProcessorFailures(): string[] {
  const found: string[] = [];
  const manifest = JSON.parse(fs.readFileSync("package.json", "utf8"));
  for (const scope of ["dependencies", "devDependencies"] as const) {
    for (const name of Object.keys(manifest[scope] ?? {})) {
      if (PAYMENT_PACKAGES.test(name)) found.push(`package.json ${scope}: payment processor package "${name}"`);
    }
  }
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(tsx?|jsx?)$/.test(entry.name) || /\.(test|spec)\./.test(entry.name)) continue;
      const match = PAYMENT_ORIGINS.exec(fs.readFileSync(full, "utf8"));
      if (match) found.push(`${full}: payment-processor origin "${match[0]}"`);
    }
  };
  walk("src");
  return found;
}

// Only meaningful on rendered text: in TSX source, `[]` is array syntax.
const RENDERED_ONLY_PATTERNS: [RegExp, string][] = [
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

type FeeException = { surfaces: string[]; label: string; match: string };
const EXCEPTIONS: FeeException[] = JSON.parse(
  fs.readFileSync("scripts/legal-fee-exceptions.json", "utf8")).exceptions;
const usedExceptions = new Set<FeeException>();

/**
 * Keyed on the surrounding wording, not the raw match: `[$£€]\s?\d` matches
 * the two characters "$1", which is neither stable nor legible in the record.
 * The exception names the phrase a reader would recognise, so rewording the
 * clause makes the entry stale instead of silently keeping it excused.
 */
function excused(name: string, label: string, context: string): boolean {
  const hit = EXCEPTIONS.find(exception => exception.label === label
    && context.includes(exception.match) && exception.surfaces.includes(name));
  if (hit) usedExceptions.add(hit);
  return Boolean(hit);
}

function check(
  name: string,
  text: string,
  failures: string[],
  rendered: boolean,
) {
  const patterns = rendered
    ? [...PATTERNS, ...RENDERED_ONLY_PATTERNS, ...FEE_PATTERNS]
    : [...PATTERNS, ...FEE_PATTERNS];
  for (const [re, label] of patterns) {
    // Every match, not just the first. One excused match must not mask a later
    // one of the same pattern in the same file — an exception that silences the
    // rest of the page would make this gate useless exactly where it is needed.
    const all = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    for (const m of text.matchAll(all)) {
      const context = text.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, " ");
      if (!excused(name, label, context)) {
        failures.push(`${name}: ${label} — "…${context}…"`);
      }
    }
  }
}

async function main() {
  const failures: string[] = [];
  const serverUrl = process.env.SERVER_URL;
  // Repository-wide, so it runs identically in both modes.
  failures.push(...paymentProcessorFailures());

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
      check(route, text, failures, true);
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
            check(path.relative(process.cwd(), p), fs.readFileSync(p, "utf8"), failures, false);
          }
        }
      };
      walk(full);
    }
    console.log(`checked ${count} source files (set SERVER_URL for rendered-page mode)`);
  }

  // An exception that no longer matches is stale: the wording changed, so the
  // record must too. Only enforced in source mode, since rendered mode visits
  // routes rather than files and an exception may be keyed to either.
  if (!serverUrl) {
    for (const exception of EXCEPTIONS) {
      if (!usedExceptions.has(exception)) {
        failures.push(`scripts/legal-fee-exceptions.json: stale exception — ${exception.label} "${exception.match}" no longer matches ${exception.surfaces.join(" or ")}`);
      }
    }
  }

  if (failures.length > 0) {
    console.error(`\nLEGAL PLACEHOLDER GATE FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("legal placeholder gate passed");
}

void main();
