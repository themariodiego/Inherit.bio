/**
 * Where Inherit does not serve people at all, and where the hosted service
 * has paused new declarations (owner decisions of 26 September 2026,
 * recorded in docs/protocol/decisions.md). These lists sit beside the
 * jurisdiction matrix in `data/jurisdictions.json`, not inside it: the matrix
 * decides restricted capabilities from signed reviews, while these lists
 * decide whether a place is served at all, and they apply to My Genome too.
 *
 * The lists come from the pre-review country research of 26 September 2026.
 * They are the owner's risk decisions, not legal findings, and a signed
 * review can change them.
 */
import { GDPR_LAUNCH, euLaunchOpen, ukLaunchOpen, type GdprLaunchState } from "./gdpr-launch";

/**
 * Countries under a comprehensive United States embargo (31 CFR parts 510,
 * 515 and 560). Nobody may declare them, an account that already declared
 * one keeps only its rights (export, deletion, consent withdrawal and
 * correcting its answer), and connections located there are refused.
 */
export const EMBARGOED_COUNTRY_CODES: readonly string[] = ["CU", "IR", "KP"];

/**
 * Regions under a comprehensive embargo that have no country code of their
 * own, as the hosting provider reports them: the ISO 3166-2 first-level
 * region of the connection's address, without the country prefix. Crimea
 * (UA-43) and Sevastopol (UA-40) fall under Executive Order 13685. The
 * so-called DNR and LNR fall under Executive Order 14065; geolocation cannot
 * separate them from the rest of their oblasts, so all of Donetsk (UA-14) and
 * Luhansk (UA-09) is refused.
 */
export const EMBARGOED_REGIONS: readonly { country: string; region: string }[] = [
  { country: "UA", region: "43" },
  { country: "UA", region: "40" },
  { country: "UA", region: "14" },
  { country: "UA", region: "09" },
];

/**
 * Countries where the live product itself was judged high risk (research tier
 * C): the France group, Switzerland, Portugal, the Norway group, Hungary,
 * Israel, the UAE, China, Mongolia, Argentina, Costa Rica, and the four
 * countries whose data must be stored at home.
 */
const HIGH_RISK_COUNTRY_CODES: readonly string[] = [
  "AE", "AR", "BL", "BV", "CH", "CN", "CR", "FR", "GF", "GP",
  "HU", "IL", "KZ", "MF", "MN", "MQ", "NC", "NO", "PF", "PM",
  "PT", "RE", "RU", "SJ", "TF", "TM", "UZ", "WF", "YT",
];

/**
 * The EU member states, the outermost regions and Åland that carry their own
 * codes, and the rest of the EEA: where the GDPR and the IVDR apply.
 */
export const EU_EEA_COUNTRY_CODES: readonly string[] = [
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI",
  "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT",
  "NL", "PL", "PT", "RO", "SE", "SI", "SK",
  "AX", "GF", "GP", "MF", "MQ", "RE", "YT",
  "IS", "LI", "NO",
];

/**
 * Countries paused for new declarations on the hosted deployment, for a given
 * EU/UK launch state: the high-risk ones, plus the EU/EEA while its launch is
 * closed and the UK while its launch is closed (`gdpr-launch.ts`, the gate
 * `/legal/gdpr` states). An account that already declared one keeps it;
 * nobody may newly declare one, whether signing up or changing their answer.
 * A self-hosted copy decides its own list.
 */
export function pausedCountryCodesFor(state: GdprLaunchState): string[] {
  return [...new Set([
    ...HIGH_RISK_COUNTRY_CODES,
    ...(euLaunchOpen(state) ? [] : EU_EEA_COUNTRY_CODES),
    ...(ukLaunchOpen(state) ? [] : ["GB"]),
  ])].sort();
}

export const PAUSED_COUNTRY_CODES: readonly string[] = pausedCountryCodesFor(GDPR_LAUNCH);

export function isEuEeaCountry(code: string | null | undefined): boolean {
  return typeof code === "string" && EU_EEA_COUNTRY_CODES.includes(code);
}

export function isEmbargoedCountry(code: string | null | undefined): boolean {
  return typeof code === "string" && EMBARGOED_COUNTRY_CODES.includes(code);
}

export function isPausedCountry(code: string | null | undefined): boolean {
  return typeof code === "string" && PAUSED_COUNTRY_CODES.includes(code);
}

/**
 * Whether a connection's reported location is under a comprehensive embargo.
 * Values are compared as the hosting provider sends them, case-insensitively;
 * a missing value never matches, so local runs and tests are unaffected.
 */
export function isEmbargoedLocation(country: string | null, region: string | null): boolean {
  const c = country?.trim().toUpperCase() ?? "";
  if (!c) return false;
  if (EMBARGOED_COUNTRY_CODES.includes(c)) return true;
  const r = region?.trim().toUpperCase() ?? "";
  return r !== "" && EMBARGOED_REGIONS.some((entry) => entry.country === c && entry.region === r);
}

/**
 * Why a declaration may not be recorded, or null when it may. `current` is
 * the account's answer before this one: keeping a paused country is allowed,
 * newly choosing one is not. An embargoed country is never recorded, on any
 * deployment; the paused list applies only when `pausesApply`, which the
 * server decides (`isHostedDeployment`).
 */
export function declarationRestriction(
  code: string,
  current: string | null,
  pausesApply: boolean,
): "embargoed" | "paused" | null {
  if (isEmbargoedCountry(code)) return "embargoed";
  if (pausesApply && isPausedCountry(code) && current !== code) return "paused";
  return null;
}
