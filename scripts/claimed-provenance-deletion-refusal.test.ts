import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import patches from "../docs/claimed-provenance-body-patches.json";
import pins from "../docs/claimed-provenance-function-pins.json";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const md5 = (value: string) => createHash("md5").update(value).digest("hex");

it("preserves the complete deletion producer except the exact shared-pair refusal boundary", () => {
  const patch = patches.find(value => value.name === "private.prepare_future_person_deletion_v1")!;
  const source = read(`supabase/migrations/${patch.source}`);
  const match = source.match(/create (?:or replace )?function private\.prepare_future_person_deletion_v1\([^)]*\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/u);
  expect(match).not.toBeNull();
  let body = match![1]!;
  expect(md5(body)).toBe("825d2bb042623900b71bfc516f9e8b42");
  for (const [anchor, replacement] of patch.replacements) {
    expect(body.split(anchor!)).toHaveLength(2);
    body = body.replace(anchor!, replacement!);
  }
  const beginning = " begin\n env:=jsonb_build_object('version','future-person-deletion-plan-v1','subjectId',s.id,";
  const ending = "\n exception when sqlstate '42501' then\n  if sqlerrm is distinct from 'claimed provenance unavailable' then raise;end if;\n  raise exception using errcode='42501',message='claimant deletion unavailable';\n end;";
  expect(body.split(beginning)).toHaveLength(2);
  expect(body.split(ending)).toHaveLength(2);
  expect(body).toContain("'sharedProvenance',private.claimed_provenance_candidate_v1(x.file_id));" + ending);
  expect(md5(body.replace(beginning, beginning.slice(" begin\n".length)).replace(ending, "")))
    .toBe("f32e9ce755719d34ad802f975ff223ea");
  expect(md5(body)).toBe("d059d03088936f868ce748772073f5db");
  expect(patch.after).toBe(md5(body));
  expect(pins.find(value => value.signature === patch.signature)?.body).toBe(md5(body));
});
