import { notFound } from "@/lib/embryos/api";
import { closedResponse } from "@/lib/embryos/guards";
import { invitationRefusalBody, readInvitationRefusal, refusalRequestAllowed } from "@/lib/embryos/invitation-refusal";
import { createAdminClient } from "@/lib/supabase/admin";

/** The accountless rights holder declines; no login or jurisdiction gate. */
export async function POST(request: Request) {
  if (!refusalRequestAllowed(request) || !request.body) return notFound();
  const reader = request.body.getReader();
  let size = 0;
  let text = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4_096) { await reader.cancel(); return notFound(); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch { return notFound(); }
  let json: unknown;
  try { json = JSON.parse(text); } catch { return notFound(); }
  const body = invitationRefusalBody.safeParse(json);
  if (!body.success) return notFound();
  const authority = readInvitationRefusal(request, body.data.nonce);
  if (!authority) return notFound();
  const { error } = await createAdminClient().rpc("refuse_co_parent_invitation_session_v1", {
    p_session_hash: authority.sessionHash, p_nonce: authority.nonce,
  });
  if (error) return notFound();
  return closedResponse("api.withdraw", ["status", "operation"],
    { status: "accepted", operation: "refuse" }, 202);
}
