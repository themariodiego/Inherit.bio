import { createHash, timingSafeEqual } from "node:crypto";
import { POST as runRetention } from "@/app/api/jobs/retention/route";

export const maxDuration = 300;

/** Cron transport only: the existing POST owns every due-work decision. */
export async function GET(request: Request) {
  // Next automatically routes HEAD through GET unless explicitly refused.
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { Allow: "GET" } });
  }
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization || !timingSafeEqual(
    createHash("sha256").update(authorization).digest(),
    createHash("sha256").update(`Bearer ${secret}`).digest(),
  )) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const contentLength = request.headers.get("content-length");
  if (url.search || url.hash || request.body !== null
    || request.headers.has("transfer-encoding")
    || (contentLength !== null && contentLength !== "0")) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  try {
    return await runRetention(new Request(new URL("/api/jobs/retention", url), {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    }));
  } catch {
    return Response.json({ error: "retention_worker_unavailable" }, { status: 503 });
  }
}
