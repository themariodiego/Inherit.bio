import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { OwnChatPanel } from "@/components/chat/own-chat-panel";
import { LocalTransportUnavailable } from "@/components/chat/group-scope-pages";
import { ResultGate } from "@/components/family/result-gate";
import { FAMILY_NEEDS_LOCAL_MODEL, REVIEW_SETTINGS_BUTTON } from "@/copy/copilot/group-scopes";
import {
  SUBJECT_LAYERS_HEADING,
  subjectCopilotLede,
  subjectHeldText,
  subjectHowToTurnOn,
  subjectLayersLine,
  subjectPermissionMissingNote,
  subjectPlaceholderLabel,
  subjectScopeHeading,
  subjectThreadHint,
} from "@/copy/copilot/subject-scope";
import { COPILOT_LOCAL_ONLY } from "@/copy/family/person";
import { prepareSubjectCopilotChat } from "@/lib/copilot/subject-chat";
import { route } from "@/lib/primary-routes";

/**
 * `/copilot/s-{subject}` for one other adult's record (register
 * scope-derived-v1 `subject:adult` / `uploader-or-grantee`), in the
 * register's order of checks: no relationship is the same 404 as an unknown
 * id; a deployment with no attested same-host model gets the registered
 * unavailable page and nothing else; then the asker's jurisdiction, their own
 * local model, the person's permission (or a hold the mitigation decision
 * keeps, of which nothing is said), the Tier-2 acknowledgement, and the
 * thread. The h1 is the thread header: it names the one person whose results
 * the thread reads (brief §8.6).
 */
export async function SubjectCopilotPage({ subjectId }: { subjectId: string }) {
  const view = await prepareSubjectCopilotChat(subjectId);
  if (!view) notFound();
  if (view.kind === "transport_unavailable") return <LocalTransportUnavailable />;
  const frame = (slot: string, children: ReactNode) => (
    <div className="page-stack rec-column stack-blocks" data-slot={slot}>
      <header className="rec-head">
        <p className="eyebrow">Copilot</p>
        <h1 className="display">{subjectScopeHeading(view.displayLabel)}</h1>
      </header>
      {children}
    </div>
  );
  if (view.kind === "jurisdiction_unavailable") {
    return frame("copilot-subject-jurisdiction", <p role="status" className="max-w-measure leading-relaxed">{view.copy}</p>);
  }
  if (view.kind === "provider_required") {
    return frame("copilot-subject-provider-required", <>
      <div className="rec-stack">
        <p className="max-w-measure leading-relaxed">{FAMILY_NEEDS_LOCAL_MODEL}</p>
        <p className="max-w-measure text-sm leading-relaxed text-ink-muted">{COPILOT_LOCAL_ONLY}</p>
      </div>
      <p><Link href={route("settings.copilot")} className="link-target quiet-link">{REVIEW_SETTINGS_BUTTON}</Link></p>
    </>);
  }
  if (view.kind === "permission_missing") {
    return frame("copilot-subject-permission-missing",
      <div className="surface-inset surface-pad-sm rec-stack-sm max-w-measure text-sm text-ink">
        <p role="status">{subjectPermissionMissingNote(view.displayLabel)}</p>
        <p>{subjectHowToTurnOn(view.displayLabel)}</p>
      </div>);
  }
  if (view.kind === "held") {
    return frame("copilot-subject-held",
      <p role="status" className="surface-inset surface-pad-sm max-w-measure text-sm text-ink">{subjectHeldText(view.displayLabel)}</p>);
  }
  if (view.kind === "gated") return frame("copilot-subject-gated", <ResultGate />);
  return frame("copilot-subject", <>
    <div className="rec-stack">
      <p className="body-lg max-w-measure">{subjectCopilotLede(view.displayLabel)}</p>
      <p data-slot="copilot-local-only" className="caption max-w-measure">{COPILOT_LOCAL_ONLY}</p>
      <section aria-labelledby="copilot-subject-layers" className="surface surface-pad-sm text-sm">
        <h2 id="copilot-subject-layers" className="text-base font-medium">{SUBJECT_LAYERS_HEADING}</h2>
        <p data-slot="copilot-subject-layers" className="mt-2">{subjectLayersLine(view.displayLabel, view.layers)}</p>
      </section>
    </div>
    <OwnChatPanel key={view.contextHash} contextToken={view.contextToken} info={view.providerInfo} chats={view.chats}
      displayLabel={view.displayLabel} scopeKind="subject" threadHint={subjectThreadHint(view.displayLabel)}
      placeholder={subjectPlaceholderLabel(view.displayLabel)} />
  </>);
}
