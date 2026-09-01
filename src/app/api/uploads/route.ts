import { NextResponse } from "next/server";
import { z } from "zod";
import { LIMITS } from "@/lib/limits";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const fileTypes = [
  "array_23andme",
  "array_ancestry",
  "array_myheritage",
  "array_ftdna",
  "vcf",
  "gvcf",
  "bam",
  "cram",
] as const;

const requestSchema = z.object({
  originalName: z.string().trim().min(1).max(255),
  fileType: z.enum(fileTypes),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  contentType: z.enum([
    "text/plain",
    "text/tab-separated-values",
    "application/gzip",
    "application/octet-stream",
  ]),
});

function tierAndCap(fileType: (typeof fileTypes)[number]) {
  if (fileType === "bam" || fileType === "cram") {
    return { tier: 2 as const, cap: LIMITS.bamMaxBytes };
  }
  if (fileType === "vcf" || fileType === "gvcf") {
    return { tier: 1 as const, cap: LIMITS.vcfMaxBytes };
  }
  return { tier: 1 as const, cap: LIMITS.arrayMaxBytes };
}

export async function POST(request: Request) {
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

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { tier, cap } = tierAndCap(parsed.data.fileType);
  if (parsed.data.sizeBytes > cap) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }

  const admin = createAdminClient();
  const { data: subject } = await admin
    .from("subjects")
    .select("id")
    .eq("subject_account_id", user.id)
    .eq("subject_class", "self")
    .in("lifecycle", ["active", "claimed_bound"])
    .maybeSingle();
  if (!subject) {
    return NextResponse.json({ error: "subject_unavailable" }, { status: 409 });
  }

  const objectName = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { data: upload, error } = await admin
    .from("upload_sessions")
    .insert({
      account_id: user.id,
      auth_session_id: sessionId,
      subject_id: subject.id,
      staging_object_name: objectName,
      expected_size: parsed.data.sizeBytes,
      expected_sha256: parsed.data.sha256,
      content_type: parsed.data.contentType,
      upload_revision: 1,
      status: "issued",
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error || !upload) {
    return NextResponse.json({ error: "upload_unavailable" }, { status: 503 });
  }

  return NextResponse.json({
    uploadId: upload.id,
    bucketName: "genomes-staging",
    objectName,
    expiresAt,
    tier,
  });
}
