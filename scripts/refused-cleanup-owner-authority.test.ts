import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const dir = path.join(root, "supabase/migrations");
const migration = readFileSync(path.join(dir, "20261001032000_refused_cleanup_owner_authority.sql"), "utf8");
const targets = [
  {
    "signature": "public.claim_refused_invitation_draft_purge_v1(text)",
    "body_md5": "eb80f8424c3d83bbccdc90035cd24b34",
    "source": "20260906064136_refused_evidence_write_fence.sql",
    "service_door": true
  },
  {
    "signature": "public.authorize_refused_invitation_storage_v1(uuid,text,bigint[])",
    "body_md5": "7c6b39f23efbc248af08b157a9362dee",
    "source": "20260906064136_refused_evidence_write_fence.sql",
    "service_door": true
  },
  {
    "signature": "public.complete_refused_invitation_storage_v1(uuid,text,bigint[])",
    "body_md5": "3ad1c3f784d13336f8a95448cd13b99b",
    "source": "20260906055142_refused_invitation_draft_cleanup.sql",
    "service_door": true
  },
  {
    "signature": "public.finish_refused_invitation_draft_purge_v1(uuid,text)",
    "body_md5": "b6bc8b84951f70ade7c6968e510a54e2",
    "source": "20260906055142_refused_invitation_draft_cleanup.sql",
    "service_door": true
  },
  {
    "signature": "public.fail_refused_invitation_draft_purge_v1(uuid,text)",
    "body_md5": "6ff72ac54047851920c711af4676bb51",
    "source": "20260906055142_refused_invitation_draft_cleanup.sql",
    "service_door": true
  },
  {
    "signature": "private.refused_draft_evidence_objects_v1(text,uuid)",
    "body_md5": "b1e8bdcd1ee36a42602df5f86797cc99",
    "source": "20260906055142_refused_invitation_draft_cleanup.sql",
    "service_door": false
  },
  {
    "signature": "private.assert_refused_draft_v1(public.retention_due_phases)",
    "body_md5": "5a0546f919d8e6e48dbe1b1ae1d8d53e",
    "source": "20260906055142_refused_invitation_draft_cleanup.sql",
    "service_door": false
  },
  {
    "signature": "private.lock_refused_draft_purge_v1(uuid,text)",
    "body_md5": "d66a80c100c4d00cd6921a852341e8d7",
    "source": "20260906064136_refused_evidence_write_fence.sql",
    "service_door": false
  },
  {
    "signature": "private.assert_refused_evidence_exclusive_v1(text,uuid)",
    "body_md5": "01e11f088ba411e9ad9ebb2b672e3627",
    "source": "20260906064136_refused_evidence_write_fence.sql",
    "service_door": false
  }
] as const;

describe("exact owner-defined refusal cleanup boundary", () => {
  for (const target of targets) it(`preserves the full current ${target.signature} body`, () => {
    const name = target.signature.split("(")[0]!;
    const pattern = new RegExp(`create (?:or replace )?function ${name.replaceAll(".", "\\.")}\\([^;]*?\\bas\\s+(\\$[a-z_]*\\$)([\\s\\S]*?)\\1;`, "iu");
    const definitions = readdirSync(dir).sort().flatMap(file => {
      const match = readFileSync(path.join(dir, file), "utf8").match(pattern);
      return match ? [{ file, body: match[2]! }] : [];
    });
    expect(definitions.at(-1)?.file).toBe(target.source);
    expect(createHash("md5").update(definitions.at(-1)!.body).digest("hex")).toBe(target.body_md5);
    expect(migration).toContain(`'${target.signature}','${target.body_md5}'`);
  });
  it("changes only catalog authority and the original single service maintenance tuple", () => {
    expect(migration.match(/grant truncate on public\.user_variants to service_role/gu)).toHaveLength(1);
    expect(migration).not.toMatch(/grant select|grant all|create (?:or replace )?function|disable trigger|drop trigger/iu);
    expect(migration).toContain("proacl is not distinct from before_acl");
    expect(migration).toContain("alter function %s security definer");
    expect(migration).toContain("revoke all on function %s from public,anon,authenticated,inherit_upload_only,service_role");
    expect(migration).toContain("t.tgname='export_variant_content_truncate'");
    expect(migration.match(/^do \$cleanup\$/gmu)).toHaveLength(1);
    expect(migration.match(/^\$cleanup\$;/gmu)).toHaveLength(1);
  });
});
