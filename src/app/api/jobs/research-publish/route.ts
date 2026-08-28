import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendResearchDigest } from "@/lib/email";

export const maxDuration = 300;

// Publishes a reviewed template draft: status -> published, changelog entry,
// opt-in digest email via Resend. Operator-authorized via JOBS_SECRET.
export async function POST(request: Request) {
  const secret = process.env.JOBS_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { slug } = (await request.json().catch(() => ({}))) as {
    slug?: string;
  };
  if (!slug) return new Response("Missing slug", { status: 400 });

  const admin = createAdminClient();

  const { data: template } = await admin
    .from("report_templates")
    .select("slug, title, summary, category, status")
    .eq("slug", slug)
    .maybeSingle();
  if (!template) return new Response("Unknown template", { status: 404 });
  if (template.status === "published") {
    return NextResponse.json({ published: false, reason: "already published" });
  }

  const now = new Date().toISOString();
  const { error: updateError } = await admin
    .from("report_templates")
    .update({ status: "published", published_at: now, updated_at: now })
    .eq("slug", slug);
  if (updateError) {
    return new Response(`Publish failed: ${updateError.message}`, {
      status: 500,
    });
  }

  await admin.from("changelog_entries").insert({
    title: `New report: ${template.title}`,
    body: template.summary,
    template_slug: template.slug,
  });

  // Digest to opted-in users.
  const { data: optIns } = await admin
    .from("profiles")
    .select("id")
    .eq("digest_opt_in", true);
  let sent = 0;
  if (optIns && optIns.length > 0) {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    for (const p of optIns) {
      const { data: userData } = await admin.auth.admin.getUserById(p.id);
      const email = userData?.user?.email;
      if (!email) continue;
      const ok = await sendResearchDigest(email, {
        entries: [
          {
            title: template.title,
            summary: template.summary,
            url: `${siteUrl}/reports/${template.slug}`,
          },
        ],
        manageUrl: `${siteUrl}/settings`,
      });
      if (ok) sent++;
    }
  }

  return NextResponse.json({ published: true, slug, digest_sent: sent });
}
