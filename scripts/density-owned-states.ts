import type { DensityStateCase } from "./density-capture-plan";

export type OwnedDensityRecipe = "empty" | "upload-consent" | "upload-ready"
  | "preparing" | "awaiting-choice" | "account" | "digest-pending"
  | "data" | "delete-pending" | "model-ready" | "model-pending"
  | "consents-empty" | "consents-ready" | "consents-pending"
  | "family-empty" | "invite" | "invite-pending" | "people-not-built";

/** Each entry has an actual setup and assertion in the browser provider.
 * A similarly named state on another route never inherits this recipe. */
export const OWNED_DENSITY_STATES: Readonly<Record<string, Readonly<Record<string, OwnedDensityRecipe>>>> = {
  "app.overview": { empty: "empty", processing: "preparing", "awaiting-choice": "awaiting-choice" },
  "genome.subject": { processing: "preparing" },
  "genome.reports": { empty: "empty", processing: "preparing" },
  "genome.report": { empty: "empty", processing: "preparing" },
  "genome.ancestry": { empty: "empty", processing: "preparing" },
  "genome.data": { empty: "empty", processing: "preparing" },
  "genome.browser": { empty: "empty", processing: "preparing" },
  "files.index": { empty: "empty", "consent-required": "upload-consent" },
  "files.upload": { "consent-required": "upload-consent", complete: "upload-ready" },
  "settings.index": { complete: "account", processing: "digest-pending" },
  "settings.data": { complete: "data", processing: "delete-pending" },
  "settings.people": { "not-built": "people-not-built" },
  "settings.copilot": { complete: "model-ready", processing: "model-pending" },
  "settings.consents": { empty: "consents-empty", complete: "consents-ready", processing: "consents-pending" },
  "family.index": { empty: "family-empty" },
  "family.invite": { complete: "invite", processing: "invite-pending" },
};

export function ownedDensityRecipe(row: DensityStateCase): OwnedDensityRecipe | null {
  if (row.route.id === "settings.people" && (row.route.path !== "/settings/people"
    || row.route.auth !== "authenticated" || row.route.stateProfile !== "settings-unbuilt-render")) return null;
  return Object.hasOwn(OWNED_DENSITY_STATES, row.route.id)
    && Object.hasOwn(OWNED_DENSITY_STATES[row.route.id], row.state)
    ? OWNED_DENSITY_STATES[row.route.id][row.state] : null;
}
