import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import pins from "../docs/claimed-provenance-function-pins.json";

const migration = readFileSync(new URL("../supabase/migrations/20261001036000_claimed_provenance_last_consumer.sql", import.meta.url), "utf8");
const md5 = (value: string) => createHash("md5").update(value).digest("hex");
const legacy = `  if not exists(select 1 from private.embryo_canonical_source_parts m join private.embryo_canonical_sources x on x.file_id=m.file_id
    where m.part_id=p.id and m.sequence=p.sequence and x.session_id=s.id and x.worker_job_id=j.id
     and x.attempt=j.attempt and x.sample_ordinal=p.sample_ordinal) then`;
const corrected = `  if not exists(select 1 from private.embryo_canonical_source_parts m join private.embryo_canonical_sources stored_source on stored_source.file_id=m.file_id
    where m.part_id=p.id and m.sequence=p.sequence and stored_source.session_id=s.id and stored_source.worker_job_id=j.id
     and stored_source.attempt=j.attempt and stored_source.sample_ordinal=p.sample_ordinal) then`;

it("preserves the complete provenance algorithm when only the conflicting table alias is reversed", () => {
  const match = migration.match(/create function private\.claimed_provenance_pair_state_v1\(p_candidate jsonb\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/u);
  expect(match).not.toBeNull();
  const body = match![1]!;
  expect(body.split(corrected)).toHaveLength(2);
  expect(body).not.toContain(legacy);
  expect(md5(body.replace(corrected, legacy))).toBe("3da68cf25c64e8e579a8d5ef17cd90a6");
  expect(md5(body)).toBe("e07c75378ae8d1c14839e604fc2dd58a");
  expect(migration).toContain("md5(p.prosrc)='e07c75378ae8d1c14839e604fc2dd58a'");
  expect(pins.find(pin => pin.signature === "private.claimed_provenance_pair_state_v1(jsonb)")?.body)
    .toBe("e07c75378ae8d1c14839e604fc2dd58a");
});
