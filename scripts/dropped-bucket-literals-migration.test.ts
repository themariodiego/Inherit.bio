import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * D-130 and D-140 (20261119110000_dropped_bucket_literals_and_guard.sql). The
 * migration pins five function bodies by md5 and patches three of them in
 * place under the md5-guarded convention, and it rewrites three bucket checks.
 * pg_get_functiondef keeps a plpgsql body verbatim, so each pinned body is
 * rebuilt here from the migration that last defined it and every md5 is
 * recomputed from source; the checks are read from the migrations that last
 * defined them. The pgTAP suite (supabase/tests/dropped_bucket_literals_and_guard.sql)
 * drives the migration's own blocks through every state they must refuse; its
 * copies must be those blocks byte for byte.
 */

const root = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");
const count = (text: string, fragment: string) => text.split(fragment).length - 1;

const NAME = "20261119110000_dropped_bucket_literals_and_guard.sql";
const migration = read(`supabase/migrations/${NAME}`);
const pgtap = read("supabase/tests/dropped_bucket_literals_and_guard.sql");
const OWNER = "{postgres=X/postgres}";
const SERVICE = "{postgres=X/postgres,service_role=X/postgres}";

interface Pinned { signature: string; header: string; source: string; marker: string; md5: string; acl: string }

/** Each function the migration pins, with the header pg_get_functiondef prints and where its body was last defined. */
const PINNED: Pinned[] = [
  {
    signature: "public.claim_due_account_deletion_v1(text,integer)",
    header: "CREATE OR REPLACE FUNCTION public.claim_due_account_deletion_v1(p_claim_token_hash text, p_lease_seconds integer DEFAULT 300)\n"
      + " RETURNS TABLE(deletion_id uuid, account_id uuid, storage_objects jsonb, database_already_purged boolean)\n"
      + " LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\n",
    source: "supabase/migrations/20260930238000_account_cohort_notices.sql",
    marker: "create or replace function public.claim_due_account_deletion_v1(",
    md5: "a67a7a734a1e3bf392f5bdaf40678b6e", acl: SERVICE,
  },
  {
    signature: "public.prepare_embryo_ingest_unwind_v1(uuid,bigint)",
    header: "CREATE OR REPLACE FUNCTION public.prepare_embryo_ingest_unwind_v1(p_cohort_id uuid, p_ingest_revision bigint)\n"
      + " RETURNS jsonb\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\n SET lock_timeout TO '250ms'\n",
    source: "supabase/migrations/20260930132000_embryo_canonical_part_disposal.sql",
    marker: "create or replace function public.prepare_embryo_ingest_unwind_v1(",
    md5: "370cf6155b34299765c50ef2a7fefdbc", acl: SERVICE,
  },
  {
    signature: "private.create_adult_subject_invitation_core_v1(uuid,bytea,text,text,boolean)",
    header: "CREATE OR REPLACE FUNCTION private.create_adult_subject_invitation_core_v1(p_account_id uuid, p_contact_ciphertext bytea, "
      + "p_contact_hmac text, p_idempotency_key text, p_test_jurisdiction boolean)\n"
      + " RETURNS TABLE(invitation_id uuid, subject_id uuid, expires_at timestamp with time zone)\n"
      + " LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\n",
    // 20260928130100 moved the body unchanged into private and renamed it.
    source: "supabase/migrations/20260906061029_invitation_transition_guards.sql",
    marker: "create or replace function public.create_adult_subject_invitation_v1(",
    md5: "8c330bee64e40182f7df90fdff39505d", acl: OWNER,
  },
  {
    signature: "private.create_embryo_cohort_draft_core_v1(uuid,uuid,text,text,integer,bytea,text,text[],text[],text,boolean)",
    header: "CREATE OR REPLACE FUNCTION private.create_embryo_cohort_draft_core_v1(p_account_id uuid, p_session_id uuid, "
      + "p_upload_situation text, p_basis_case text, p_embryo_count integer, p_owner_contact_ciphertext bytea, "
      + "p_owner_contact_hmac text, p_contact_ciphertexts text[], p_contact_hmacs text[], p_token_nonce text, p_test_jurisdiction boolean)\n"
      + " RETURNS TABLE(draft_id uuid, expires_at timestamp with time zone, required_principal_slots text[])\n"
      + " LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\n",
    source: "supabase/migrations/20260906061029_invitation_transition_guards.sql",
    marker: "create or replace function public.create_embryo_cohort_draft_v1(",
    md5: "5f87e19b0324a34ef2945c2f2158313d", acl: OWNER,
  },
  {
    signature: "private.create_embryo_draft_invitation_core_v1(uuid,uuid,uuid,text,text,text,boolean)",
    header: "CREATE OR REPLACE FUNCTION private.create_embryo_draft_invitation_core_v1(p_account_id uuid, p_session_id uuid, "
      + "p_draft_id uuid, p_contact_hmac text, p_idempotency_key text, p_token_nonce text, p_test_jurisdiction boolean)\n"
      + " RETURNS TABLE(invitation_id uuid, expires_at timestamp with time zone)\n"
      + " LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO ''\n",
    source: "supabase/migrations/20260906061029_invitation_transition_guards.sql",
    marker: "create or replace function public.create_embryo_draft_invitation_v1(",
    md5: "6bc9b8cda82896772859a4887ad888c1", acl: OWNER,
  },
];

/** The migrations, in apply order. */
const files = readdirSync(path.join(root, "supabase/migrations")).filter(file => file.endsWith(".sql")).sort();

/** A pinned function as pg_get_functiondef prints it: its normalized header around the verbatim body. */
function definition(pinned: Pinned): string {
  const source = read(pinned.source);
  const start = source.lastIndexOf(pinned.marker);
  expect(start, pinned.marker).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("as $$", start) + "as $$".length;
  const close = source.indexOf("$$;", open);
  return `${pinned.header}AS $function$${source.slice(open, close)}$function$\n`;
}

/** The text between two markers, the first occurrence after `after`. */
function between(text: string, start: string, end: string, after = 0): string {
  const from = text.indexOf(start, after);
  expect(from, start).toBeGreaterThanOrEqual(0);
  const to = text.indexOf(end, from + start.length);
  expect(to, end).toBeGreaterThan(from);
  return text.slice(from + start.length, to);
}

interface Patch { ordinal: number; target: string; before: string; after: string; acl: string; old: string; next: string; label: string }
const patches: Patch[] = [...migration.matchAll(
  /\((\d+),'([^']+)',\s*'([0-9a-f]{32})',\s*'([0-9a-f]{32})','([^']+)',\s*\$old\$([\s\S]*?)\$old\$,\s*\$new\$([\s\S]*?)\$new\$,\s*'([^']+)'\)/g,
)].map(match => ({ ordinal: Number(match[1]), target: match[2]!, before: match[3]!, after: match[4]!, acl: match[5]!,
  old: match[6]!, next: match[7]!, label: match[8]! }));

/** A bucket check's IN list, as written in `check (bucket_id in (...))`. */
const inList = (text: string) => [...text.matchAll(/'([^']+)'/g)].map(literal => literal[1]!);

describe("the release it belongs to", () => {
  it("is a guarded production release, after every migration whose objects it pins, patches or tightens", () => {
    expect(migration.startsWith("-- =====================================================================\n"
      + "-- PRODUCTION RELEASE: GUARDED.")).toBe(true);
    expect(files.at(-1)).toBe(NAME);
    for (const earlier of ["20260906061029", "20260928130100", "20260929101000", "20260930132000", "20260930140000",
      "20260930140100", "20260930235000", "20260930238000", "20261025400000"]) {
      expect(files.some(file => file.startsWith(`${earlier}_`)), earlier).toBe(true);
      expect(NAME > earlier).toBe(true);
    }
  });

  it("pins each function where it was last defined: no later migration restates or patches it", () => {
    /** Whether a migration restates the function, or patches it in place under the convention. */
    const rewrites = (file: string, qualified: string) => {
      const sql = read(`supabase/migrations/${file}`);
      const local = qualified.slice(qualified.indexOf(".") + 1);
      return new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:\\w+\\.)?${local}\\s*\\(`, "i").test(sql)
        || (sql.includes(`'${qualified}(`) && sql.includes("replace(definition"));
    };
    const RENAME = "20260928130100_invitation_keyring_quota_doors.sql";
    for (const pinned of PINNED) {
      const sourceName = path.basename(pinned.source);
      const qualified = pinned.signature.slice(0, pinned.signature.indexOf("("));
      const later = files.filter(file => file > sourceName && file !== NAME);
      if (qualified.startsWith("private.")) {
        // Under its public name until the rename, under its private name after it.
        const original = pinned.marker.slice("create or replace function ".length, -1);
        expect(later.filter(file => file < RENAME && rewrites(file, original)), original).toEqual([]);
        expect(later.filter(file => file >= RENAME && rewrites(file, qualified)), qualified).toEqual([]);
      } else {
        expect(later.filter(file => rewrites(file, qualified)), qualified).toEqual([]);
      }
    }
    // The rename moves each core with `set schema` and `rename to`, never a new body.
    const rename = read(`supabase/migrations/${RENAME}`);
    for (const core of ["create_adult_subject_invitation_core_v1", "create_embryo_cohort_draft_core_v1",
      "create_embryo_draft_invitation_core_v1"]) {
      expect(rename).toContain(`) rename to ${core};`);
    }
  });
});

describe("the predecessor block", () => {
  const preflight = between(migration, "do $predecessor$", "$predecessor$;");

  it("pins each function to the md5 recomputed from its source and to its exact ACL", () => {
    for (const pinned of PINNED) {
      expect(md5(definition(pinned)), pinned.signature).toBe(pinned.md5);
      expect(preflight).toMatch(new RegExp(`\\('${pinned.signature.replace(/[()[\]]/g, "\\$&")}',\\s*'${pinned.md5}',\\s*'${pinned.acl.replace(/[{}]/g, "\\$&")}'\\)`));
    }
    // Every pin binds body and ACL to its own signature, and all five must hold.
    expect(preflight).toContain("on p.oid=to_regprocedure(x.signature) and md5(pg_get_functiondef(p.oid))=x.body\n"
      + "    and p.proacl::text=x.acl)<>5");
    expect(preflight).toContain("select count(distinct x.signature) from pg_proc p join (values");
    expect(count(preflight, "'{postgres=X/postgres")).toBe(PINNED.length);
    expect(preflight).toContain("raise exception using errcode='55000',message='dropped bucket literals prerequisite differs'");
  });

  it("pins each check to the definition the migrations left, validated, and requires both buckets gone", () => {
    expect(preflight).toContain("and c.contype='c' and c.convalidated and pg_get_constraintdef(c.oid)=x.definition)<>3");
    expect(preflight).toContain("or exists(select 1 from storage.buckets where id in ('genomes-staging','generated-artifacts'))");
    expect(preflight).toContain("'CHECK ((bucket_id = ANY (ARRAY[''genomes''::text, ''generated-artifacts''::text])))'");
    expect(preflight).toContain("'CHECK ((bucket_id = ANY (ARRAY[''genomes''::text, ''genomes-staging''::text, "
      + "''generated-artifacts''::text, ''legal-evidence''::text])))'");
    expect(preflight).toContain("'CHECK (((bucket_id = ANY (ARRAY[''genomes''::text, ''genomes-staging''::text, "
      + "''generated-artifacts''::text, ''legal-evidence''::text])) OR (bucket_id ~ ''^inherit-embryo-[a-z0-9-]{1,40}$''::text)))'");
  });

  it("is the block the pgTAP suite drives, byte for byte", () => {
    expect(between(pgtap, "create function pg_temp.predecessor() returns void language plpgsql as $predecessor$",
      "$predecessor$;")).toBe(preflight);
  });
});

describe("the bucket checks", () => {
  const tighten = between(migration, "do $tighten$", "$tighten$;");
  const lastDefinition = (table: string): string[] => {
    // The latest IN list for this table's bucket check, in apply order, before this migration.
    let list: string[] | undefined;
    for (const file of files.filter(name => name < NAME)) {
      const sql = read(`supabase/migrations/${file}`);
      const created = new RegExp(`create\\s+table\\s+public\\.${table}\\s*\\([^;]*?\\bbucket_id\\s+text[^,]*?check\\s*\\(\\s*bucket_id\\s+in\\s*\\(([^)]*)\\)`, "i").exec(sql);
      if (created) list = inList(created[1]!);
      const added = new RegExp(`add\\s+constraint\\s+${table}_bucket_id_check\\s+check\\s*\\(\\s*bucket_id\\s+in\\s*\\(([^)]*)\\)`, "i").exec(sql);
      if (added) list = inList(added[1]!);
    }
    expect(list, table).toBeDefined();
    return list!;
  };
  const rewritten = (table: string): string => between(tighten,
    `drop constraint ${table}_bucket_id_check,\n  add constraint ${table}_bucket_id_check check (`, ";");

  it("each loses exactly the dropped buckets and keeps every other one it admitted", () => {
    const dropped = ["genomes-staging", "generated-artifacts"];
    for (const table of ["account_deletion_storage_entries", "embryo_ingest_delete_objects", "genome_storage_objects"]) {
      const before = lastDefinition(table);
      expect(before.some(bucket => dropped.includes(bucket)), table).toBe(true);
      expect(inList(rewritten(table).slice(0, rewritten(table).indexOf(")"))), table)
        .toEqual(before.filter(bucket => !dropped.includes(bucket)));
    }
    // The embryo inventory keeps its R2 bucket pattern exactly as 20260929101000 wrote it.
    expect(rewritten("embryo_ingest_delete_objects")).toContain("\n   or bucket_id ~ '^inherit-embryo-[a-z0-9-]{1,40}$')");
    expect(read("supabase/migrations/20260929101000_embryo_ingest_unwind_storage.sql"))
      .toContain("or bucket_id ~ '^inherit-embryo-[a-z0-9-]{1,40}$'),");
  });

  it("locks the three tables first, refuses on any row that names a dropped bucket, then rewrites the checks", () => {
    const lock = tighten.indexOf("lock table public.account_deletion_storage_entries,public.embryo_ingest_delete_objects,"
      + "public.genome_storage_objects\n  in access exclusive mode;");
    expect(lock).toBeGreaterThan(0);
    const refusals = ["account_deletion_storage_entries", "embryo_ingest_delete_objects", "genome_storage_objects"].map(table => {
      const at = tighten.indexOf(`if exists(select 1 from public.${table} where bucket_id in ('genomes-staging','generated-artifacts')) then\n`
        + `  raise exception using errcode='55000',message='dropped bucket recorded in public.${table}'; end if;`);
      expect(at, table).toBeGreaterThan(lock);
      return at;
    });
    const legacy = tighten.indexOf("if exists(select 1 from public.upload_sessions u where u.storage_bucket='genomes-staging'\n"
      + "   and (u.cohort_id is not null or exists(select 1 from public.subjects s where s.id=u.subject_id and s.cohort_id is not null))) then");
    expect(legacy).toBeGreaterThan(lock);
    const firstAlter = tighten.indexOf("alter table");
    for (const at of [...refusals, legacy]) expect(at).toBeLessThan(firstAlter);
    expect(count(tighten, "alter table")).toBe(3);
    expect(tighten).not.toMatch(/not valid/i);
  });

  it("is the block the pgTAP suite drives, byte for byte, and the postflight reads the result", () => {
    expect(between(pgtap, "create function pg_temp.tighten() returns void language plpgsql as $tighten$", "$tighten$;")).toBe(tighten);
    const postflight = between(migration, "do $postflight$", "$postflight$;");
    expect(postflight).toContain("'CHECK ((bucket_id = ''genomes''::text))'");
    expect(postflight).toContain("'CHECK ((bucket_id = ANY (ARRAY[''genomes''::text, ''legal-evidence''::text])))'");
    expect(postflight).toContain("'CHECK (((bucket_id = ANY (ARRAY[''genomes''::text, ''legal-evidence''::text])) "
      + "OR (bucket_id ~ ''^inherit-embryo-[a-z0-9-]{1,40}$''::text)))'");
    expect(postflight).not.toContain("genomes-staging");
    expect(postflight).not.toContain("generated-artifacts");
  });
});

describe("the builders the checks govern", () => {
  it("read the session's own bucket for the staging leg, and no longer carry either dropped bucket", () => {
    const [claim, prepare] = PINNED.map(definition);
    expect(claim).toContain("select us.storage_bucket, us.staging_object_name,\n        'upload-staging', us.id");
    expect(claim).toContain("where so.bucket_id = us.storage_bucket\n            and so.name = us.staging_object_name");
    expect(prepare).toContain("select storage_bucket,staging_object_name,'upload-staging',id from public.upload_sessions");
    for (const body of [claim, prepare]) {
      expect(body).not.toContain("genomes-staging");
      expect(body).not.toContain("generated-artifacts");
    }
  });
});

describe("the guarded in-place patch of the three jurisdiction guards", () => {
  const cores = PINNED.slice(2);

  it("names the three cores with their exact reviewed predecessors and ACL", () => {
    expect(patches.map(patch => patch.ordinal)).toEqual([1, 2, 3]);
    expect(patches.map(patch => patch.target)).toEqual(cores.map(core => core.signature));
    for (const [index, patch] of patches.entries()) {
      expect(patch.acl).toBe(OWNER);
      expect(patch.before).toBe(md5(definition(cores[index]!)));
    }
  });

  it("finds each anchor exactly once, changes only `not p_test_jurisdiction`, and reaches the reviewed successor", () => {
    for (const [index, patch] of patches.entries()) {
      const before = definition(cores[index]!);
      expect(count(before, patch.old), patch.label).toBe(1);
      expect(count(before, "not p_test_jurisdiction"), patch.label).toBe(1);
      expect(patch.old.startsWith("  if not p_test_jurisdiction")).toBe(true);
      expect(patch.next).toBe(patch.old.replace("  if not p_test_jurisdiction", "  if p_test_jurisdiction is distinct from true"));
      const after = before.replace(patch.old, () => patch.next);
      expect(md5(after), patch.label).toBe(patch.after);
      expect(after).not.toContain("not p_test_jurisdiction");
      // The pgTAP suite holds the database to the same successor.
      expect(pgtap).toContain(`'${patch.after} ${OWNER}'`);
    }
  });

  it("uses the convention's guard body, which the pgTAP suite runs byte for byte", () => {
    const guard = between(migration, "order by ordinal loop\n", "\n end loop;");
    const reference = read("supabase/migrations/20261024110000_copilot_settings_delete_nonce.sql");
    expect(between(reference, "order by ordinal loop\n", "\n end loop;")).toBe(guard);
    expect(between(pgtap, "declare definition text;before_acl aclitem[];\nbegin\n", "\nend $guarded$;")).toBe(guard);
  });

  it("finds the fail-open shape in no migration after the cores' bodies, and checks the live catalog for it", () => {
    // The shape D-140 names: only the three predecessors carried it, and this
    // migration removes it; its postflight refuses if any function still has it.
    const offenders = files.filter(file => file > "20260906061029_invitation_transition_guards.sql" && file !== NAME)
      .filter(file => /if\s+not\s+p_test_jurisdiction/i.test(read(`supabase/migrations/${file}`)));
    expect(offenders).toEqual([]);
    const postflight = between(migration, "do $postflight$", "$postflight$;");
    expect(postflight).toContain("pg_get_functiondef(p.oid) ~ 'if not p_test_jurisdiction'");
  });
});

describe("what the migration does not do", () => {
  it("grants nothing, creates no function, and restates neither builder", () => {
    expect(migration).not.toMatch(/\bgrant\b[^;]*\bto\b/i);
    expect(migration).not.toMatch(/\brevoke\b/i);
    expect(migration).not.toMatch(/create (or replace )?function/i);
    expect(migration).toContain("notify pgrst, 'reload schema';");
  });
});
