import assert from "node:assert/strict";
import type { DensityStateCase } from "./density-capture-plan";

export type CopilotDensityRecipe = "empty" | "pending" | "permission";
export const COPILOT_DENSITY_STATES: Readonly<Record<string, Readonly<Record<string, CopilotDensityRecipe>>>> = {
  "copilot.scope": { empty: "empty", processing: "pending", "consent-required": "permission" },
};
export const DENSITY_COPILOT_ENDPOINT = "https://203.0.114.10:8123/v1";
export const DENSITY_COPILOT_PROVIDER = "203.0.114.10:8123";
export function copilotDensityRecipe(row: DensityStateCase): CopilotDensityRecipe | null {
  return Object.hasOwn(COPILOT_DENSITY_STATES, row.route.id)
    && Object.hasOwn(COPILOT_DENSITY_STATES[row.route.id], row.state)
    ? COPILOT_DENSITY_STATES[row.route.id][row.state] : null;
}

export const COPILOT_DENSITY_TABLES = ["profiles", "subjects", "subject_principals", "llm_settings", "llm_keys",
  "subject_consents", "consent_signatures", "consent_grants", "genome_files", "chats", "copilot_context_tokens",
  "purpose_grants", "account_operation_nonces"] as const;
export type UnansweredCopilotRows = Record<typeof COPILOT_DENSITY_TABLES[number], Record<string, unknown>[]>;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object"
  && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Object.values(Object.getOwnPropertyDescriptors(value)).every(property => "value" in property));

/** These are complete reads of a fresh actor before the consent gate.
 * Validation never creates a model answer, grant or native evidence. */
export function assertUnansweredCopilotRows(value: unknown, accountId: string): asserts value is UnansweredCopilotRows {
  assert(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(accountId), "Actual account UUID required");
  assert(record(value) && Object.keys(value).length === COPILOT_DENSITY_TABLES.length
    && COPILOT_DENSITY_TABLES.every(name => Object.hasOwn(value, name) && Array.isArray(value[name])
      && (value[name] as unknown[]).every(record)), "Complete native Copilot rows required");
  const rows = value as UnansweredCopilotRows;
  assert(rows.profiles.length === 1 && rows.profiles[0].id === accountId, "Exact native actor profile required");
  assert(rows.subjects.length === 1 && rows.subjects[0].subject_account_id === accountId
    && rows.subjects[0].owner_account_id === accountId && rows.subjects[0].subject_class === "self"
    && rows.subjects[0].lifecycle === "active", "Exact native self subject required");
  assert(rows.subject_principals.length === 1 && rows.subject_principals[0].account_id === accountId
    && rows.subject_principals[0].subject_id === rows.subjects[0].id
    && rows.subject_principals[0].principal_kind === "account_subject" && rows.subject_principals[0].status === "active",
    "Exact native actor principal required");
  assert(rows.llm_settings.length === 1, "One actual saved provider required");
  const settings = rows.llm_settings[0], recipient = settings.copilot_recipient;
  assert(settings.user_id === accountId && settings.provider === "openai_compatible"
    && settings.base_url === DENSITY_COPILOT_ENDPOINT && settings.model === "synthetic-model" && settings.key_last4 === null,
    "The unchanged key-free synthetic provider is required");
  assert(record(recipient) && recipient.provider === "openai_compatible" && recipient.model === "synthetic-model"
    && recipient.providerClass === "cloud" && recipient.origin === `https://${DENSITY_COPILOT_PROVIDER}`
    && recipient.baseUrl === DENSITY_COPILOT_ENDPOINT && typeof recipient.revision === "number"
    && Number.isSafeInteger(recipient.revision) && recipient.revision > 0
    && recipient.revision === rows.profiles[0].copilot_settings_revision, "Actual current native provider revision required");
  for (const name of ["llm_keys", "subject_consents", "consent_signatures", "consent_grants", "genome_files",
    "chats", "copilot_context_tokens", "purpose_grants"] as const)
    assert(rows[name].length === 0, "No key, consent, canonical source, stored chat or model result is permitted");
  assert(rows.account_operation_nonces.every(row => row.account_id === accountId), "Exact actor operation history required");
}
