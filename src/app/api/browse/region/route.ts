import { NextResponse } from "next/server";
import { chromToNumber } from "@/lib/genome/types";
import { createClient } from "@/lib/supabase/server";

// User variants within a genomic region, for the embedded genome browser.
// RLS-scoped; serves only the requesting user's own data.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const fileId = url.searchParams.get("file");
  const chromRaw = url.searchParams.get("chrom") ?? "";
  const start = Number(url.searchParams.get("start"));
  const end = Number(url.searchParams.get("end"));
  const chrom = chromToNumber(chromRaw);
  if (!fileId || !chrom || !Number.isFinite(start) || !Number.isFinite(end)) {
    return new Response("Bad request", { status: 400 });
  }
  if (end - start > 10_000_000) {
    return new Response("Region too large (max 10 Mb)", { status: 400 });
  }

  const { data, error } = await supabase
    .from("user_variants")
    .select("rsid, chrom, pos, ref, alt, genotype")
    .eq("file_id", fileId)
    .eq("chrom", chrom)
    .gte("pos", Math.max(1, Math.floor(start)))
    .lte("pos", Math.ceil(end))
    .order("pos")
    .limit(5000);
  if (error) return new Response(error.message, { status: 500 });

  return NextResponse.json({ variants: data ?? [], truncated: (data ?? []).length === 5000 });
}
