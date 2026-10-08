import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChatPanel, type ChatProviderInfo } from "@/components/chat/chat-panel";
import { OwnChatPanel } from "@/components/chat/own-chat-panel";
import { CohortCopilotPage, FamilyCopilotPage } from "@/components/chat/group-scope-pages";
import { Breadcrumbs } from "@/components/site/breadcrumbs";
import { EmptyState } from "@/components/site/empty-state";
import { Button } from "@/components/ui/button";
import { NAV_LABELS } from "@/copy/navigation";
import { parseCopilotRouteScope } from "@/lib/copilot/group-scopes";
import { prepareOwnCopilotChat } from "@/lib/copilot/own-chat";
import { isLocalBaseUrl, providerKeyFor } from "@/lib/llm";
import { resolveSubjectForAccount } from "@/lib/subjects";
import { createClient } from "@/lib/supabase/server";
import { route } from "@/lib/primary-routes";

export const metadata: Metadata = { title: "Copilot" };

const EXAMPLE_QUESTIONS = [
  "What does my caffeine result mean?",
  "Do I carry the alcohol flush variant?",
  "Which of my reports have the strongest evidence?",
];

export default async function ChatPage(
  props: PageProps<"/copilot/[scope]">,
) {
  const { scope } = await props.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();
  // copilot-route-scope-v1: the fixed literals first, then one prefix per
  // kind; anything else is the same non-enumerating 404.
  const routeScope = parseCopilotRouteScope(scope);
  if (!routeScope || routeScope.kind === "report") notFound();
  if (routeScope.kind === "family") return <FamilyCopilotPage />;
  if (routeScope.kind === "cohort") return <CohortCopilotPage accountId={user.id} cohortId={routeScope.id} />;
  const subject = await resolveSubjectForAccount(user.id, scope);
  if (!subject) notFound();
  const ownChat = subject.subjectClass === "self" ? await prepareOwnCopilotChat(subject.id) : null;
  // Crumbs say where this is (round-2 M8): the record, then the page by its
  // own h1, the way the record routes do.
  const title = `Ask about ${subject.displayLabel}`;
  const header = (
    <header className="rec-head">
      <Breadcrumbs
        items={[
          { label: NAV_LABELS["my-genome"], href: route("genome.subject", { subject: subject.routeSegment }) },
          { label: subject.displayLabel },
          { label: title },
        ]}
      />
      <h1 className="display">{title}</h1>
    </header>
  );
  if (ownChat?.kind === "ready") {
    return (
      <div className="page-stack rec-column stack-blocks">
        {header}
        <OwnChatPanel key={ownChat.contextHash} contextToken={ownChat.contextToken} info={ownChat.providerInfo}
          chats={ownChat.chats} displayLabel={subject.displayLabel} />
      </div>
    );
  }
  if (ownChat?.kind === "unavailable" && ownChat.reason !== "provider_unavailable") {
    if (ownChat.reason === "account_required" || ownChat.reason === "scope_unavailable") notFound();
    return (
      <div className="page-stack rec-column stack-blocks">
        {header}
        <div className="plate">
          <div className="plate-head">
            <p className="text-sm text-ink">{ownChat.reason === "consent_required"
              ? "Choose what Copilot may use before asking about your file. Saving a provider does not grant that permission."
              : "This deployment cannot use the selected model endpoint. Review the available options in Copilot settings."}</p>
          </div>
          <div className="plate-body">
            <Link href={route("settings.copilot")} className="link-target quiet-link text-sm">Review Copilot settings</Link>
          </div>
        </div>
      </div>
    );
  }
  // Only an explicitly legacy scope may use the compatibility UI. A missing
  // canonical provider never falls back to the old provider-key consent path.
  const { data: settings } = ownChat?.kind === "unavailable" ? { data: null } : await supabase
    .from("llm_settings")
    .select("provider, base_url, model")
    .maybeSingle();

  let info: ChatProviderInfo = { configured: false };
  if (settings) {
    const providerKey = providerKeyFor(
      settings.provider as "anthropic" | "openai_compatible",
      settings.base_url,
    );
    const local =
      settings.provider === "openai_compatible" &&
      settings.base_url != null &&
      isLocalBaseUrl(settings.base_url);
    const { data: grant } = await supabase
      .from("consent_grants")
      .select("id")
      .eq("provider_key", providerKey)
      .is("revoked_at", null)
      .maybeSingle();
    info = {
      configured: true,
      provider: settings.provider as "anthropic" | "openai_compatible",
      providerKey,
      model: settings.model,
      local,
      hasConsent: Boolean(grant),
    };
  }

  return (
    <div className="page-stack rec-column stack-blocks">
      {header}
      {!info.configured ? (
        // The empty state (round-1 m13): one inset surface with the sentence,
        // the example questions as quiet lines and "Open Settings" as the
        // page's one forest action; the setup notes follow as plain text,
        // and the settings page is linked once.
        <div data-testid="local-mode-instructions" className="stack-blocks text-sm">
          <EmptyState
            action={
              <Button asChild size="lg">
                <Link href={route("settings.copilot")}>Open Settings →</Link>
              </Button>
            }
          >
            <div className="rec-stack-sm">
              <p className="body-lg text-ink">
                Ask questions about your own reports in plain language —{" "}
                <em>&ldquo;What does my caffeine result mean?&rdquo;</em> — and
                get answers grounded in your data.
              </p>
              <ul aria-label="Example questions" className="rec-stack-sm mt-2">
                {EXAMPLE_QUESTIONS.map((q) => (
                  <li
                    key={q}
                    className="caption border-l-2 border-line-strong pl-3 italic"
                  >
                    &ldquo;{q}&rdquo;
                  </li>
                ))}
              </ul>
              <p className="caption">
                Questions like these become askable as soon as an AI is
                connected.
              </p>
            </div>
          </EmptyState>

          <div className="rec-stack max-w-measure">
            <p>
              To answer, the copilot needs an AI — Inherit doesn&rsquo;t
              bundle one, so you decide which AI (if any) ever sees your
              questions. <strong>Connecting an AI is a one-time technical
              step.</strong>
            </p>

            <div className="rec-stack-sm">
              <h2 className="title">Easiest: use an AI service</h2>
              <ol className="max-w-measure list-decimal space-y-2 pl-5">
                <li>
                  Create an Anthropic API key at{" "}
                  <a
                    href="https://console.anthropic.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="prose-link"
                  >
                    console.anthropic.com
                  </a>
                  .
                </li>
                <li>
                  Paste it in <span className="font-medium">Settings → Copilot provider</span>{" "}
                  and save. Then review and allow the information Copilot may use.
                </li>
              </ol>
              <p className="max-w-measure text-ink-muted">
                An API key is like a password. It lets Inherit send{" "}
                <strong>your</strong> questions to the AI service you chose. We
                ask for your explicit permission before using your data. The
                permission names the provider and the information it may receive.
                It remains in effect until it ends or you withdraw it. Changing
                the provider, model or key requires a new permission. Your AI
                provider sets its own charges.
              </p>
            </div>

            <details className="surface-inset px-4 pb-1 text-ink">
              <summary className="font-medium">
                Advanced: run an AI beside your own Inherit server
              </summary>
              <p className="mt-1 max-w-measure pb-3 leading-relaxed">
                On a configured self-hosted development installation, run{" "}
                <a
                  href="https://ollama.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="prose-link"
                >
                  Ollama
                </a>{" "}
                or LM Studio on the same machine as Inherit. Then choose
                &ldquo;OpenAI-compatible&rdquo; in Settings. Use the base URL{" "}
                <code className="rounded-sm bg-card px-1.5 py-0.5 font-mono text-xs">
                  http://localhost:11434/v1
                </code>{" "}
                and a model such as{" "}
                <code className="rounded-sm bg-card px-1.5 py-0.5 font-mono text-xs">
                  llama3.1
                </code>
                . Local mode requires a configured same-host endpoint and a
                network that blocks outside connections. The public Inherit
                service cannot connect to a model on your computer. Saving a
                local endpoint does not itself create that network protection.
              </p>
            </details>
          </div>
        </div>
      ) : (
        <ChatPanel info={info} scope={subject.routeSegment} />
      )}
    </div>
  );
}
