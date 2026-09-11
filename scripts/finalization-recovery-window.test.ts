import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What a person actually gets if their finalization dies, pinned so it cannot
 * drift silently. Three numbers decide it and they live in three places:
 * the upload session's lifetime (SQL), the finalization lease (TypeScript),
 * and which clock the purge sweep reads (SQL, redefined once).
 *
 * The redefinition is the reason this file exists. Migrations are append-only,
 * so `claim_own_upload_purge_v1` and `own_upload_finalization_v1` each appear
 * in two of them, and reading the earlier body gives the wrong answer with no
 * sign that it is wrong - the purge sweep looks like it waits for the two-hour
 * deadline when the installed version starts at authority expiry. Every check
 * below therefore resolves the LAST migration that defines a function, in
 * filename order, which is the order the migration runner applies them.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");

/** The body that actually gets installed: the last definition wins. */
function installedDefinition(signature: string): { file: string; body: string; text: string } {
  const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort();
  let found: { file: string; body: string; text: string } | undefined;
  for (const file of files) {
    const text = readFileSync(path.join(MIGRATIONS, file), "utf8");
    const at = text.indexOf(signature);
    if (at === -1) continue;
    found = { file, body: text.slice(at), text };
  }
  if (!found) throw new Error(`no migration defines ${signature}`);
  return found;
}

const SESSION_LIFETIME_SECONDS = 30 * 60;
const STAGING_MAXIMUM_SECONDS = 2 * 60 * 60;

describe("what a person gets if their finalization dies", () => {
  it("gives them the upload session's own lifetime to retry, and no longer", () => {
    // `own_upload_finalization_v1` refuses an expired session before it reaches
    // the resume branch, so the window to press "Try this upload again" is the
    // session's, measured from ISSUANCE rather than from the interruption.
    const { body } = installedDefinition("function private.own_upload_finalization_v1");
    expect(body).toContain("u.expires_at<=clock_timestamp()");
    const issuer = readFileSync(
      path.join(MIGRATIONS, "20260906123327_subject_upload_finalization.sql"), "utf8");
    expect(issuer).toContain("least(clock_timestamp()+interval '30 minutes',v_not_after)");
  });

  it("starts the purge at that same moment, so recovery and purge do not overlap", () => {
    // Measured 2026-09-11 against the installed function: the live predicate is
    // the session's authority expiry, NOT the phase deadline. The earlier
    // migration's body reads the other way and is superseded.
    const { body, file } = installedDefinition("function public.claim_own_upload_purge_v1");
    expect(body).toContain("s.expires_at<=clock_timestamp()");
    expect(file).toBe("20260908121949_own_upload_retention_before_deadline.sql");
  });

  it("keeps the two-hour staging maximum as a ceiling above that, not as the trigger", () => {
    expect(STAGING_MAXIMUM_SECONDS).toBeGreaterThan(SESSION_LIFETIME_SECONDS);
    const registry = readFileSync(path.join(ROOT, "docs/retention.md"), "utf8");
    expect(registry).toContain("`upload.staging-2h`");
    expect(registry).toContain("normally within 30 minutes");
  });

  it("expires a stalled lease well inside the window, so a retry is not locked out", () => {
    // A crashed holder's lease must lapse with time to spare, or the person
    // would be refused for the whole window they are told to retry in.
    const source = readFileSync(path.join(ROOT, "src/lib/uploads/subject-finalization.ts"), "utf8");
    const lease = Number(/FINALIZATION_LEASE_SECONDS = (\d+)/.exec(source)?.[1]);
    expect(lease).toBeGreaterThan(0);
    expect(lease).toBeLessThan(SESSION_LIFETIME_SECONDS / 10);
  });

  it("offers the retry to a person who is present, and nothing to one who is not", () => {
    // Recorded rather than asserted as sufficient: recovery is a button. No job
    // route resumes a finalization, and the resume migration says why - it
    // creates "no session-independent finalization", so a background worker has
    // no authority to finish one. A closed tab therefore ends the upload.
    const recovery = readFileSync(
      path.join(ROOT, "src/components/uploads/staged-upload-recovery.tsx"), "utf8");
    expect(recovery).toContain("Try this upload again");
    // The rationale is in the migration's header, above the definition.
    const { text } = installedDefinition("function private.own_upload_finalization_v1");
    expect(text).toContain("no session-independent finalization");
    const jobs = readdirSync(path.join(ROOT, "src/app/api/jobs"));
    expect(jobs).not.toContain("finalization");
  });
});
