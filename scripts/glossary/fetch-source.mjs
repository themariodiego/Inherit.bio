#!/usr/bin/env node
/**
 * Fetch one glossary source and save a snapshot of what it ACTUALLY says.
 *
 * WHY THIS EXISTS RATHER THAN A WEB-FETCH TOOL. On 2026-09-12 a summarising
 * fetch of the NHGRI page for "polygenic risk score" reported
 * "Last Updated: September 12, 2026". That page carries no last-updated date
 * anywhere in its HTML — the model had substituted the current date. The
 * definition it quoted was real; the metadata was not.
 *
 * A citation register exists to make provenance checkable, so a fabricated
 * date in it is worse than a missing one: it looks like evidence. This script
 * therefore reads the RAW bytes and records only strings it can point at:
 *
 *   - `definition` is a substring of the fetched HTML, matched from the page's
 *     own metadata, never paraphrased and never generated;
 *   - `fetchedAt` is this machine's clock at the moment of the request, which
 *     is the one date anybody here can honestly attest to;
 *   - `pageSha256` is over the exact bytes received, so the snapshot can be
 *     shown to correspond to a real response;
 *   - a page date is recorded ONLY when a date string is found in the bytes,
 *     and is `null` otherwise. Absent means absent.
 *
 * Nothing here decides whether a source is appropriate for a term. That is a
 * judgement, made by a person reading the output, and the script prints what
 * it found so that judgement is made against the page rather than a summary.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [, , term, url, wantedQuote, outputDirectory] = process.argv;
if (!term || !url) {
  console.error("usage: fetch-source.mjs <term> <url> [quote-that-must-appear-verbatim] [output-dir]");
  process.exit(2);
}

const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
if (!response.ok) {
  console.error(`FETCH FAILED ${response.status} ${url}`);
  process.exit(1);
}
const html = await response.text();
const fetchedAt = new Date().toISOString();
const pageSha256 = createHash("sha256").update(html).digest("hex");

const unescape = (value) => value
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");

/** The page's own description metadata, which is where these glossaries put the definition. */
const meta = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
  ?? html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);

/** A page date only if the bytes carry one. No inference, no today's date. */
const datePatterns = [
  /<meta[^>]+property=["']article:modified_time["'][^>]+content=["']([^"']+)["']/i,
  /<time[^>]+datetime=["']([^"']+)["']/i,
  /(?:last\s+updated|last\s+reviewed|last\s+modified)\s*:?\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i,
];
let pageDate = null;
for (const pattern of datePatterns) {
  const found = html.match(pattern);
  if (found) { pageDate = found[1].trim(); break; }
}

const slug = term.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// Defaults to the glossary, but the jurisdiction research uses the same tool
// on purpose: one verified-fetch path in this repository, not two that can
// drift in what they check.
const directory = outputDirectory ?? path.join("docs", "sources", "glossary");
await mkdir(directory, { recursive: true });
const file = path.join(directory, `${slug}.json`);
const snapshot = {
  term,
  url,
  finalUrl: response.url,
  fetchedAt,
  pageBytes: Buffer.byteLength(html),
  pageSha256,
  pageTitle: title ? unescape(title[1]).trim() : null,
  pageDate,
  definition: meta ? unescape(meta[1]).trim() : null,
  quote: null,
};

// A quote is recorded only after being FOUND in the bytes. The register's
// quotes are the part a reader checks first, so one that cannot be located in
// the page it names is the worst possible entry: it reads as evidence and is
// not. Typographic apostrophes are folded, because the page serves U+2019 and
// a caller typing an ASCII quote is not making a different claim.
if (wantedQuote) {
  const fold = (value) => unescape(value).replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ").trim();
  const haystack = fold(html.replace(/<[^>]+>/g, " "));
  if (!haystack.includes(fold(wantedQuote))) {
    console.error(`QUOTE NOT FOUND in ${response.url}`);
    console.error(`  wanted: ${wantedQuote}`);
    console.error("  Nothing was saved. Do not record a quote a page does not carry.");
    process.exit(1);
  }
  snapshot.quote = fold(wantedQuote);
}
await writeFile(file, `${JSON.stringify(snapshot, null, 2)}\n`);

console.log(`saved ${file}`);
console.log(`  title      ${snapshot.pageTitle}`);
console.log(`  page date  ${snapshot.pageDate ?? "(none in the bytes — do not invent one)"}`);
console.log(`  final url  ${snapshot.finalUrl}`);
console.log(`  definition ${snapshot.definition ?? "(no description metadata — needs a different extraction)"}`);
if (snapshot.quote) console.log(`  quote      VERIFIED PRESENT: ${snapshot.quote}`);
