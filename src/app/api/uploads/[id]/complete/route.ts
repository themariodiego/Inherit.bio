import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.string().uuid();
const requestSchema = z.object({
  originalName: z.string().trim().min(1).max(255),
  fileType: z.enum([
    "array_23andme",
    "array_ancestry",
    "array_myheritage",
    "array_ftdna",
    "vcf",
    "gvcf",
    "bam",
    "cram",
  ]),
  tier: z.union([z.literal(1), z.literal(2)]),
});

async function exactObject(
  admin: ReturnType<typeof createAdminClient>,
  bucket: string,
  name: string,
) {
  const { data, error } = await admin.storage
    .from(bucket)
    .list("", { limit: 10, search: name });
  if (error) return null;
  return data.find((item) => item.name === name) ?? null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const supabase = await createClient();
  const [{ data: userData }, { data: claimsData }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getClaims(),
  ]);
  const user = userData.user;
  const sessionId = claimsData?.claims.session_id;
  if (!user || typeof sessionId !== "string") {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = createAdminClient();
  const { data: upload } = await admin
    .from("upload_sessions")
    .select("account_id, auth_session_id, staging_object_name, expected_size, status, expires_at")
    .eq("id", id)
    .maybeSingle();
  if (
    !upload ||
    upload.account_id !== user.id ||
    upload.auth_session_id !== sessionId ||
    upload.status !== "issued" ||
    new Date(upload.expires_at).getTime() <= Date.now()
  ) {
    return NextResponse.json({ error: "upload_unavailable" }, { status: 409 });
  }

  let object = await exactObject(admin, "genomes-staging", upload.staging_object_name);
  const alreadyPromoted = !object;
  if (!object) {
    object = await exactObject(admin, "genomes", upload.staging_object_name);
  }
  const byteCount = Number(object?.metadata?.size ?? 0);
  if (!object || byteCount !== upload.expected_size) {
    return NextResponse.json({ error: "upload_incomplete" }, { status: 409 });
  }

  if (!alreadyPromoted) {
    const { error: moveError } = await admin.storage
      .from("genomes-staging")
      .move(upload.staging_object_name, upload.staging_object_name, {
        destinationBucket: "genomes",
      });
    if (moveError) {
      return NextResponse.json({ error: "promotion_failed" }, { status: 503 });
    }
    object = await exactObject(admin, "genomes", upload.staging_object_name);
  }
  if (!object?.id) {
    return NextResponse.json({ error: "promotion_failed" }, { status: 503 });
  }

  const { data: fileId, error } = await admin.rpc("complete_upload_session", {
    p_upload_session_id: id,
    p_account_id: user.id,
    p_auth_session_id: sessionId,
    p_storage_object_id: object.id,
    p_original_name: parsed.data.originalName,
    p_file_type: parsed.data.fileType,
    p_tier: parsed.data.tier,
  });
  if (error || !fileId) {
    return NextResponse.json({ error: "registration_failed" }, { status: 503 });
  }

  return NextResponse.json({ fileId });
}
