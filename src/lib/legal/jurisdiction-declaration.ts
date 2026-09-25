import "server-only";

import { z } from "zod";
import jurisdictionsJson from "../../../data/jurisdictions.json";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  TEST_DENY_STORED_CODE,
  isTestJurisdictionEnabled,
  normaliseJurisdictionCode,
  type JurisdictionsFile,
} from "./jurisdictions";

/**
 * The declaration half of G5.1a (ADR 0032): what a person may choose, the
 * attestation they affirm, and the closed request the register's
 * `api.jurisdiction` accepts. `public.declare_jurisdiction_v1` is the only
 * writer; this module never writes a profile itself.
 *
 * Nothing here reads a request header, an address, a locale or a time zone.
 * Country names are rendered in one fixed display language, so the list a
 * person sees is not itself a signal of anything about them.
 */

const FILE = jurisdictionsJson as unknown as JurisdictionsFile;

export const JURISDICTION_ATTESTATION_KEY = "attestation.jurisdiction";

export interface JurisdictionChoice {
  code: string;
  name: string;
}

/**
 * Every selectable country, named and sorted for reading. No test value is
 * ever offered (productionPolicy.hideTestJurisdictions): the block-only
 * TEST-DENY row is declared through the writer by the acceptance suite, never
 * picked from a list.
 */
export function jurisdictionChoices(): JurisdictionChoice[] {
  const names = new Intl.DisplayNames(["en"], { type: "region", fallback: "code" });
  return FILE.realJurisdictionCatalog.codes
    .map((code) => ({ code, name: names.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
}

/** The name a declared code is shown with; the block-only row's stored code names itself. */
export function jurisdictionName(code: string): string {
  return jurisdictionChoices().find((choice) => choice.code === code)?.name ?? code;
}

/**
 * The code a declaration may store, or null. A catalogue alpha-2 country is
 * declarable; a subdivision is not while none is committed, and the column
 * holds two letters. The block-only row's stored code is declarable only
 * while the isolated acceptance flag is on, which production refuses to start
 * with; the database refuses it without the flag as well.
 */
export function declarableCode(
  raw: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const code = normaliseJurisdictionCode(raw);
  if (code === null) return null;
  if (FILE.realJurisdictionCatalog.codes.includes(code)) return code;
  if (code === TEST_DENY_STORED_CODE && isTestJurisdictionEnabled(env)) return code;
  return null;
}

/** The register's closed body for `PUT /api/settings/jurisdiction`. */
export const jurisdictionWriteBody = z
  .object({
    code: z.string().max(16),
    attestationVersion: z.number().int().positive(),
    attestationHash: z.string().regex(/^[0-9a-f]{64}$/),
    affirmed: z.literal(true),
  })
  .strict();

/** What the writer returns; anything else is refused rather than forwarded. */
export const declarationResult = z
  .object({
    jurisdiction: z.string().regex(/^[A-Z]{2}$/),
    changed: z.boolean(),
    revokedGrants: z.number().int().nonnegative(),
  })
  .strict();

export interface JurisdictionAttestation {
  version: number;
  sha256: string;
  summary: string;
  body: string;
}

/** The one current published attestation, or null when none is readable. */
export async function currentJurisdictionAttestation(): Promise<JurisdictionAttestation | null> {
  const { data, error } = await createAdminClient()
    .from("consent_artifacts")
    .select("version, body_sha256, summary_markdown, body_markdown")
    .eq("artifact_key", JURISDICTION_ATTESTATION_KEY)
    .is("superseded_at", null)
    .maybeSingle();
  if (error || !data) return null;
  return {
    version: data.version,
    sha256: data.body_sha256,
    summary: data.summary_markdown,
    body: data.body_markdown,
  };
}

/** The account's declared code, or null while nothing is declared. */
export async function readDeclaredJurisdiction(accountId: string): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from("profiles")
    .select("jurisdiction_code")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error(`profiles.jurisdiction_code read failed: ${error.message}`);
  return data?.jurisdiction_code ?? null;
}
