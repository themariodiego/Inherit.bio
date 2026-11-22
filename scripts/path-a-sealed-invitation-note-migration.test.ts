import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * D-139 (20261119134500_path_a_sealed_invitation_note.sql). Path A's optional
 * note reaches the database only as the envelope the route sealed, in the
 * transaction that creates the invitation, and the table refuses a plain
 * one. The migration pins the three doors it replaces and the core it calls
 * by md5, drops and recreates the doors with one trailing defaulted
 * parameter, and pins their successors. pg_get_functiondef keeps a plpgsql or
 * SQL body verbatim, so every pinned body is rebuilt here from the migration
 * that last defined it and every md5 is recomputed from source. The pgTAP
 * suite (supabase/tests/path_a_sealed_invitation_note.sql) drives the
 * database through every case; its copies of the migration's blocks must be
 * those blocks byte for byte.
 */

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");
const count = (text: string, fragment: string) => text.split(fragment).length - 1;

const NAME = "20261119134500_path_a_sealed_invitation_note.sql";
const migration = read(`supabase/migrations/${NAME}`);
const pgtap = read("supabase/tests/path_a_sealed_invitation_note.sql");
const files = readdirSync(path.join(root, "supabase/migrations")).filter(file => file.endsWith(".sql")).sort();
const OWNER = "{postgres=X/postgres}";
const SERVICE = "{postgres=X/postgres,service_role=X/postgres}";
const TABLE = " RETURNS TABLE(invitation_id uuid, subject_id uuid, expires_at timestamp with time zone)\n";
const DEFINER = " LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\n";
const INVOKER_SQL = " LANGUAGE sql\n SET search_path TO ''\n";

/** The text between two markers, the first occurrence after `after`. */
function between(text: string, start: string, end: string, after = 0): string {
  const from = text.indexOf(start, after);
  expect(from, start).toBeGreaterThanOrEqual(0);
  const to = text.indexOf(end, from + start.length);
  expect(to, end).toBeGreaterThan(from);
  return text.slice(from + start.length, to);
}

/** A function as pg_get_functiondef prints it: the header around the body its `as $$ ... $$;` holds. */
function definition(source: string, marker: string, header: string, last = true): string {
  const start = last ? source.lastIndexOf(marker) : source.indexOf(marker);
  expect(start, marker).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("as $$", start) + "as $$".length;
  const close = source.indexOf("$$;", open);
  return `${header}AS $function$${source.slice(open, close)}$function$\n`;
}

const KEYED_ARGS = "p_account_id uuid, p_contact_ciphertext bytea, p_contact_hmac text, p_idempotency_key text, "
  + "p_test_jurisdiction boolean, p_contact_hmac_set jsonb, p_quota_keys jsonb";
const PUBLIC_ARGS = "p_account_id uuid, p_contact_ciphertext bytea, p_contact_hmac text, p_idempotency_key text, "
  + "p_test_jurisdiction boolean, p_contact_hmac_set jsonb DEFAULT NULL::jsonb, p_quota_keys jsonb DEFAULT NULL::jsonb";
const NONCE_ARGS = "p_account_id uuid, p_session_id uuid, p_contact_ciphertext bytea, p_contact_hmac text, "
  + "p_idempotency_key text, p_test_jurisdiction boolean, p_contact_hmac_set jsonb, p_quota_keys jsonb, p_nonce_hash text, "
  + "p_nonce_expires_at timestamp with time zone";
const NOTE_ARG = ", p_note_envelope jsonb DEFAULT NULL::jsonb";

const doors = {
  keyed: { signature: "private.create_adult_subject_invitation_keyed_v1", marker: "create function private.create_adult_subject_invitation_keyed_v1(",
    header: (args: string) => `CREATE OR REPLACE FUNCTION private.create_adult_subject_invitation_keyed_v1(${args})\n${TABLE}${DEFINER}` },
  public: { signature: "public.create_adult_subject_invitation_v1", marker: "create function public.create_adult_subject_invitation_v1(",
    header: (args: string) => `CREATE OR REPLACE FUNCTION public.create_adult_subject_invitation_v1(${args})\n${TABLE}${INVOKER_SQL}` },
  nonce: { signature: "public.create_adult_subject_invitation_with_nonce_v1",
    marker: "create function public.create_adult_subject_invitation_with_nonce_v1(",
    header: (args: string) => `CREATE OR REPLACE FUNCTION public.create_adult_subject_invitation_with_nonce_v1(${args})\n${TABLE}${DEFINER}` },
};

/** The three doors as they stand before this migration, from the migrations that last defined them. */
const predecessors = {
  keyed: definition(read("supabase/migrations/20260928130100_invitation_keyring_quota_doors.sql"), doors.keyed.marker,
    doors.keyed.header(KEYED_ARGS)),
  public: definition(read("supabase/migrations/20260928130100_invitation_keyring_quota_doors.sql"), doors.public.marker,
    doors.public.header(PUBLIC_ARGS)),
  nonce: definition(read("supabase/migrations/20261023120000_legal_audit_attribution_completeness.sql"), doors.nonce.marker,
    doors.nonce.header(NONCE_ARGS)),
};
/** The doors this migration creates. */
const successors = {
  keyed: definition(migration, doors.keyed.marker, doors.keyed.header(KEYED_ARGS + NOTE_ARG)),
  public: definition(migration, doors.public.marker, doors.public.header(PUBLIC_ARGS + NOTE_ARG)),
  nonce: definition(migration, doors.nonce.marker, doors.nonce.header(NONCE_ARGS + NOTE_ARG)),
  trigger: definition(migration, "create function private.clear_adult_invitation_note_envelope_v1(",
    "CREATE OR REPLACE FUNCTION private.clear_adult_invitation_note_envelope_v1()\n RETURNS trigger\n LANGUAGE plpgsql\n SET search_path TO ''\n"),
};

/** The core as 20261119110000 left it: 20260906061029's body with the D-140 guard. */
function core(): string {
  const source = read("supabase/migrations/20260906061029_invitation_transition_guards.sql");
  const before = definition(source, "create or replace function public.create_adult_subject_invitation_v1(",
    "CREATE OR REPLACE FUNCTION private.create_adult_subject_invitation_core_v1(p_account_id uuid, p_contact_ciphertext bytea, "
      + "p_contact_hmac text, p_idempotency_key text, p_test_jurisdiction boolean)\n" + TABLE
      + " LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\n");
  expect(md5(before)).toBe("8c330bee64e40182f7df90fdff39505d");
  const guard = read("supabase/migrations/20261119110000_dropped_bucket_literals_and_guard.sql");
  const patch = /\(1,'private\.create_adult_subject_invitation_core_v1\(uuid,bytea,text,text,boolean\)','8c330bee64e40182f7df90fdff39505d',\s*'([0-9a-f]{32})','[^']+',\s*\$old\$([\s\S]*?)\$old\$,\s*\$new\$([\s\S]*?)\$new\$/.exec(guard)!;
  const after = before.replace(patch[2]!, () => patch[3]!);
  expect(md5(after)).toBe(patch[1]);
  return after;
}

const preflight = between(migration, "do $predecessor$", "$predecessor$;");
const sealTable = between(migration, "do $seal_table$", "$seal_table$;");
const postflight = between(migration, "do $postflight$", "$postflight$;");

describe("the release it belongs to", () => {
  it("is a guarded production release, alone in its stamp, after every migration whose objects it pins or replaces", () => {
    expect(migration.startsWith("-- =====================================================================\n"
      + "-- PRODUCTION RELEASE: GUARDED.")).toBe(true);
    expect(files.filter(file => file.startsWith("20261119134500_"))).toEqual([NAME]);
    for (const earlier of ["20260906061029", "20260928130100", "20261023120000", "20261119110000"]) {
      expect(files.some(file => file.startsWith(`${earlier}_`)), earlier).toBe(true);
      expect(NAME > earlier).toBe(true);
    }
  });

  it("restates no door in any later migration, and never restates or patches the core", () => {
    const later = files.filter(file => file > NAME);
    for (const file of later) {
      const sql = read(`supabase/migrations/${file}`);
      for (const door of ["create_adult_subject_invitation_keyed_v1", "create_adult_subject_invitation_v1",
        "create_adult_subject_invitation_with_nonce_v1", "clear_adult_invitation_note_envelope_v1"]) {
        expect(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:\\w+\\.)?${door}\\s*\\(`, "i").test(sql), `${file}: ${door}`)
          .toBe(false);
      }
    }
    // The convention the D-140 test reads as a rewrite of the core.
    expect(/create\s+(?:or\s+replace\s+)?function\s+(?:\w+\.)?create_adult_subject_invitation_core_v1\s*\(/i.test(migration)).toBe(false);
    expect(migration).not.toContain("replace(definition");
  });
});

describe("the predecessor block", () => {
  it("pins each door and the core to the md5 recomputed from its source and to its exact ACL", () => {
    const pins: [string, string, string][] = [
      ["private.create_adult_subject_invitation_core_v1(uuid,bytea,text,text,boolean)", md5(core()), OWNER],
      ["private.create_adult_subject_invitation_keyed_v1(uuid,bytea,text,text,boolean,jsonb,jsonb)", md5(predecessors.keyed), SERVICE],
      ["public.create_adult_subject_invitation_v1(uuid,bytea,text,text,boolean,jsonb,jsonb)", md5(predecessors.public), SERVICE],
      ["public.create_adult_subject_invitation_with_nonce_v1(uuid,uuid,bytea,text,text,boolean,jsonb,jsonb,text,timestamptz)",
        md5(predecessors.nonce), SERVICE],
    ];
    expect(pins.map(([, digest]) => digest)).toEqual(["72ea3d6e8b41bfe74d8645259f7cfad7", "20bdaa2fe113d92c696af0112fe072b5",
      "160df78ea5b4bce3a1680fa84cb2cec9", "9819f58145dbbacb8926b651f983c8c2"]);
    for (const [signature, digest, acl] of pins) {
      expect(preflight).toMatch(new RegExp(`\\('${signature.replace(/[()[\]]/g, "\\$&")}',\\s*'${digest}',\\s*'${acl.replace(/[{}]/g, "\\$&")}'\\)`));
    }
    expect(preflight).toContain("on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body\n"
      + "    and p.proacl::text=x.acl)<>4");
    expect(preflight).toContain("raise exception using errcode='55000',message='sealed invitation note prerequisite differs'");
  });

  it("refuses when anything it creates already exists", () => {
    for (const created of ["'private.create_adult_subject_invitation_keyed_v1(uuid,bytea,text,text,boolean,jsonb,jsonb,jsonb)') is not null",
      "'public.create_adult_subject_invitation_v1(uuid,bytea,text,text,boolean,jsonb,jsonb,jsonb)') is not null",
      "'public.create_adult_subject_invitation_with_nonce_v1(uuid,uuid,bytea,text,text,boolean,jsonb,jsonb,text,timestamptz,jsonb)')\n   is not null",
      "'private.clear_adult_invitation_note_envelope_v1()') is not null",
      "conname='mail_outbox_adult_invitation_note_sealed')", "tgname='clear_adult_invitation_note_envelope')"]) {
      expect(preflight).toContain(created);
    }
  });

  it("pins the provider attempt key the worker reproduces, in both blocks, to the digest of its formula", () => {
    const pinned = createHash("sha256").update(`mail-token-attempt-v1|${"a".repeat(64)}|3`, "utf8").digest("hex");
    expect(pinned).toBe("6f1e8bd33056fe66d4fcfd2b65ab888dae730da76626fa0bca5399fe944c4517");
    for (const block of [preflight, postflight]) {
      expect(block).toContain("'idempotency_key',repeat('a',64),'token_purpose','adult-subject-invitation','attempt_count',3)))\n"
        + `   is distinct from '${pinned}'`);
    }
    // The formula the claim uses, as last defined, and the one the worker recomputes.
    const defining = files.filter(file => /function private\.mail_provider_attempt_key_v1\(/u.test(read(`supabase/migrations/${file}`)));
    expect(defining.length).toBeGreaterThan(0);
    expect(read(`supabase/migrations/${defining.at(-1)!}`))
      .toContain("'mail-token-attempt-v1|'||m.idempotency_key||'|'||m.attempt_count");
    expect(read("src/lib/adult-invitation-note.ts")).toContain("`mail-token-attempt-v1|${idempotencyKey}|${attemptOrdinal}`");
  });

  it("is the block the pgTAP suite drives, byte for byte", () => {
    expect(between(pgtap, "create function pg_temp.predecessor() returns void language plpgsql as $predecessor$",
      "$predecessor$;")).toBe(preflight);
  });
});

describe("the table", () => {
  it("locks first, refuses a plain note on a sendable row, removes it from rows nothing sends again, then adds the check", () => {
    const lock = sealTable.indexOf("lock table public.mail_outbox in access exclusive mode;");
    const refuse = sealTable.indexOf("and state in ('queued','claimed') and template_payload ? 'note') then\n"
      + "  raise exception using errcode='55000',message='plain invitation note on a sendable row'; end if;");
    const strip = sealTable.indexOf("update public.mail_outbox set template_payload=template_payload-'note'\n"
      + "  where template_id='adult-subject-invitation' and state not in ('queued','claimed') and template_payload ? 'note';");
    const check = sealTable.indexOf("alter table public.mail_outbox add constraint mail_outbox_adult_invitation_note_sealed check (");
    expect(lock).toBeGreaterThan(0);
    expect(refuse).toBeGreaterThan(lock);
    expect(strip).toBeGreaterThan(refuse);
    expect(check).toBeGreaterThan(strip);
    expect(count(sealTable, "update public.mail_outbox")).toBe(1);
    expect(sealTable).not.toMatch(/not valid|delete from/i);
  });

  it("holds the envelope to the same shape the door checks, bound to the row's own key", () => {
    const fromCheck = between(sealTable, "or (\n", ")),false));").replaceAll("(template_payload->'noteEnvelope') ?&", "E ?&")
      .replaceAll("(template_payload->'noteEnvelope')-array", "E-array")
      .replaceAll("template_payload->'noteEnvelope'", "E").replaceAll("to_jsonb(idempotency_key)", "K");
    const keyed = between(successors.keyed, "if p_note_envelope is not null and not coalesce(\n", ",false) then");
    const fromDoor = keyed.replaceAll("p_note_envelope", "E").replaceAll("to_jsonb(p_idempotency_key)", "K");
    const conjuncts = (text: string) => text.split("\n").map(line => line.trim().replace(/^and /, "")).filter(Boolean);
    expect(conjuncts(fromCheck)).toEqual(conjuncts(fromDoor));
    expect(conjuncts(fromDoor)).toEqual([
      "jsonb_typeof(E)='object'",
      "E ?& array['version','idempotencyKey','wrappedKey','ciphertext']",
      "E-array['version','idempotencyKey','wrappedKey','ciphertext']='{}'::jsonb",
      "E->'version'='1'::jsonb",
      "E->'idempotencyKey'=K",
      "jsonb_typeof(E->'wrappedKey')='string'",
      "E->>'wrappedKey' ~ '^[0-9a-f]{144}$'",
      "jsonb_typeof(E->'ciphertext')='string'",
      "E->>'ciphertext' ~ '^[0-9a-f]+$'",
      "length(E->>'ciphertext') between 58 and 3056",
      "length(E->>'ciphertext')%2=0",
    ]);
    // An invitation row holds only Path B's request or Path A's envelope, never both, and nothing else.
    expect(sealTable).toContain("  template_id<>'adult-subject-invitation'\n"
      + "  or coalesce(template_payload-array['request','noteEnvelope']='{}'::jsonb\n"
      + "   and not (template_payload ? 'request' and template_payload ? 'noteEnvelope')");
  });

  it("bounds the envelope exactly where the application's sealing lands", () => {
    // 72 bytes of wrapped key: 12-byte IV, 16-byte tag, 44 characters of base64.
    expect(2 * (12 + 16 + Buffer.from("x".repeat(32)).toString("base64").length)).toBe(144);
    // 28 bytes of envelope overhead and 1 to 1,500 bytes of note (500 UTF-16 units, at most 3 bytes each).
    expect([2 * (28 + 1), 2 * (28 + 3 * 500)]).toEqual([58, 3056]);
    const sealing = read("src/lib/adult-invitation-note.ts");
    expect(sealing).toContain("wrappedKey: z.string().regex(/^[0-9a-f]{144}$/u)");
    expect(sealing).toContain("ciphertext: z.string().regex(/^(?:[0-9a-f]{2}){29,1528}$/u)");
    expect(sealing).toContain(".max(500)");
  });

  it("is the block the pgTAP suite drives, byte for byte", () => {
    expect(between(pgtap, "create function pg_temp.seal_table() returns void language plpgsql as $seal_table$",
      "$seal_table$;")).toBe(sealTable);
  });
});

describe("the envelope's lifetime", () => {
  it("is removed, in the moving transaction, from an invitation row that leaves queued and claimed", () => {
    expect(successors.trigger).toContain("begin\n new.template_payload:=new.template_payload-'noteEnvelope';\n return new;\nend ");
    expect(migration).toContain("create trigger clear_adult_invitation_note_envelope before update on public.mail_outbox for each row\n"
      + " when (new.template_id='adult-subject-invitation' and new.state not in ('queued','claimed')\n"
      + "  and new.template_payload ? 'noteEnvelope')\n"
      + " execute function private.clear_adult_invitation_note_envelope_v1();");
  });
});

describe("the three doors", () => {
  it("drop the old signatures and recreate each with one trailing defaulted parameter", () => {
    for (const dropped of ["drop function public.create_adult_subject_invitation_with_nonce_v1(uuid,uuid,bytea,text,text,boolean,jsonb,jsonb,text,timestamptz);",
      "drop function public.create_adult_subject_invitation_v1(uuid,bytea,text,text,boolean,jsonb,jsonb);",
      "drop function private.create_adult_subject_invitation_keyed_v1(uuid,bytea,text,text,boolean,jsonb,jsonb);"]) {
      expect(count(migration, dropped)).toBe(1);
    }
    expect(count(migration, "drop function")).toBe(3);
    // Each body passes the envelope on, and nothing else changes in the two thin doors.
    expect(successors.public.replace(", p_note_envelope);", ");").replace(NOTE_ARG, ""))
      .toBe(predecessors.public);
    expect(successors.nonce.replace(",p_quota_keys,p_note_envelope) x;", ",p_quota_keys) x;").replace(NOTE_ARG, ""))
      .toBe(predecessors.nonce);
  });

  it("keep the keyed body's order: the lock, the envelope check, the quota, the keyring, the replay test, the core, the note", () => {
    const body = successors.keyed;
    const steps = ["perform private.lock_invitation_transitions_v1();",
      "if p_note_envelope is not null and not coalesce(",
      "raise exception using errcode = '22023', message = 'adult invitation note invalid';",
      "if not private.consume_invitation_attempt_quota_v1(p_quota_keys) then",
      "v_set := private.resolve_hmac_set_v1('contact', p_contact_hmac, p_contact_hmac_set);",
      "v_replay := exists (",
      "from private.create_adult_subject_invitation_core_v1(",
      "if p_note_envelope is not null and not v_replay and v_invitation_id is not null then",
      "set template_payload = jsonb_build_object('noteEnvelope', p_note_envelope)",
      "raise exception using errcode = '55000', message = 'adult invitation note unrecorded';",
      "perform private.declare_contact_alias_groups_v1('[]'::jsonb);",
      "return query select v_invitation_id, v_subject_id, v_expires_at;"];
    const at = steps.map(step => body.indexOf(step));
    for (const [index, position] of at.entries()) expect(position, steps[index]).toBeGreaterThan(0);
    expect([...at].sort((left, right) => left - right)).toEqual(at);
    // The replay test reads exactly what the core's own replay test reads.
    expect(body).toContain("where m.idempotency_key = p_idempotency_key\n      and m.template_id = 'adult-subject-invitation'\n"
      + "      and m.target_kind = 'subject_invitation');");
    expect(core()).toContain("where m.idempotency_key = p_idempotency_key\n    and m.template_id = 'adult-subject-invitation'\n"
      + "    and m.target_kind = 'subject_invitation';");
    // The note goes only onto the new invitation's own queued, empty mail row.
    expect(body).toContain("    where m.idempotency_key = p_idempotency_key\n      and m.template_id = 'adult-subject-invitation'\n"
      + "      and m.target_kind = 'subject_invitation'\n      and m.target_id = v_invitation_id\n      and m.state = 'queued'\n"
      + "      and m.template_payload = '{}'::jsonb;\n    if not found then");
    // Everything the predecessor did, it still does: the quota refusal and the keyring declarations, verbatim.
    for (const kept of [between(predecessors.keyed, "  perform private.lock_invitation_transitions_v1();\n", "  return query select * from"),
      "    coalesce(v_set ->> private.hmac_active_revision_v1('contact')::text, p_contact_hmac),\n    p_idempotency_key, p_test_jurisdiction)"]) {
      expect(body).toContain(kept);
    }
  });

  it("grant each exactly what its predecessor had", () => {
    expect(migration).toContain("revoke all on function private.create_adult_subject_invitation_keyed_v1(\n"
      + "  uuid, bytea, text, text, boolean, jsonb, jsonb, jsonb\n) from public, anon, authenticated, service_role, inherit_upload_only;\n"
      + "grant execute on function private.create_adult_subject_invitation_keyed_v1(\n"
      + "  uuid, bytea, text, text, boolean, jsonb, jsonb, jsonb\n) to service_role;");
    expect(migration).toContain("revoke all on function public.create_adult_subject_invitation_v1(\n"
      + "  uuid, bytea, text, text, boolean, jsonb, jsonb, jsonb\n) from public, anon, authenticated, inherit_upload_only;\n"
      + "grant execute on function public.create_adult_subject_invitation_v1(\n"
      + "  uuid, bytea, text, text, boolean, jsonb, jsonb, jsonb\n) to service_role;");
    expect(migration).toContain("revoke all on function public.create_adult_subject_invitation_with_nonce_v1(uuid,uuid,bytea,text,text,boolean,jsonb,jsonb,text,timestamptz,jsonb)\n"
      + " from public,anon,authenticated,inherit_upload_only;\n"
      + "grant execute on function public.create_adult_subject_invitation_with_nonce_v1(uuid,uuid,bytea,text,text,boolean,jsonb,jsonb,text,timestamptz,jsonb)\n"
      + " to service_role;");
    expect(migration).toContain("revoke all on function private.clear_adult_invitation_note_envelope_v1()\n"
      + " from public,anon,authenticated,service_role,inherit_upload_only;");
    expect(count(migration, "grant execute")).toBe(3);
  });
});

describe("the postflight", () => {
  it("pins every successor to the md5 recomputed from this migration, with its ACL, and the pgTAP suite pins the same", () => {
    const pins: [string, string, string][] = [
      ["private.create_adult_subject_invitation_core_v1(uuid,bytea,text,text,boolean)", md5(core()), OWNER],
      ["private.create_adult_subject_invitation_keyed_v1(uuid,bytea,text,text,boolean,jsonb,jsonb,jsonb)", md5(successors.keyed), SERVICE],
      ["public.create_adult_subject_invitation_v1(uuid,bytea,text,text,boolean,jsonb,jsonb,jsonb)", md5(successors.public), SERVICE],
      ["public.create_adult_subject_invitation_with_nonce_v1(uuid,uuid,bytea,text,text,boolean,jsonb,jsonb,text,timestamptz,jsonb)",
        md5(successors.nonce), SERVICE],
      ["private.clear_adult_invitation_note_envelope_v1()", md5(successors.trigger), OWNER],
    ];
    expect(pins.slice(1).map(([, digest]) => digest)).toEqual(["d52340218a6b537108fe5a607babc934", "24cfb0d901b6dad3b06bed8589dea711",
      "de553b25718a0ef23dba647af8365714", "a5755b564addae646189029029729b3c"]);
    for (const [signature, digest, acl] of pins) {
      expect(postflight).toMatch(new RegExp(`\\('${signature.replace(/[()[\]]/g, "\\$&")}',\\s*'${digest}',\\s*'${acl.replace(/[{}]/g, "\\$&")}'\\)`));
      expect(pgtap).toMatch(new RegExp(`\\('${signature.replace(/[()[\]]/g, "\\$&")}',\\s*'${digest} ${acl.replace(/[{}]/g, "\\$&")}'\\)`));
    }
    expect(postflight).toContain("and p.proacl::text=x.acl)<>5");
    expect(postflight).toContain("p.proname in ('create_adult_subject_invitation_keyed_v1',\n"
      + "     'create_adult_subject_invitation_v1','create_adult_subject_invitation_with_nonce_v1'))<>3");
    expect(postflight).toContain("or exists(select 1 from public.mail_outbox where template_id='adult-subject-invitation' and template_payload ? 'note')");
    expect(migration.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });

  it("reads the check and the trigger exactly as the pgTAP suite does", () => {
    /** A run of SQL string literals joined by `||`, as the one string it builds. */
    const concatenated = (text: string) => [...text.matchAll(/'((?:''|[^'])*)'/gu)].map(match => match[1]!.replaceAll("''", "'")).join("");
    const check = concatenated(between(pgtap,
      "and c.conname='mail_outbox_adult_invitation_note_sealed' and c.contype='c' and c.convalidated),\n", ",\n 'the table holds"));
    expect(check.startsWith("CHECK (((template_id <> 'adult-subject-invitation'::text) OR COALESCE(")).toBe(true);
    expect(between(postflight, "and c.conname='mail_outbox_adult_invitation_note_sealed' and c.contype='c' and c.convalidated)\n"
      + "   is distinct from '", "'")).toBe(md5(check));
    const triggerInPostflight = concatenated(between(postflight,
      "and t.tgname='clear_adult_invitation_note_envelope' and t.tgenabled='O')\n   is distinct from ", "\n  or exists"));
    const triggerInPgtap = concatenated(between(pgtap,
      "and t.tgname='clear_adult_invitation_note_envelope' and t.tgenabled='O'),\n", ",\n 'the envelope trigger"));
    expect(triggerInPostflight).toBe(triggerInPgtap);
    expect(triggerInPgtap).toBe("CREATE TRIGGER clear_adult_invitation_note_envelope BEFORE UPDATE ON public.mail_outbox FOR EACH ROW "
      + "WHEN (((new.template_id = 'adult-subject-invitation'::text) AND (new.state <> ALL (ARRAY['queued'::text, 'claimed'::text])) "
      + "AND (new.template_payload ? 'noteEnvelope'::text))) EXECUTE FUNCTION private.clear_adult_invitation_note_envelope_v1()");
  });
});

describe("the route and the worker", () => {
  it("leave the note to the transaction: the route writes no table and sends the envelope only with a note", () => {
    const route = read("src/app/api/subject-drafts/route.ts");
    expect(route).not.toContain(".from(\"mail_outbox\")");
    expect(route).not.toContain("template_payload");
    expect(route).toContain("...(noteEnvelope === undefined ? {} : { p_note_envelope: noteEnvelope }),");
    expect(route).toContain("sealAdultInvitationNote(parsed.data.note, idempotencyKey)");
    const worker = read("src/app/api/jobs/mail/route.ts");
    expect(worker).toContain("noteEnvelope: adultInvitationNoteEnvelope.optional(),");
    expect(worker).not.toMatch(/\n\s+note: z\b/u);
  });
});
