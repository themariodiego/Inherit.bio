import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractCopyRegistryBlocksFromSource, extractTsxBlocksFromSource } from "./readability-gate";

/**
 * G4.7, the engineering half: `pnpm gate:citations`.
 *
 * "Every scientific claim carries a citation resolvable to a PMID, DOI,
 * statute reference, registry accession or regulator publication, with an
 * access date." `gate:templates` holds that for `data/templates/*.json`. This
 * gate holds it for the other surfaces that can state a fact: report copy,
 * Copilot context text, email copy, and Portrait and embryo card wording. The
 * surfaces are listed in `data/gates/claim-surfaces.json`.
 *
 * No code can decide whether a sentence is a scientific fact. So the gate does
 * the mechanical part only:
 *  1. It reads the user-visible string literals and JSX text of every surface
 *     file, using the same extractors as `gate:readability`, and splits them
 *     into sentences.
 *  2. A sentence carrying any marker in `CLAIM_MARKERS` (a closed list,
 *     pinned by `scripts/citation-surface-gate.test.ts`) is a candidate.
 *  3. A candidate passes when a canonical claim in `data/claims.json`
 *     contains it word for word, and every piece of that claim's evidence
 *     names a citation in `data/citations.json` that carries an access date.
 *  4. Any other candidate must be listed in `docs/claim-surface-backlog.json`,
 *     the human reviewer's worklist, grouped by surface and file. Each entry
 *     holds the sentence, its hash and one verdict: `null` (not yet reviewed),
 *     `"product-wording"` (not a scientific fact; it leaves the open backlog
 *     without any registration) or `"claim-to-register"` (a fact that still
 *     needs its source registered).
 *
 * The ledger is compared in both directions. An unlisted candidate fails, so
 * a new uncited claim fails CI. A listed sentence that no longer appears, or
 * that is now registered, fails too, so the ledger stays exact. The open
 * backlog (entries not marked `"product-wording"`) is pinned by
 * `OPEN_BACKLOG` and can only go down: growing it fails, and shrinking it
 * without lowering the pin fails with the new number to write.
 *
 * Classifying the backlog and registering claims is human review, and stays
 * outside this gate. It needs no network and no database.
 *
 * Division of work with `gate:claims` (G1.11): that gate checks the rendering
 * path — `data-provenance` on claim and figure elements, template report
 * bodies in `data/claims.json`, and whether the designated surfaces' pages
 * reach the shared claim component. It never reads sentences on these files.
 * This gate reads only the sentences, never markup or templates, so no
 * finding is reported by both.
 */

export const OPEN_BACKLOG = 59;

/** The closed marker list. Changing it means re-pinning the backlog, visibly. */
export const CLAIM_MARKERS: readonly { name: string; pattern: RegExp }[] = [
  { name: "percentage", pattern: /\b\d+(?:[.,]\d+)?\s?(?:%|per ?cent\b)/i },
  { name: "multiplier", pattern: /\b\d+(?:\.\d+)?[- ]?(?:fold\b|times\b|x\b)/i },
  {
    name: "natural-frequency",
    pattern: /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:in|out of)\s+(?:\d+|ten|a hundred|a thousand)\b/i,
  },
  { name: "rsid", pattern: /\brs\d{3,}\b/i },
  {
    name: "effect-measure",
    pattern: /\b(?:risk|odds|hazard|heritab\w*|penetran\w*|prevalen\w*|incidence|predispos\w*|susceptib\w*)\b/i,
  },
  { name: "association", pattern: /\b(?:associated with|association|linked to|correlat\w*|causes?|caused by)\b/i },
  {
    name: "evidence",
    pattern: /\b(?:stud(?:y|ies)|trials?|meta-analys\w*|researchers?|research shows|evidence shows|was found|were found|found that)\b/i,
  },
];

export const SURFACE_TYPES = ["report-copy", "copilot-context", "email", "portrait", "embryo-card"] as const;
export type SurfaceType = (typeof SURFACE_TYPES)[number];
export const VERDICTS = ["product-wording", "claim-to-register"] as const;
type Verdict = (typeof VERDICTS)[number] | null;

const SURFACES = "data/gates/claim-surfaces.json";
const BACKLOG = "docs/claim-surface-backlog.json";
const CLAIMS = "data/claims.json";
const CITATIONS = "data/citations.json";
const MIN_WORDS = 4;

export interface SurfaceFile {
  type: SurfaceType;
  path: string;
  source: string;
}

export interface BacklogEntry {
  sha256: string;
  text: string;
  verdict: Verdict;
  reviewedBy?: string;
  reviewedOn?: string;
}

export interface Backlog {
  version: 1;
  purpose: string;
  surfaces: Record<string, Record<string, BacklogEntry[]>>;
}

interface Claim {
  claim_id: string;
  text_verbatim: string;
  evidence: { citation: string; accessed_on?: string }[];
}

interface Citation {
  id: string;
  access_date?: string | null;
}

export interface Candidate {
  type: SurfaceType;
  path: string;
  text: string;
  sha256: string;
  markers: string[];
}

export function normalizeSentence(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function sentenceHash(value: string): string {
  return createHash("sha256").update(normalizeSentence(value), "utf8").digest("hex");
}

export function splitSentences(value: string): string[] {
  return normalizeSentence(value)
    .split(/(?<=[.!?])\s+(?=["“‘'(]?[A-Z0-9])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function claimMarkers(sentence: string): string[] {
  if (sentence.split(" ").filter(Boolean).length < MIN_WORDS) return [];
  return CLAIM_MARKERS.filter((marker) => marker.pattern.test(sentence)).map((marker) => marker.name);
}

/** User-visible text blocks of one surface file, with the readability extractors. */
export function surfaceBlocks(file: SurfaceFile): string[] {
  const blocks = file.path.endsWith(".tsx")
    ? extractTsxBlocksFromSource(file.path, file.source)
    : extractCopyRegistryBlocksFromSource(file.path, file.source);
  return blocks.map((block) => block.text);
}

export function candidates(files: SurfaceFile[]): Candidate[] {
  const found = new Map<string, Candidate>();
  for (const file of files) {
    for (const block of surfaceBlocks(file)) {
      for (const sentence of splitSentences(block)) {
        const markers = claimMarkers(sentence);
        if (markers.length === 0) continue;
        const sha256 = sentenceHash(sentence);
        const key = `${file.type}\u0000${file.path}\u0000${sha256}`;
        if (!found.has(key)) {
          found.set(key, { type: file.type, path: file.path, text: normalizeSentence(sentence), sha256, markers });
        }
      }
    }
  }
  return [...found.values()].sort((a, b) =>
    a.type.localeCompare(b.type) || a.path.localeCompare(b.path) || a.sha256.localeCompare(b.sha256));
}

/** Registered sentences: every sentence of a claim whose evidence all resolves with an access date. */
export function registeredSentences(claims: Claim[], citations: Citation[]): { sourced: Set<string>; unresolved: Set<string> } {
  const dated = new Set(citations.filter((c) => typeof c.access_date === "string" && c.access_date).map((c) => c.id));
  const sourced = new Set<string>();
  const unresolved = new Set<string>();
  for (const claim of claims) {
    const ok = claim.evidence.length > 0
      && claim.evidence.every((e) => dated.has(e.citation) && typeof e.accessed_on === "string" && e.accessed_on !== "");
    for (const sentence of splitSentences(claim.text_verbatim)) {
      (ok ? sourced : unresolved).add(sentenceHash(sentence));
    }
  }
  for (const hash of sourced) unresolved.delete(hash);
  return { sourced, unresolved };
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function openBacklogCount(backlog: Backlog): number {
  return Object.values(backlog.surfaces).flatMap((files) => Object.values(files).flat())
    .filter((entry) => entry.verdict !== "product-wording").length;
}

export function runCitationSurfaceGate(input: {
  files: SurfaceFile[];
  claims: Claim[];
  citations: Citation[];
  backlog: Backlog;
  openBacklog: number;
  today: string;
}): { failures: string[]; candidates: Candidate[]; sourced: number; open: number; classified: number } {
  const failures: string[] = [];
  const found = candidates(input.files);
  const { sourced, unresolved } = registeredSentences(input.claims, input.citations);

  if (input.backlog.version !== 1) failures.push(`${BACKLOG}: version must be 1`);
  const listed = new Map<string, BacklogEntry>();
  for (const [type, files] of Object.entries(input.backlog.surfaces ?? {})) {
    if (!SURFACE_TYPES.includes(type as SurfaceType)) failures.push(`${BACKLOG}: unknown surface type ${type}`);
    const paths = Object.keys(files);
    if (JSON.stringify(paths) !== JSON.stringify([...paths].sort())) {
      failures.push(`${BACKLOG}: ${type} files must be sorted by path`);
    }
    for (const [file, entries] of Object.entries(files)) {
      const hashes = entries.map((entry) => entry.sha256);
      if (JSON.stringify(hashes) !== JSON.stringify([...hashes].sort())) {
        failures.push(`${BACKLOG}: ${type} ${file} entries must be sorted by sha256`);
      }
      for (const entry of entries) {
        const key = `${type}\u0000${file}\u0000${entry.sha256}`;
        if (listed.has(key)) failures.push(`${BACKLOG}: ${type} ${file} lists ${entry.sha256} twice`);
        listed.set(key, entry);
        if (sentenceHash(entry.text) !== entry.sha256) {
          failures.push(`${BACKLOG}: ${type} ${file} ${entry.sha256} does not hash its own text`);
        }
        if (entry.verdict === null || entry.verdict === undefined) {
          if (entry.reviewedBy !== undefined || entry.reviewedOn !== undefined) {
            failures.push(`${BACKLOG}: ${type} ${file} ${entry.sha256} has a reviewer but no verdict`);
          }
        } else if (!VERDICTS.includes(entry.verdict)) {
          failures.push(`${BACKLOG}: ${type} ${file} ${entry.sha256} has an unknown verdict ${entry.verdict}`);
        } else if (!entry.reviewedBy?.trim() || !isCalendarDate(entry.reviewedOn) || entry.reviewedOn > input.today) {
          failures.push(`${BACKLOG}: ${type} ${file} ${entry.sha256} needs reviewedBy and a past reviewedOn date for its verdict`);
        }
      }
    }
  }

  let sourcedCount = 0;
  const seen = new Set<string>();
  for (const candidate of found) {
    const key = `${candidate.type}\u0000${candidate.path}\u0000${candidate.sha256}`;
    seen.add(key);
    if (sourced.has(candidate.sha256)) {
      sourcedCount++;
      if (listed.has(key)) {
        failures.push(`${candidate.path}: "${candidate.text}" is now registered in ${CLAIMS}; remove it from ${BACKLOG}`);
      }
      continue;
    }
    if (listed.has(key)) continue;
    const why = unresolved.has(candidate.sha256)
      ? `its claim in ${CLAIMS} has evidence without a dated citation in ${CITATIONS}`
      : `no claim in ${CLAIMS} carries it`;
    failures.push(
      `${candidate.path}: unsourced ${candidate.type} claim (${candidate.markers.join(", ")}): "${candidate.text}" — ${why}. ` +
        `Register it with a cited source, or list it in ${BACKLOG} for review (sha256 ${candidate.sha256}).`,
    );
  }
  for (const [key, entry] of listed) {
    if (!seen.has(key)) {
      const [type, file] = key.split("\u0000");
      failures.push(`${BACKLOG}: ${type} ${file} lists "${entry.text}", which no surface file states any more; remove it`);
    }
  }

  const open = openBacklogCount(input.backlog);
  if (open > input.openBacklog) {
    failures.push(`${open} backlog sentences are open, up from ${input.openBacklog}; a new claim must arrive with a cited source`);
  } else if (open < input.openBacklog) {
    failures.push(`${open} backlog sentences are open, down from ${input.openBacklog}; lower OPEN_BACKLOG to ${open} so the ratchet holds`);
  }
  return { failures, candidates: found, sourced: sourcedCount, open, classified: listed.size - open };
}

function listSurfaceFiles(repositoryRoot: string, failures: string[]): SurfaceFile[] {
  const register = JSON.parse(fs.readFileSync(path.join(repositoryRoot, SURFACES), "utf8")) as {
    version: number;
    surfaces: { type: SurfaceType; paths: string[] }[];
  };
  if (register.version !== 1) failures.push(`${SURFACES}: version must be 1`);
  const types = register.surfaces.map((surface) => surface.type);
  if (JSON.stringify([...types].sort()) !== JSON.stringify([...SURFACE_TYPES].sort())) {
    failures.push(`${SURFACES}: must list exactly the surface types ${SURFACE_TYPES.join(", ")}`);
  }
  const files: SurfaceFile[] = [];
  const claimed = new Set<string>();
  const isSurfaceFile = (name: string) =>
    (name.endsWith(".ts") || name.endsWith(".tsx")) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts")
    && !name.includes(".test-fixture.");
  for (const surface of register.surfaces) {
    for (const entry of surface.paths) {
      const absolute = path.join(repositoryRoot, entry);
      if (!fs.existsSync(absolute)) {
        failures.push(`${SURFACES}: ${surface.type} path ${entry} does not exist`);
        continue;
      }
      const found: string[] = [];
      const visit = (target: string) => {
        const stat = fs.statSync(target);
        if (stat.isDirectory()) {
          for (const name of fs.readdirSync(target).sort()) visit(path.join(target, name));
        } else if (isSurfaceFile(path.basename(target))) {
          found.push(path.relative(repositoryRoot, target).split(path.sep).join("/"));
        }
      };
      visit(absolute);
      if (found.length === 0) failures.push(`${SURFACES}: ${surface.type} path ${entry} holds no source file`);
      for (const file of found) {
        if (claimed.has(file)) {
          failures.push(`${SURFACES}: ${file} is listed under more than one surface`);
          continue;
        }
        claimed.add(file);
        files.push({ type: surface.type, path: file, source: fs.readFileSync(path.join(repositoryRoot, file), "utf8") });
      }
    }
  }
  return files;
}

export function readRepositoryInputs(repositoryRoot: string) {
  const failures: string[] = [];
  const files = listSurfaceFiles(repositoryRoot, failures);
  const claims = JSON.parse(fs.readFileSync(path.join(repositoryRoot, CLAIMS), "utf8")) as Claim[];
  const citations = JSON.parse(fs.readFileSync(path.join(repositoryRoot, CITATIONS), "utf8")) as Citation[];
  const backlog = JSON.parse(fs.readFileSync(path.join(repositoryRoot, BACKLOG), "utf8")) as Backlog;
  return { failures, files, claims, citations, backlog };
}

export function runRepositoryGate(repositoryRoot: string, today = new Date().toISOString().slice(0, 10)) {
  const inputs = readRepositoryInputs(repositoryRoot);
  const result = runCitationSurfaceGate({ ...inputs, openBacklog: OPEN_BACKLOG, today });
  return { ...result, failures: [...inputs.failures, ...result.failures], fileCount: inputs.files.length };
}

/** Rebuild the backlog from the current candidates, keeping every existing verdict. */
export function rebuildBacklog(repositoryRoot: string): Backlog {
  const inputs = readRepositoryInputs(repositoryRoot);
  const { sourced } = registeredSentences(inputs.claims, inputs.citations);
  const previous = new Map<string, BacklogEntry>();
  for (const [type, files] of Object.entries(inputs.backlog.surfaces ?? {})) {
    for (const [file, entries] of Object.entries(files)) {
      for (const entry of entries) previous.set(`${type}\u0000${file}\u0000${entry.sha256}`, entry);
    }
  }
  const surfaces: Backlog["surfaces"] = {};
  for (const candidate of candidates(inputs.files)) {
    if (sourced.has(candidate.sha256)) continue;
    const kept = previous.get(`${candidate.type}\u0000${candidate.path}\u0000${candidate.sha256}`);
    const entry: BacklogEntry = kept ?? { sha256: candidate.sha256, text: candidate.text, verdict: null };
    ((surfaces[candidate.type] ??= {})[candidate.path] ??= []).push(entry);
  }
  return { version: 1, purpose: inputs.backlog.purpose, surfaces };
}

function main() {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  if (process.argv.includes("--write-backlog")) {
    const backlog = rebuildBacklog(repositoryRoot);
    fs.writeFileSync(path.join(repositoryRoot, BACKLOG), `${JSON.stringify(backlog, null, 2)}\n`);
    console.log(`wrote ${BACKLOG}: ${openBacklogCount(backlog)} open sentences`);
    return;
  }
  const result = runRepositoryGate(repositoryRoot);
  if (result.failures.length > 0) {
    console.error(`CITATION SURFACE GATE FAILED (${result.failures.length})`);
    for (const failure of result.failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `citation surface gate passed: ${result.candidates.length} claim-marked sentences across ${result.fileCount} ` +
      `surface files; ${result.sourced} registered with dated citations, ${result.classified} reviewed as product ` +
      `wording, ${result.open} open for human review (pinned)`,
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main();
}
