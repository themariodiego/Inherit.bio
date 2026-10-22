import assert from "node:assert/strict";
import type { DensityStateCase } from "./density-capture-plan";

export type RemainingDensityRecipe = "overview-jurisdiction" | "copilot-complete" | "copilot-uncovered" | "copilot-jurisdiction";
export const REMAINING_DENSITY_PAIRS = Object.freeze([
  ["app.overview", "jurisdiction-unavailable"],
  ["copilot.scope", "complete"], ["copilot.scope", "not-covered"], ["copilot.scope", "jurisdiction-unavailable"],
] as const);
export function remainingDensityRecipe(row: DensityStateCase): RemainingDensityRecipe | null {
  if (row.route.kind !== "page" || row.route.auth !== "authenticated" || row.route.stateProfile !== "product-result") return null;
  if (row.route.id === "app.overview" && row.route.path === "/overview" && row.route.surface === "hub"
    && row.state === "jurisdiction-unavailable") return "overview-jurisdiction";
  if (row.route.id !== "copilot.scope" || row.route.path !== "/copilot/[scope]" || row.route.surface !== "standard") return null;
  return row.state === "complete" ? "copilot-complete" : row.state === "not-covered" ? "copilot-uncovered"
    : row.state === "jurisdiction-unavailable" ? "copilot-jurisdiction" : null;
}
export type CompleteCopilotFacts = Record<string, Record<string, unknown>[]>;
export const COMPLETE_COPILOT_FACT_KEYS = Object.freeze(["profiles", "subjects", "principals", "files", "settings", "keys",
  "consents", "signatures", "grants", "chats", "tokens", "nonces", "directions", "messages", "user_prs", "user_variants",
  "report_observed_calls", "ancestry_results"]);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v))
  && Object.values(Object.getOwnPropertyDescriptors(v)).every(p => "value" in p));
/** Complete ordinary scoped rows are observed, never populated by this validator.
 * The real native chat history door still rechecks the current full authority and
 * captured source; a row-shaped fixture alone cannot create a provider. */
export function checkedCompleteCopilotFacts(value: unknown, accountId: string, fileId: string, chatId: string): asserts value is CompleteCopilotFacts {
  assert(uuid(accountId) && uuid(fileId) && uuid(chatId), "Actual native actor/source/chat identifiers required");
  assert(record(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...COMPLETE_COPILOT_FACT_KEYS].sort())
    && Object.values(value).every(v => Array.isArray(v) && v.every(record)), "Every complete original scoped row bag required");
  const f=value as CompleteCopilotFacts;
  assert(f.profiles.length===1 && f.profiles[0].id===accountId, "Exact live actor required");
  assert(f.subjects.length===1 && f.subjects[0].owner_account_id===accountId && f.subjects[0].subject_account_id===accountId
    && f.subjects[0].subject_class==="self" && f.subjects[0].lifecycle==="active", "Actual current self subject required");
  const subjectId=f.subjects[0].id;
  assert(uuid(subjectId) && f.principals.some(p=>p.account_id===accountId && p.subject_id===subjectId
    && p.principal_kind==="account_subject" && p.status==="active"), "Exact active native self principal required");
  assert(f.files.length===1 && f.files[0].id===fileId && f.files[0].user_id===accountId && f.files[0].subject_id===subjectId
    && f.files[0].status==="stored" && typeof f.files[0].sha256==="string" && /^[a-f0-9]{64}$/.test(f.files[0].sha256)
    && Number.isSafeInteger(f.files[0].upload_revision) && Number(f.files[0].upload_revision)>0
    && Number.isSafeInteger(f.files[0].normalization_revision) && Number(f.files[0].normalization_revision)>0
    && typeof f.files[0].single_logical_sample_verified_at==="string"
    && Number.isFinite(Date.parse(f.files[0].single_logical_sample_verified_at)), "One genuine prepared current canonical source required");
  assert(f.chats.length===1 && f.chats[0].id===chatId && f.chats[0].user_id===accountId
    && f.chats[0].subject_id===subjectId && f.chats[0].scope_kind==="self" && f.chats[0].legacy_unverified===false
    && record(f.chats[0].canonical_authority), "One actual native canonical self chat required");
  assert(f.messages.length===2 && f.messages.every(m=>m.chat_id===chatId && m.user_id===accountId)
    && f.messages.filter(m=>m.role==="user").length===1 && f.messages.filter(m=>m.role==="assistant").length===1,
    "Exactly the two genuinely committed turns required");
  assert(f.settings.length===1 && f.settings[0].user_id===accountId && f.settings[0].provider==="openai_compatible"
    && f.settings[0].base_url==="https://model.copilot.test:8123/v1" && f.settings[0].model==="mock-model"
    && f.settings[0].key_last4===null && f.keys.length===0, "Original key-free isolated HTTPS TEST provider required");
  assert(f.nonces.every(n=>n.account_id===accountId), "Complete actor operation history required");
}

/** The original readonly ownRunCompletions door binds live purpose, grant
 * revision and source hash/revision before exposing only these three fields. */
export function checkedCopilotOwnCompletions(value: unknown): asserts value is [{
  purpose: "reports.polygenic"; complete: true; completed_at: string;
}] {
  assert(Array.isArray(value) && value.length === 1 && record(value[0])
    && JSON.stringify(Object.keys(value[0]).sort()) === JSON.stringify(["complete", "completed_at", "purpose"])
    && value[0].purpose === "reports.polygenic" && value[0].complete === true
    && typeof value[0].completed_at === "string" && Number.isFinite(Date.parse(value[0].completed_at)),
  "Exact original native live-grant/current-source completion required");
}
