// Transactional email via Resend. Self-contained (inline HTML in the
// Sequence brand) so it has no template-file dependencies. Both senders
// no-op with a console note when RESEND_API_KEY is unset, so self-hosting
// without email configured never crashes. Recipient genotype data is never
// logged and never included: the digest carries only public report info.
import { Resend } from "resend";

const BRAND = {
  paper: "#F7F8F1",
  ink: "#14201B",
  inkMuted: "#4C5A52",
  forest: "#2E5C45",
};

function shell(title: string, bodyHtml: string, unsubscribe?: string): string {
  return `<!doctype html><html><body style="margin:0;background:${BRAND.paper};font-family:Inter,Arial,sans-serif;color:${BRAND.ink};padding:24px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px">
      <tr><td style="padding-bottom:16px">
        <span style="font-family:Georgia,serif;font-size:22px;letter-spacing:-0.5px">Se<span style="color:${BRAND.forest}">quence</span></span>
      </td></tr>
      <tr><td style="background:#fff;border:1px solid #DDE2D3;border-radius:16px;padding:24px">
        <h1 style="font-family:Georgia,serif;font-weight:400;font-size:22px;margin:0 0 12px">${title}</h1>
        ${bodyHtml}
      </td></tr>
      <tr><td style="padding-top:16px;font-size:12px;color:${BRAND.inkMuted};line-height:1.5">
        <p style="margin:0 0 4px">Sequence · an open-source project in collaboration with Plus Bio</p>
        <p style="margin:0 0 4px">Informational, not medical advice.</p>
        ${unsubscribe ? `<p style="margin:0"><a href="${unsubscribe}" style="color:${BRAND.inkMuted}">Manage email preferences</a></p>` : ""}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:${BRAND.forest};color:${BRAND.paper};text-decoration:none;padding:10px 20px;border-radius:9999px;font-size:14px;margin-top:12px">${label}</a>`;
}

function client(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

function from(): string {
  return process.env.EMAIL_FROM ?? "Sequence <onboarding@resend.dev>";
}

export function reportReadyHtml(props: {
  fileName: string;
  reportCount: number;
  dashboardUrl: string;
}): string {
  return shell(
    "Your reports are ready",
    `<p style="font-size:14px;line-height:1.6;color:${BRAND.inkMuted};margin:0">
      We finished processing <strong style="color:${BRAND.ink}">${props.fileName}</strong>.
      ${props.reportCount} report${props.reportCount === 1 ? "" : "s"} are available, each with your genotype-specific
      result where your file covers it — and an honest "not covered" note where it doesn't.</p>
     ${button(props.dashboardUrl, "View your reports")}`,
  );
}

export function researchDigestHtml(props: {
  entries: { title: string; summary: string; url: string }[];
  manageUrl: string;
}): string {
  const items = props.entries
    .map(
      (e) =>
        `<div style="padding:12px 0;border-top:1px solid #DDE2D3">
          <a href="${e.url}" style="color:${BRAND.forest};text-decoration:none;font-size:15px;font-weight:600">${e.title}</a>
          <p style="font-size:13px;line-height:1.5;color:${BRAND.inkMuted};margin:4px 0 0">${e.summary}</p>
        </div>`,
    )
    .join("");
  return shell(
    "New in the Sequence research library",
    `<p style="font-size:14px;line-height:1.6;color:${BRAND.inkMuted};margin:0 0 8px">
      New report${props.entries.length === 1 ? "" : "s"} published from our research pipeline:</p>
     ${items}`,
    props.manageUrl,
  );
}

export async function sendReportReady(
  to: string,
  props: { fileName: string; reportCount: number; dashboardUrl: string },
): Promise<boolean> {
  const resend = client();
  if (!resend) {
    console.warn("[email] RESEND_API_KEY unset; skipping report-ready email");
    return false;
  }
  const { error } = await resend.emails.send({
    from: from(),
    to,
    subject: "Your Sequence reports are ready",
    html: reportReadyHtml(props),
  });
  if (error) console.error("[email] report-ready send failed:", error.message);
  return !error;
}

export async function sendResearchDigest(
  to: string,
  props: {
    entries: { title: string; summary: string; url: string }[];
    manageUrl: string;
  },
): Promise<boolean> {
  const resend = client();
  if (!resend) {
    console.warn("[email] RESEND_API_KEY unset; skipping research digest");
    return false;
  }
  const { error } = await resend.emails.send({
    from: from(),
    to,
    subject: "New reports in the Sequence research library",
    html: researchDigestHtml(props),
  });
  if (error) console.error("[email] digest send failed:", error.message);
  return !error;
}
