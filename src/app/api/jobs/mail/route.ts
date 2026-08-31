import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

export async function POST(request: Request) {
  const secret = process.env.JOBS_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const url = new URL(request.url);
  if (
    url.search.length > 0 ||
    request.headers.has("transfer-encoding") ||
    Number(request.headers.get("content-length") ?? "0") > 0
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { count, error } = await createAdminClient()
    .from("mail_outbox")
    .select("id", { count: "exact", head: true })
    .eq("state", "queued")
    .lte("not_before", now)
    .gt("expires_at", now);
  if (error) {
    return NextResponse.json({ error: "worker_unavailable" }, { status: 503 });
  }
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error: "worker_unavailable",
        message: "Queued mail requires the atomic delivery worker before provider submission.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ processed: 0, failed: 0, pending: 0 });
}
