import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SESSION_CSRF_ROUTES, SESSION_CSRF_STREAM_ROUTES } from "../src/lib/security/session-csrf-core";

/**
 * G8.5, the migration stage (20261119120000_session_csrf_purpose_kinds.sql).
 * The migration adds public.consume_session_csrf_v2 and pins, by md5 and
 * ACL, 20261024220000's v1, which it leaves unchanged, and the one liveness
 * rule it calls (private.claim_intake_live_v1). pg_get_functiondef keeps a
 * plpgsql or sql body verbatim, so each pinned definition is rebuilt here
 * from the migration that last defined it and every md5 is recomputed from
 * source; the successor's md5 is recomputed from this migration's own body.
 * The pgTAP suite (supabase/tests/session_csrf_purpose_kinds.sql) drives the
 * function through every kind's live and closed states and holds the
 * catalog to the same md5s.
 */

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");

const NAME = "20261119120000_session_csrf_purpose_kinds.sql";
const migration = read(`supabase/migrations/${NAME}`);
const pgtap = read("supabase/tests/session_csrf_purpose_kinds.sql");
const files = readdirSync(path.join(root, "supabase/migrations")).filter(file => file.endsWith(".sql")).sort();
const SERVICE = "{postgres=X/postgres,service_role=X/postgres}";
const V2 = "public.consume_session_csrf_v2(text,text,text,timestamptz,uuid,uuid,text,uuid)";

/** A function as pg_get_functiondef prints it: the header Postgres normalizes, around the verbatim body. */
function definition(source: string, marker: string, header: string, open: string, close: string): string {
  const start = source.lastIndexOf(marker);
  expect(start, marker).toBeGreaterThanOrEqual(0);
  const from = source.indexOf(open, start) + open.length;
  const to = source.indexOf(close, from);
  return `${header}AS $function$${source.slice(from, to)}$function$\n`;
}

const V1_DEFINITION = definition(read("supabase/migrations/20261024220000_session_csrf_tokens.sql"),
  "create function public.consume_session_csrf_v1(",
  "CREATE OR REPLACE FUNCTION public.consume_session_csrf_v1(p_route_id text, p_session_kind text, p_token_hash text, "
    + "p_expires_at timestamp with time zone, p_account_id uuid DEFAULT NULL::uuid, p_session_id uuid DEFAULT NULL::uuid)\n"
    + " RETURNS boolean\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\n", "as $$", "$$;");
const V2_DEFINITION = definition(migration, "create or replace function public.consume_session_csrf_v2(",
  "CREATE OR REPLACE FUNCTION public.consume_session_csrf_v2(p_route_id text, p_session_kind text, p_token_hash text, "
    + "p_expires_at timestamp with time zone, p_account_id uuid DEFAULT NULL::uuid, p_session_id uuid DEFAULT NULL::uuid, "
    + "p_cookie_hash text DEFAULT NULL::text, p_purpose_session_id uuid DEFAULT NULL::uuid)\n"
    + " RETURNS boolean\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\n", "as $$", "$$;");

/** Where private.claim_intake_live_v1 was last defined, and as pg_get_functiondef prints it. */
function liveDefinition(): { file: string; text: string } {
  const marker = "create or replace function private.claim_intake_live_v1(";
  const file = files.filter(name => read(`supabase/migrations/${name}`).includes(marker)).at(-1)!;
  return { file, text: definition(read(`supabase/migrations/${file}`), marker,
    "CREATE OR REPLACE FUNCTION private.claim_intake_live_v1(i private.future_person_claim_intakes)\n"
      + " RETURNS boolean\n LANGUAGE sql\n STABLE\n SET search_path TO ''\n", "as $$", "$$;") };
}

/** The `'<md5> <acl>'` literals the migration's guards compare a signature to. */
const pinnedLiterals = (text: string) => [...text.matchAll(/'([0-9a-f]{32}) (\{[^}]+\})'/g)].map(match => `${match[1]} ${match[2]}`);

describe("the release it belongs to", () => {
  it("is a guarded production release, the newest migration, after the two whose objects it pins", () => {
    expect(migration.startsWith("-- =====================================================================\n"
      + "-- PRODUCTION RELEASE: GUARDED.")).toBe(true);
    expect(files.at(-1)).toBe(NAME);
    expect(NAME > "20261119110000_dropped_bucket_literals_and_guard.sql").toBe(true);
    expect(NAME > "20261024220000_session_csrf_tokens.sql").toBe(true);
    expect(NAME > liveDefinition().file).toBe(true);
  });

  it("adds one function and alters nothing: no table, column, policy, other function or grant", () => {
    const statements = migration.replace(/^--.*$/gmu, "");
    expect([...statements.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(/giu)].map(match => match[1]))
      .toEqual(["public.consume_session_csrf_v2"]);
    expect(statements).not.toMatch(/\b(?:alter|drop|create)\s+(?:table|policy|index|view|type|trigger)\b/iu);
    expect(statements).not.toMatch(/\b(?:insert|update|delete)\b(?![^$]*\$\$)/iu);
    expect([...statements.matchAll(/\b(grant|revoke)\b[^;]*;/giu)].map(match => match[0].replace(/\s+/gu, " ")))
      .toEqual([`revoke all on function ${V2} from public, anon, authenticated, inherit_upload_only;`,
        `grant execute on function ${V2} to service_role;`]);
  });
});

describe("the md5s it pins, recomputed from source", () => {
  it("pins v1 exactly as 20261024220000 defined it, and no later migration restates it", () => {
    expect(md5(V1_DEFINITION)).toBe("ae9a75327090d06a46456efce17625a3");
    expect(files.filter(file => file > "20261024220000_session_csrf_tokens.sql" && file !== NAME)
      .filter(file => /function\s+public\.consume_session_csrf_v1\s*\(/iu.test(read(`supabase/migrations/${file}`)))).toEqual([]);
  });

  it("pins the claim liveness rule where it was last defined", () => {
    expect(md5(liveDefinition().text)).toBe("f76e353669c3f7ff70c66e78e34317a1");
  });

  it("pins its own successor by the md5 of the body it creates", () => {
    expect(md5(V2_DEFINITION)).toBe("13570c4a4b77de1fbc6e3fcfe2d40636");
  });

  it("compares each signature, in the predecessor, the postflight and the pgTAP suite, to those md5s and ACLs only", () => {
    const expected = new Set([`ae9a75327090d06a46456efce17625a3 ${SERVICE}`, "f76e353669c3f7ff70c66e78e34317a1 {postgres=X/postgres}",
      `13570c4a4b77de1fbc6e3fcfe2d40636 ${SERVICE}`]);
    expect(new Set(pinnedLiterals(migration))).toEqual(expected);
    expect(pinnedLiterals(pgtap).every(literal => expected.has(literal))).toBe(true);
    expect(pgtap).toContain(`'13570c4a4b77de1fbc6e3fcfe2d40636 ${SERVICE}'`);
    expect(pgtap).toContain(`'ae9a75327090d06a46456efce17625a3 ${SERVICE}'`);
  });
});

describe("the door it adds", () => {
  const body = V2_DEFINITION;

  it("accepts exactly the eight session kinds the app binds, and v1 keeps the three earlier ones", () => {
    const kinds = /p_session_kind not in \(([^)]+)\)/u.exec(body)![1]!.split(",").map(kind => kind.trim().replace(/^'|'$/gu, "")).sort();
    expect(kinds).toEqual([...new Set(Object.values(SESSION_CSRF_ROUTES))].sort());
    expect(V1_DEFINITION).toContain("p_session_kind not in ('authenticated','token','token-candidate')");
  });

  it("holds each later kind to its live row, and the reviewer to v1's live auth session", () => {
    for (const fragment of [
      "v_account boolean:=p_session_kind in ('authenticated','reviewer')",
      "where s.id=p_session_id and s.user_id=p_account_id and u.deleted_at is null\n   and (s.not_after is null or s.not_after>v_now)",
      "s.status in ('open','mapping_required','failure_pending')",
      "from private.claim_document_sessions s where s.id=p_purpose_session_id and s.cookie_hash=p_cookie_hash",
      "from private.appeal_document_sessions s where s.id=p_purpose_session_id and s.cookie_hash=p_cookie_hash",
      "from private.permission_document_sessions s where s.id=p_purpose_session_id and s.cookie_hash=p_cookie_hash",
      "where i.session_hash=p_cookie_hash and private.claim_intake_live_v1(i)",
      "where r.session_hash=p_cookie_hash and r.expires_at>v_now and u.deleted_at is null",
    ]) expect(body, fragment).toContain(fragment);
  });

  it("spends into v1's table with v1's statements, so one hash is spent once across both doors", () => {
    const spend = (text: string) => text.slice(text.indexOf(" delete from private.session_csrf_token_uses"), text.indexOf("end $function$"));
    expect(spend(body)).toBe(spend(V1_DEFINITION));
    expect(spend(body)).toContain("on conflict(token_hash) do nothing");
  });

  it("is not reached by the chunk stream, which the route verifies and never spends", () => {
    expect([...SESSION_CSRF_STREAM_ROUTES]).toEqual(["api.evidence-chunk"]);
    expect(read("src/lib/security/session-csrf.ts")).toContain("if (SESSION_CSRF_STREAM_ROUTES.has(route)) return true;");
  });

  it("is re-runnable: the predecessor admits only no successor or the reviewed one, and refuses any other overload", () => {
    const predecessor = migration.slice(migration.indexOf("do $predecessor$"), migration.indexOf("$predecessor$;"));
    expect(predecessor).toContain("p.oid is distinct from to_regprocedure('public.consume_session_csrf_v2(text,text,text,timestamptz,uuid,uuid,text,uuid)')");
    expect(migration).toContain("create or replace function public.consume_session_csrf_v2(");
    const postflight = migration.slice(migration.indexOf("do $postflight$"), migration.indexOf("$postflight$;"));
    expect(postflight).toContain("p.proname in ('consume_session_csrf_v1','consume_session_csrf_v2'))<>2");
  });
});
