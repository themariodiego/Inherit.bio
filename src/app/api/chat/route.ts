import { ownChatResponse } from "@/lib/copilot/own-chat-route";
import { familyChatResponse, isFamilyChatRequest } from "@/lib/copilot/family-chat-route";
import { cohortChatResponse, isCohortChatRequest } from "@/lib/copilot/cohort-chat-route";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { NextResponse } from "next/server";
import type { RefusalId } from "@/copy/copilot/refusals";
import { OWN_SYSTEM_PROMPT } from "@/copy/copilot/system-prompts";
import { createClient } from "@/lib/supabase/server";
import { withAccountCsrf } from "@/lib/security/session-csrf";

export const maxDuration = 300;

/**
 * The refusal as the whole assistant turn on the same stream transport the
 * client reads, with the refusal id in a header for machine readers. No
 * model is involved and nothing about the user is carried.
 */
function refusalResponse(id: RefusalId, text: string): Response {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      writer.write({ type: "start" });
      writer.write({ type: "text-start", id: "refusal" });
      writer.write({ type: "text-delta", id: "refusal", delta: text });
      writer.write({ type: "text-end", id: "refusal" });
      writer.write({ type: "finish" });
    },
  });
  return createUIMessageStreamResponse({
    stream,
    headers: { "x-copilot-refusal": id },
  });
}

/**
 * `POST /api/chat` (register `api.chat`, `chat-scope-v1`, `scope-derived-v1`).
 * Every body is one of the register's two closed shapes, `{ contextToken,
 * message }` for a new conversation or `{ chatId, message }` for a turn in a
 * server-held one, and its scope comes only from the token or the database
 * chat row. Three canonical scopes answer: the Family group, the embryo
 * cohort and the person's own subject. Each keeps its conversation on the
 * server, spends its context token once and rechecks its authority before
 * every read and the model call.
 *
 * Since 24 October 2026 (G8.5) there is no compatibility branch. It answered
 * `/copilot/[scope]`'s other subjects, and self subjects with no canonical
 * upload consent, under provider-key consent, with no conversation and a
 * reusable token. Its token, the register's `{ contextToken, message }` under
 * the `copilot-compat-context-v1` MAC, now reads as no token of any scope and
 * gets the same resource-not-found-v1 as a forged one; no page mints it.
 * Which subjects a page can open a conversation for is decided before any
 * token is minted (src/lib/copilot/subject-scope.ts).
 */
export const POST = withAccountCsrf("api.chat", handlePost);
async function handlePost(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const raw: unknown = await request.json().catch(() => null);
  if (raw && typeof raw === "object" && ("contextToken" in raw || "chatId" in raw || "message" in raw)) {
    // The Family group scope has its own token domain and chat rows; the
    // own scope never reads either, and the two answer the same closed shape.
    if (await isFamilyChatRequest(raw)) return familyChatResponse(request, raw, { refusal: refusalResponse });
    if (await isCohortChatRequest(raw)) return cohortChatResponse(request, raw, { refusal: refusalResponse });
    return ownChatResponse(request, raw, { systemPrompt: OWN_SYSTEM_PROMPT, refusal: refusalResponse });
  }
  // Every registered body names a context token or a chat. The AI SDK
  // transport body the compatibility panel sent until 23 October 2026 is
  // refused like any other unregistered body.
  return NextResponse.json({ error: "invalid_request" }, { status: 400 });
}
