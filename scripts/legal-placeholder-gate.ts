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

/**
 * G5.8: the eight protective statements, checked by anchor id rather than by
 * prose, which is what the brief asks for. A statement recorded as present
 * must still carry its anchor — that is the regression this catches, a clause
 * quietly dropped in an edit. One recorded as absent must still be absent, so
 * adding the missing clause fails here until the record is updated, rather
 * than the record silently going stale.
 */
type AnchorRequirement = { requirement: string; anchorId: string; status: string };
function legalAnchorFailures(): string[] {
  const record = JSON.parse(fs.readFileSync("scripts/legal-anchor-requirements.json", "utf8"));
  const source = fs.readFileSync(record.surface, "utf8");
  const found: string[] = [];
  for (const statement of record.statements as AnchorRequirement[]) {
    const anchored = source.includes(`"${statement.anchorId}"`);
    if (statement.status.startsWith("present") && !anchored) {
      found.push(`${record.surface}: anchor "${statement.anchorId}" is gone — ${statement.requirement}`);
    }
    if (statement.status === "absent" && anchored) {
      found.push(`scripts/legal-anchor-requirements.json: "${statement.anchorId}" now exists on the page; record it as present — ${statement.requirement}`);
    }
  }
  return found;
}

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

/**
 * G1.8 wants every legal, consent and disclosure route, "including new ones".
 * A hand-kept list cannot honour that clause — this one had drifted to four of
 * the fourteen legal routes that exist — so the list is derived from the
 * filesystem and a new page is covered the day it lands.
 *
 * Dynamic segments are skipped: `/legal/[artifact]` and `/legal/consent/[key]`
 * have no fetchable URL without knowing valid parameter values, and inventing
 * one would test a 404 rather than a document. Their prose is still checked in
 * source mode, which walks the whole directory.
 */
const FIXED_ROUTES = ["/about", "/privacy", "/terms"];

function legalRoutes(): string[] {
  const root = "src/app/(marketing)/legal";
  const routes: string[] = [];
  const walk = (directory: string, segments: string[]) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        if (/^page\.(tsx|ts|jsx|js)$/.test(entry.name)) routes.push(`/legal${segments.map(s => `/${s}`).join("")}`);
        continue;
      }
      if (entry.name.startsWith("[") || entry.name.startsWith("@") || entry.name.startsWith("_")) continue;
      walk(path.join(directory, entry.name), [...segments, entry.name]);
    }
  };
  walk(root, []);
  return routes.sort();
}

const ROUTES = [...FIXED_ROUTES, ...legalRoutes()];

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
  // Repository-wide, so both run identically in either mode.
  failures.push(...paymentProcessorFailures());
  failures.push(...legalAnchorFailures());

  if (serverUrl) {
    for (const route of ROUTES) {
      // An unreachable server, a refused connection or a read that dies
      // part-way is a gate failure, not an unhandled throw. Without this the
      // process exits on the first bad route with a stack trace and no report,
      // which reads as a broken gate rather than a broken page — and rendered
      // mode is exactly where that happens, because it depends on a server
      // someone else started.
      let res: Response;
      let html: string;
      try {
        res = await fetch(`${serverUrl}${route}`);
        if (!res.ok) {
          failures.push(`${route}: HTTP ${res.status} — legal page missing`);
          continue;
        }
        html = await res.text();
      } catch (error) {
        failures.push(`${route}: unreachable — ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      // Scope to the <main> landmark. The site header and footer are on every
      // page, so the nav's "Get started" link would otherwise be reported as a
      // call to action on all seventeen legal routes at once — seventeen copies
      // of one finding about the chrome, saying nothing about the legal text
      // underneath it. X6.1 excludes persistent navigation from its budgets for
      // the same reason.
      //
      // A missing landmark fails rather than falling back to the whole
      // document. The fallback is the tempting version and it is the wrong one:
      // it would quietly restore the header-matching behaviour on exactly the
      // page that lost its landmark, and the gate would go green while checking
      // the wrong text.
      const start = html.indexOf("<main");
      const end = html.lastIndexOf("</main>");
      if (start === -1 || end === -1 || end < start) {
        failures.push(`${route}: no <main> landmark — cannot separate the document from the site chrome`);
        continue;
      }
      // Strip tags/scripts so we test the rendered text, not code.
      const text = html.slice(start, end)
        .replace(/<script[\s\S]*?<\/script>/g, "")
        .replace(/<style[\s\S]*?<\/style>/g, "")
        .replace(/<[^>]+>/g, " ");
      check(route, text, failures, true);
    }
    console.log(`checked ${ROUTES.length} rendered routes`);
    if (ROUTES.length < 12) {
      failures.push(`route discovery found only ${ROUTES.length} legal routes — the walker is broken, not the product`);
    }
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
