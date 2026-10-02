import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BEGIN, END, PLAN_JSON, PLAN_TEST, planBlock, withPlanBlock } from "../../../scripts/export-member-plan";
import { EXPORT_DISPOSITIONS, exportMemberPlan, exportedTable, parseExportMemberPlan } from "./member-plan";

/**
 * The export member plan, held against the code that reads for the export.
 *
 * `supabase/tests/export_member_plan.sql` holds the plan against the catalog
 * (every table, and every column of an exported table). These tests hold it
 * against the readers: the pgTAP copy is the JSON verbatim, the asynchronous
 * history reader's classes are exactly the plan's and select no withheld
 * column, and the credentials the brief names stay excluded.
 */

const ROOT = path.resolve(__dirname, "../../..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

/** The newest migration that (re)defines a function, which is the live definition. */
function latestDefinition(signature: string): string {
  const files = readdirSync(path.join(ROOT, "supabase/migrations")).filter((file) => file.endsWith(".sql")).sort();
  const defining = files.filter((file) => new RegExp(`create (or replace )?function ${signature.replace(/\./g, "\\.")}\\(`)
    .test(read(`supabase/migrations/${file}`)));
  expect(defining.length, signature).toBeGreaterThan(0);
  return read(`supabase/migrations/${defining.at(-1)!}`);
}

/** The top-level arguments of the first `jsonb_build_object(` call in `text`. */
function buildObjectArguments(text: string): string[] {
  const start = text.indexOf("jsonb_build_object(");
  expect(start, text.slice(0, 80)).toBeGreaterThanOrEqual(0);
  const args: string[] = [];
  let depth = 0, quoted = false, current = "";
  for (const char of text.slice(start + "jsonb_build_object(".length)) {
    if (char === "'" ) quoted = !quoted;
    if (!quoted && char === "(") depth++;
    if (!quoted && char === ")") { if (depth === 0) break; depth--; }
    if (!quoted && depth === 0 && char === ",") { args.push(current.trim()); current = ""; continue; }
    current += char;
  }
  args.push(current.trim());
  return args;
}

/** Every `alias.column` the values of a projection read. */
function columnsRead(args: string[], alias: string): string[] {
  return args.filter((_, index) => index % 2 === 1)
    .flatMap((value) => [...value.matchAll(new RegExp(`\\b${alias}\\.([a-z0-9_]+)`, "g"))].map((match) => match[1]));
}

describe("the export member plan", () => {
  it("is well formed, and every exported table splits its columns into exported and withheld", () => {
    expect(() => parseExportMemberPlan(JSON.parse(read(PLAN_JSON)))).not.toThrow();
    const counts = new Map<string, number>();
    for (const [name, entry] of Object.entries(exportMemberPlan.tables)) {
      counts.set(entry.disposition, (counts.get(entry.disposition) ?? 0) + 1);
      if (entry.disposition !== "exported") continue;
      const overlap = entry.columns.filter((column) => entry.withheld.includes(column));
      expect(overlap, name).toEqual([]);
    }
    // Every disposition is used, so none of them is a label nothing can reach.
    expect(new Set(counts.keys())).toEqual(new Set(EXPORT_DISPOSITIONS));
  });

  it("travels into the pgTAP check verbatim", () => {
    const json = read(PLAN_JSON);
    const sql = read(PLAN_TEST);
    // A stale copy fails here; `pnpm exec tsx scripts/export-member-plan.ts` rewrites it.
    expect(sql.slice(sql.indexOf(BEGIN), sql.indexOf(END) + END.length), "run scripts/export-member-plan.ts")
      .toBe(planBlock(json));
    expect(withPlanBlock(sql, json)).toBe(sql);
    expect(() => planBlock(json.replace("export-member-plan-v1", "$plan$"))).toThrow();
  });

  it("keeps every credential the brief names out of the export", () => {
    for (const name of ["public.llm_keys", "public.llm_settings", "public.copilot_context_tokens"]) {
      expect(exportMemberPlan.tables[name]?.disposition, name).toBe("excluded-credential");
    }
    const nonceOrSession = Object.entries(exportMemberPlan.tables).filter(([name]) => /nonce|session/.test(name));
    expect(nonceOrSession.length).toBeGreaterThanOrEqual(13);
    for (const [name, entry] of nonceOrSession) expect(entry.disposition, name).toBe("excluded-credential");
  });

  it("names the redactions the export relies on as withheld", () => {
    expect(exportedTable("public.consent_signatures")!.withheld).toContain("signing_name_encrypted");
    expect(exportedTable("public.subjects")!.withheld).toEqual(expect.arrayContaining(["owner_account_id", "cohort_id"]));
    expect(exportedTable("public.genome_files")!.withheld).toEqual(expect.arrayContaining(["bucket_path", "storage_object_id"]));
    expect(exportedTable("public.chat_messages")!.withheld)
      .toEqual(expect.arrayContaining(["canonical_projection", "authorization_fingerprint", "contributor_ids"]));
  });

  it("exports the legal audit ledger's own events, never the pseudonym or the chain hashes", () => {
    const ledger = exportedTable("public.legal_audit_log")!;
    expect(ledger.members).toEqual(["archive:legal-audit.json", "reader:history.legal-audit",
      "archive:subjects/{subject_id}/audit-log.json", "archive:subjects/{subject_id}/reports.txt", "reader:claimant.legal-audit"]);
    expect(ledger.scope).toContain("private.future_person_audit_selector_v1");
    expect(ledger.scope).toContain("Existing NULL or unlinked actors remain unassigned");
    expect(ledger.withheld).toEqual(["audit_principal_id", "previous_hash", "row_hash"]);
    expect(ledger.reason).toContain("docs/export-legal-audit-resolver.md");
    // The account-to-pseudonym link selects the slice and never leaves.
    expect(exportMemberPlan.tables["private.legal_audit_account_principals"]?.disposition).toBe("excluded-internal");
  });
});

describe("the asynchronous history reader against the plan", () => {
  const sql = latestDefinition("public.export_archive_content_v1");
  const kinds = /p_payload->>'kind' not in \(([^)]*)\)/.exec(sql)![1].split(",").map((kind) => kind.trim().replace(/'/g, ""));
  const planned = new Map(Object.entries(exportMemberPlan.tables).flatMap(([table, entry]) =>
    "members" in entry ? (entry.members ?? []).filter((name) => name.startsWith("reader:history."))
      .map((name) => [name.slice("reader:history.".length), table] as const) : []));
  const section = sql.slice(sql.indexOf("if history_kind='legacy-consents' then"), sql.indexOf("-- A full page says whether more follow"));
  const branches = new Map([...section.matchAll(/(?:if|elsif) history_kind='([a-z-]+)' then([\s\S]*?)(?=\n\s*(?:elsif|else)\b)/g)]
    .map((match) => [match[1], match[2]]));
  // The one class without an explicit branch is the final else.
  const rest = kinds.filter((kind) => !branches.has(kind));
  branches.set(rest[0], section.slice(section.lastIndexOf("\n  else\n")));

  it("has exactly the classes the plan names, each mapped to one table", () => {
    expect(new Set(kinds)).toEqual(new Set(planned.keys()));
    expect(rest).toHaveLength(1);
    expect(new Set(branches.keys())).toEqual(new Set(kinds));
  });

  it("reads only exported columns, under their own names, for every class", () => {
    for (const [kind, body] of branches) {
      const table = planned.get(kind)!;
      const from = new RegExp(`from ${table.replace(".", "\\.")} ([a-z]+)\\b`).exec(body);
      expect(from, `${kind} reads ${table}`).not.toBeNull();
      const alias = from![1];
      const args = buildObjectArguments(body);
      const entry = exportedTable(table)!;
      const read = columnsRead(args, alias);
      expect(read.length, kind).toBe(args.length / 2);
      for (const column of read) {
        expect(entry.columns, `${kind}: ${table}.${column}`).toContain(column);
        expect(entry.withheld, `${kind}: ${table}.${column}`).not.toContain(column);
      }
      // Keys are the column names, so no withheld value leaves under another name.
      expect(args.filter((_, index) => index % 2 === 0).map((key) => key.replace(/'/g, "")), kind).toEqual(read);
    }
  });

  it("returns only the exported columns of a chat and its messages", () => {
    const chats = sql.slice(sql.indexOf("if p_operation='chats' then"));
    for (const column of columnsRead(buildObjectArguments(chats), "ch")) {
      expect(exportedTable("public.chats")!.columns, `chats.${column}`).toContain(column);
    }
    const helper = latestDefinition("private.export_archive_chat_messages_v1");
    const messages = helper.slice(helper.indexOf("select m.id,m.turn_ordinal,m.role,jsonb_build_object("));
    const read = columnsRead(buildObjectArguments(messages), "m");
    expect(read).toEqual(["id", "role", "content", "canonical_citations", "created_at"]);
    for (const column of read) expect(exportedTable("public.chat_messages")!.columns, column).toContain(column);
  });
});
