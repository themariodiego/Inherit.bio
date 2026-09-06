import type { ClaimOccurrence, ClaimRegistry } from "./registry";

export const CORPUS_CHANNELS = ["static-build", "seeded-authenticated", "email", "export"] as const;
export type CorpusChannel = (typeof CORPUS_CHANNELS)[number];
export const CHROME_KINDS = ["item-count", "step", "pagination", "date", "file-size", "version"] as const;
export interface RequiredSurface { surface: string; channel: CorpusChannel; requiresClaimWrapping: boolean }
export interface ObservedClaim { nodeId: string; claimId: string; text: string; citationIds: string[]; provenance: string }
export interface ObservedFigure { nodeId: string; provenance: string }
export interface ObservedText {
  nodeId: string;
  text: string;
  kind: "content" | "ui-chrome" | "user-value";
  chromeKind: (typeof CHROME_KINDS)[number] | null;
  claimId: string | null;
  provenance: string | null;
}
export interface ObservedSurface {
  surface: string;
  channel: CorpusChannel;
  contentCommitSha: string;
  /** Digest of the actual renderer payload; the adapter binds it to bytes. */
  payloadSha256: string;
  claims: ObservedClaim[];
  figures: ObservedFigure[];
  texts: ObservedText[];
}
export interface CorpusInput {
  contentCommitSha: string;
  /** Independent route/state/template inventory, never derived from successful observations. */
  requiredSurfaces: readonly RequiredSurface[];
  observations: readonly ObservedSurface[];
  registry: ClaimRegistry;
  /** Resolve actual seeded rows and registered computation modules, not syntax alone. */
  resolveSeed(table: string, id: string): boolean;
  resolveComputed(module: string): boolean;
}
export type CorpusIssueCode = "invalid-shape" | "invalid-field" | "invalid-commit" | "stale-commit" |
  "empty-corpus" | "missing-channel" | "unknown-channel" | "duplicate-surface" | "missing-surface" |
  "unknown-surface" | "duplicate-node" | "missing-provenance" | "invalid-provenance" |
  "unknown-citation" | "unknown-seed" | "unknown-module" | "resolver-failed" | "unknown-claim" |
  "wrong-claim-text" | "wrong-claim-surface" | "zero-support" | "wrong-citation" |
  "missing-claim-text" | "unwrapped-text" | "unwrapped-number" | "chrome-claim" | "wrong-text-binding";
export interface CorpusIssue { code: CorpusIssueCode; path: string }
export interface CorpusAudit { ok: boolean; issues: CorpusIssue[]; claimOccurrences: ClaimOccurrence[] }

type Row = Record<string, unknown>;
const object = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const id = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9._:-]{0,127}$/.test(value);
const sha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
// The brief's numeric expression, with a usable end boundary after symbols too.
const numericClaim = /\b\d+(?:\.\d+)?\s*(?:%|percent\b|x\b|×|-fold\b|in \d+\b)/u;

/**
 * Audit complete renderer-supplied observations, not HTML or source files.
 * Adapters must enumerate every node/text (including unwrapped text), identify
 * UI chrome by component contract, and derive the required inventory and commit
 * independently. This function cannot prove those collectors are complete or
 * truthful, verify source support, or replace canonical registry validation.
 * A positive result certifies only this supplied corpus against those inputs.
 */
export function auditClaimCorpus(input: CorpusInput): CorpusAudit {
  const issues: CorpusIssue[] = [];
  const claimOccurrences: ClaimOccurrence[] = [];
  const add = (code: CorpusIssueCode, path: string) => { issues.push({ code, path }); };
  const finish = (): CorpusAudit => ({ ok: issues.length === 0, issues, claimOccurrences });
  const shape = (value: unknown, keys: string[], path: string): value is Row => {
    if (!object(value)) { add("invalid-shape", path); return false; }
    for (const key of keys) if (!Object.hasOwn(value, key)) add("invalid-field", `${path}.${key}`);
    for (const key of Object.keys(value)) if (!keys.includes(key)) add("invalid-field", `${path}.${key}`);
    return true;
  };
  const array = (value: unknown, path: string): unknown[] => {
    if (!Array.isArray(value)) { add("invalid-shape", path); return []; }
    return value;
  };
  if (!object(input)) { add("invalid-shape", "input"); return finish(); }
  if (!sha(input.contentCommitSha)) add("invalid-commit", "contentCommitSha");
  if (!object(input.registry) || typeof input.registry.resolveCitation !== "function" || typeof input.registry.resolveClaim !== "function" ||
      typeof input.resolveSeed !== "function" || typeof input.resolveComputed !== "function") {
    add("invalid-field", "resolvers"); return finish();
  }
  const resolve = <T>(fn: () => T, path: string): T | undefined => {
    try { return fn(); } catch { add("resolver-failed", path); return undefined; }
  };
  const channel = (value: unknown, path: string) => {
    if (typeof value !== "string" || !CORPUS_CHANNELS.includes(value as CorpusChannel)) { add("unknown-channel", path); return false; }
    return true;
  };
  const surfaceKey = (row: Row) => JSON.stringify([row.channel, row.surface]);
  const required = new Map<string, Row>();
  const requiredPaths = new Map<string, string>();
  const requiredChannels = new Set<string>();
  for (const [i, row] of array(input.requiredSurfaces, "requiredSurfaces").entries()) {
    const path = `requiredSurfaces[${i}]`;
    if (!shape(row, ["surface", "channel", "requiresClaimWrapping"], path)) continue;
    if (!text(row.surface)) add("invalid-field", `${path}.surface`);
    if (typeof row.requiresClaimWrapping !== "boolean") add("invalid-field", `${path}.requiresClaimWrapping`);
    if (!channel(row.channel, `${path}.channel`) || !text(row.surface)) continue;
    requiredChannels.add(row.channel as string);
    const key = surfaceKey(row);
    if (required.has(key)) add("duplicate-surface", path);
    required.set(key, row);
    requiredPaths.set(key, path);
  }
  for (const name of CORPUS_CHANNELS) if (!requiredChannels.has(name)) add("missing-channel", `requiredSurfaces.${name}`);
  if (!required.size) add("empty-corpus", "requiredSurfaces");
  const provenance = (value: unknown, path: string): { type: string; target: string } | undefined => {
    if (value === null || value === undefined || value === "") { add("missing-provenance", path); return; }
    if (typeof value !== "string") { add("invalid-provenance", path); return; }
    const citation = /^citation:([a-z0-9][a-z0-9._:-]{0,127})$/.exec(value);
    if (citation) {
      if (!resolve(() => input.registry.resolveCitation(citation[1]), path)) add("unknown-citation", path);
      return { type: "citation", target: citation[1] };
    }
    const seed = /^seed:([a-z][a-z0-9_]*)\/([A-Za-z0-9][A-Za-z0-9._:-]{0,255})$/.exec(value);
    if (seed) {
      if (resolve(() => input.resolveSeed(seed[1], seed[2]), path) !== true) add("unknown-seed", path);
      return { type: "seed", target: `${seed[1]}/${seed[2]}` };
    }
    const computed = /^computed:([a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*)$/.exec(value);
    if (computed) {
      if (resolve(() => input.resolveComputed(computed[1]), path) !== true) add("unknown-module", path);
      return { type: "computed", target: computed[1] };
    }
    add("invalid-provenance", path);
  };
  const seen = new Set<string>();
  const observedChannels = new Set<string>();
  let observedNodes = 0;
  for (const [i, row] of array(input.observations, "observations").entries()) {
    const path = `observations[${i}]`;
    if (!shape(row, ["surface", "channel", "contentCommitSha", "payloadSha256", "claims", "figures", "texts"], path)) continue;
    if (!text(row.surface)) add("invalid-field", `${path}.surface`);
    if (channel(row.channel, `${path}.channel`)) observedChannels.add(row.channel as string);
    if (!sha(row.contentCommitSha)) add("invalid-commit", `${path}.contentCommitSha`);
    else if (row.contentCommitSha !== input.contentCommitSha) add("stale-commit", `${path}.contentCommitSha`);
    if (typeof row.payloadSha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.payloadSha256)) add("invalid-field", `${path}.payloadSha256`);
    const key = surfaceKey(row), expected = required.get(key);
    if (!expected) add("unknown-surface", path);
    if (seen.has(key)) add("duplicate-surface", path);
    seen.add(key);
    const claims = new Map<string, Row>();
    const claimPaths = new Map<string, string>();
    for (const [ci, claim] of array(row.claims, `${path}.claims`).entries()) {
      const cp = `${path}.claims[${ci}]`;
      if (!shape(claim, ["nodeId", "claimId", "text", "citationIds", "provenance"], cp)) continue;
      if (!text(claim.nodeId)) add("invalid-field", `${cp}.nodeId`);
      else { if (claims.has(claim.nodeId)) add("duplicate-node", `${cp}.nodeId`); claims.set(claim.nodeId, claim); claimPaths.set(claim.nodeId, cp); }
      if (!id(claim.claimId)) add("invalid-field", `${cp}.claimId`);
      const resolved = id(claim.claimId) ? resolve(() => input.registry.resolveClaim(claim.claimId as string), cp) : undefined;
      if (!resolved) add("unknown-claim", `${cp}.claimId`);
      else {
        if (claim.text !== resolved.claim.text_verbatim) add("wrong-claim-text", `${cp}.text`);
        if (!resolved.claim.surfaces.includes(row.surface as string)) add("wrong-claim-surface", cp);
        claimOccurrences.push({ claimId: claim.claimId as string, text: claim.text as string, surface: row.surface as string });
      }
      const citations = array(claim.citationIds, `${cp}.citationIds`);
      if (!citations.length) add("zero-support", `${cp}.citationIds`);
      const ids = new Set<string>();
      for (const [si, source] of citations.entries()) {
        const sp = `${cp}.citationIds[${si}]`;
        if (!id(source) || !resolve(() => input.registry.resolveCitation(source as string), sp)) add("unknown-citation", sp);
        if (typeof source === "string") { if (ids.has(source)) add("wrong-citation", sp); ids.add(source); }
        if (resolved && !resolved.claim.evidence.some((e) => e.citation === source)) add("wrong-citation", sp);
      }
      const origin = provenance(claim.provenance, `${cp}.provenance`);
      if (origin?.type === "citation" && !ids.has(origin.target)) add("wrong-citation", `${cp}.provenance`);
      if (resolved && resolved.claim.evidence.some((e) => !ids.has(e.citation))) add("wrong-citation", `${cp}.citationIds`);
    }
    const figures = new Set<string>();
    for (const [fi, figure] of array(row.figures, `${path}.figures`).entries()) {
      const fp = `${path}.figures[${fi}]`;
      if (!shape(figure, ["nodeId", "provenance"], fp)) continue;
      if (!text(figure.nodeId)) add("invalid-field", `${fp}.nodeId`);
      else { if (figures.has(figure.nodeId)) add("duplicate-node", `${fp}.nodeId`); figures.add(figure.nodeId); }
      provenance(figure.provenance, `${fp}.provenance`);
      const claim = claims.get(figure.nodeId as string);
      if (claim && claim.provenance !== figure.provenance) add("wrong-text-binding", `${fp}.provenance`);
    }
    const texts = new Set<string>();
    for (const [ti, block] of array(row.texts, `${path}.texts`).entries()) {
      const tp = `${path}.texts[${ti}]`;
      if (!shape(block, ["nodeId", "text", "kind", "chromeKind", "claimId", "provenance"], tp)) continue;
      if (!text(block.nodeId) || !text(block.text)) add("invalid-field", tp);
      if (typeof block.nodeId === "string") { if (texts.has(block.nodeId)) add("duplicate-node", `${tp}.nodeId`); texts.add(block.nodeId); }
      if (!["content", "ui-chrome", "user-value"].includes(block.kind as string)) add("invalid-field", `${tp}.kind`);
      if (block.kind === "ui-chrome" ? !CHROME_KINDS.includes(block.chromeKind as (typeof CHROME_KINDS)[number]) : block.chromeKind !== null) add("invalid-field", `${tp}.chromeKind`);
      const claim = claims.get(block.nodeId as string);
      if (block.kind === "ui-chrome" && (block.claimId !== null || claim)) add("chrome-claim", tp);
      if (block.claimId !== null || claim) {
        if (!claim || block.claimId !== claim.claimId || block.text !== claim.text || block.provenance !== claim.provenance) add("wrong-text-binding", tp);
      } else if (block.kind === "user-value") {
        const origin = provenance(block.provenance, `${tp}.provenance`);
        if (origin?.type === "citation") add("invalid-provenance", `${tp}.provenance`);
      } else {
        if (block.provenance !== null) provenance(block.provenance, `${tp}.provenance`);
        if (block.kind === "content" && expected?.requiresClaimWrapping) add("unwrapped-text", tp);
        if (block.kind === "content" && typeof block.text === "string" && numericClaim.test(block.text)) add("unwrapped-number", tp);
      }
    }
    for (const node of claims.keys()) if (!texts.has(node)) add("missing-claim-text", `${claimPaths.get(node)}.nodeId`);
    observedNodes += texts.size + figures.size;
  }
  for (const name of CORPUS_CHANNELS) if (!observedChannels.has(name)) add("missing-channel", `observations.${name}`);
  for (const key of required.keys()) if (!seen.has(key)) add("missing-surface", requiredPaths.get(key)!);
  if (!seen.size) add("empty-corpus", "observations");
  else if (!observedNodes) add("empty-corpus", "observations.nodes");
  if (!claimOccurrences.length) add("empty-corpus", "observations.claims");
  return finish();
}
