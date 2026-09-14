import { NextResponse } from "next/server";
import { z } from "zod";
import { getSensitiveAccountContext, isSameOrigin } from "@/lib/account-deletion";
import { CHROMOSOMAL_SEX_VALUES } from "@/lib/family/chromosomal-sex";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * `POST /api/chromosomal-sex` (register api.chromosomal-sex) — the one writer
 * for `subject_demographics.chromosomal_sex` (D-031).
 *
 * The value is DECLARED. Nothing here reads a file, and no other route writes
 * the column: `declare_chromosomal_sex_v1` is the only writer and it accepts
 * only a subject the acting account IS, never one it merely holds. An
 * uploader who controls another adult's record cannot declare that adult's
 * chromosomal sex from here or anywhere else.
 *
 * `chromosomalSex: null` withdraws the declaration. It is the same call, not a
 * separate privilege, so withdrawal can never be the half that was not built:
 * the browser proof exercises the round trip.
 *
 * The response carries the value the row now holds, its revision and when it
 * changed, and nothing else — no account id, no subject class, no other
 * person. The 404 for an unauthorised subject is identical to the 404 for one
 * that does not exist, so a caller learns nothing by guessing.
 */

const body = z
  .object({
    subjectId: z.uuid(),
    chromosomalSex: z.enum(CHROMOSOMAL_SEX_VALUES).nullable(),
  })
  .strict();

const NO_STORE = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
} as const;

/**
 * Strict, because the register's response contract forbids unknown fields
 * recursively. A function that started returning an account id would fail
 * here rather than have the field quietly stripped, which is the difference
 * between a contract and a habit.
 */
const declaration = z
  .object({
    chromosomalSex: z.enum(CHROMOSOMAL_SEX_VALUES).nullable(),
    revision: z.number(),
    updatedAt: z.string().nullable(),
    action: z.enum(["declared", "replaced", "withdrawn", "unchanged"]),
  })
  .strict();

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const context = await getSensitiveAccountContext();
  if (!context) return new Response("Unauthorized", { status: 401 });

  const { data, error } = await createAdminClient().rpc("declare_chromosomal_sex_v1", {
    p_account_id: context.user.id,
    p_subject_id: parsed.data.subjectId,
    p_chromosomal_sex: parsed.data.chromosomalSex,
  });
  if (error) return new Response("Not found", { status: 404 });
  // The route states what it returns rather than forwarding whatever the
  // function produced, so a later change to the function cannot widen the
  // response without this schema failing first.
  const result = declaration.safeParse(data);
  if (!result.success) return new Response("Not found", { status: 404 });
  return NextResponse.json(result.data, { headers: NO_STORE });
}
