import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Re-download of an original upload via a short-lived signed URL.
// RLS-scoped row read proves ownership; the signed URL is created with the
// service role only after the RLS-scoped file read proves ownership.
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/files/[id]/download">,
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: file } = await supabase
    .from("genome_files")
    .select("bucket_path, original_name")
    .eq("id", id)
    .maybeSingle();
  if (!file) return new Response("Not found", { status: 404 });

  const { data, error } = await createAdminClient().storage
    .from("genomes")
    .createSignedUrl(file.bucket_path, 300, {
      download: file.original_name,
    });
  if (error || !data) {
    return new Response("Could not sign URL", { status: 500 });
  }
  return NextResponse.redirect(data.signedUrl);
}
