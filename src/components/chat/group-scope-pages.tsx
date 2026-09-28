import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { BlockingState } from "@/components/embryo/states";
import { OwnChatPanel } from "@/components/chat/own-chat-panel";
import {
  COHORT_COPILOT_LEDE,
  COHORT_EMBRYOS_HEADING,
  COHORT_NEEDS_LOCAL_MODEL,
  COHORT_PLACEHOLDER_LABEL,
  COHORT_THREAD_HINT,
  COPY_IDS,
  OPEN_COMPARISON_BUTTON,
  cohortEmbryoLine,
  FAMILY_COPILOT_LEDE,
  FAMILY_EMPTY_NOTE,
  FAMILY_HOW_TO_TURN_ON,
  FAMILY_MEMBERS_HEADING,
  FAMILY_NEEDS_LOCAL_MODEL,
  FAMILY_PLACEHOLDER_LABEL,
  FAMILY_SCOPE_LABEL,
  FAMILY_THREAD_HINT,
  OPEN_FAMILY_BUTTON,
  REVIEW_SETTINGS_BUTTON,
  familyMemberLine,
} from "@/copy/copilot/group-scopes";
import { COPILOT_LOCAL_ONLY } from "@/copy/family/person";
import { FILES_NOT_ADDED_SENTENCE, ROLE_OTHER_PARENT, STILL_CHECKING_STATUS, waitingForResultsBody, waitingRole } from "@/copy/embryos/index";
import { prepareCohortCopilotChat } from "@/lib/copilot/cohort-chat";
import { prepareFamilyCopilotChat } from "@/lib/copilot/family-chat";
import { analysisConsent } from "@/lib/embryos/access";
import { route } from "@/lib/primary-routes";

/**
 * `policyResolvers.copilot-transport-availability-v1.cases.true-non-self.
 * unavailablePageProjection` (and `responseContracts` shape
 * `copilotCohortUnavailablePage`): the heading, the plain reason, the local
 * deployment requirement and the back action, closed. No context token,
 * composer, history, result, target or provider detail renders here.
 */
export function LocalTransportUnavailable() {
  return (
    <div data-slot="copilot-local-unavailable" data-state="not-covered" className="page-stack mx-auto max-w-3xl space-y-6">
      <header>
        <p className="eyebrow mb-2">Copilot</p>
        <h1 className="display text-3xl">{COPY_IDS["copilot.transport.local-unavailable.heading"]}</h1>
      </header>
      <p className="max-w-prose leading-relaxed">{COPY_IDS["copilot.transport.local-unavailable.reason"]}</p>
      <p className="max-w-prose leading-relaxed text-ink-muted">{COPY_IDS["copilot.transport.local-unavailable.requirement"]}</p>
      <p>
        <Link href={route("app.overview")} className="link-target underline underline-offset-2">
          {COPY_IDS["actions.back"]}
        </Link>
      </p>
    </div>
  );
}

/** `/copilot/family`: the Family group scope, in the register's order of checks. */
export async function FamilyCopilotPage() {
  const view = await prepareFamilyCopilotChat();
  if (!view) notFound();
  if (view.kind === "transport_unavailable") return <LocalTransportUnavailable />;
  const header = (
    <header>
      <p className="eyebrow mb-2">Copilot</p>
      <h1 className="display text-3xl">Ask about {FAMILY_SCOPE_LABEL}</h1>
    </header>
  );
  if (view.kind === "jurisdiction_unavailable") {
    return (
      <div className="page-stack mx-auto max-w-3xl space-y-6" data-slot="copilot-family-jurisdiction">
        {header}
        <p role="status" className="max-w-prose leading-relaxed">{view.copy}</p>
      </div>
    );
  }
  if (view.kind === "provider_required") {
    return (
      <div className="page-stack mx-auto max-w-3xl space-y-6" data-slot="copilot-family-provider-required">
        {header}
        <p className="max-w-prose leading-relaxed">{FAMILY_NEEDS_LOCAL_MODEL}</p>
        <p className="max-w-prose text-sm leading-relaxed text-ink-muted">{COPILOT_LOCAL_ONLY}</p>
        <Link href={route("settings.copilot")} className="link-target underline underline-offset-2">{REVIEW_SETTINGS_BUTTON}</Link>
      </div>
    );
  }
  return (
    <div className="mx-auto flex min-h-[32rem] max-w-3xl flex-col gap-4" data-slot="copilot-family">
      {header}
      <p className="max-w-prose leading-relaxed">{FAMILY_COPILOT_LEDE}</p>
      <p data-slot="copilot-local-only" className="max-w-prose text-sm leading-relaxed text-ink-muted">{COPILOT_LOCAL_ONLY}</p>
      {view.members.length > 0 ? (
        <section aria-labelledby="copilot-family-members" className="rounded-xl border border-line bg-card px-4 py-3 text-sm">
          <h2 id="copilot-family-members" className="font-medium">{FAMILY_MEMBERS_HEADING}</h2>
          <ul data-slot="copilot-family-members" className="mt-2 space-y-1">
            {view.members.map((member, index) => (
              <li key={index}>{familyMemberLine(member.displayLabel, member.layers)}</li>
            ))}
          </ul>
        </section>
      ) : (
        <div data-slot="copilot-family-empty" className="space-y-3 rounded-xl border border-line bg-card p-5 text-sm">
          <p role="status">{FAMILY_EMPTY_NOTE}</p>
          <p className="text-ink-muted">{FAMILY_HOW_TO_TURN_ON}</p>
          <Link href={route("family.index")} className="link-target underline underline-offset-2">{OPEN_FAMILY_BUTTON}</Link>
        </div>
      )}
      {view.contextToken ? (
        <OwnChatPanel key={view.contextHash} contextToken={view.contextToken} info={view.providerInfo} chats={view.chats}
          displayLabel={FAMILY_SCOPE_LABEL} scopeKind="family" threadHint={FAMILY_THREAD_HINT} placeholder={FAMILY_PLACEHOLDER_LABEL} />
      ) : null}
    </div>
  );
}

/**
 * `/copilot/c-{cohort}`: the Embryo (cohort) scope, built under the TEST-LOCAL
 * acceptance row only (src/lib/copilot/group-scopes.ts). A cohort this account
 * cannot read, or any refused embryo jurisdiction for the account itself, is
 * the same 404 as an unknown id. A readable cohort on a deployment with no
 * attested same-host model, or where the scope is not built, renders the
 * registered unavailable page (`copilotCohortUnavailablePage`) and reads
 * nothing else about it. Past that, the result surface's own states, in the
 * embryos pages' order, then the asker's local model, then the thread.
 */
export async function CohortCopilotPage({ cohortId, gate }: { cohortId: string; gate: ReactNode }) {
  const view = await prepareCohortCopilotChat(cohortId);
  if (!view) notFound();
  if (view.kind === "transport_unavailable") return <LocalTransportUnavailable />;
  const header = (
    <header>
      <p className="eyebrow mb-2">Copilot</p>
      <h1 className="display text-3xl">Ask about {"cohortLabel" in view ? view.cohortLabel : "these embryos"}</h1>
    </header>
  );
  const frame = (slot: string, children: ReactNode) => (
    <div className="page-stack mx-auto max-w-3xl space-y-6" data-slot={slot}>{header}{children}</div>
  );
  if (view.kind === "jurisdiction_unavailable") {
    return frame("copilot-cohort-jurisdiction", <p role="status" className="max-w-prose leading-relaxed">{view.copy}</p>);
  }
  const comparison = (id: string) => `${route("embryos.compare")}?cohort=${id}`;
  if (view.kind === "blocked") {
    if (view.state === "gated") return frame("copilot-cohort-gated", gate);
    const sentence = view.state === "consent-required"
      ? waitingForResultsBody(waitingRole(analysisConsent({ analysisGranted: false, viewerAnalysisGranted: view.viewerGranted,
        analysisGrantsMissing: view.grantsMissing })) ?? ROLE_OTHER_PARENT)
      : view.state === "processing" ? STILL_CHECKING_STATUS : FILES_NOT_ADDED_SENTENCE;
    return frame("copilot-cohort-blocked", <BlockingState state={view.state}
      action={{ label: OPEN_COMPARISON_BUTTON, href: comparison(view.cohortId) }}>{sentence}</BlockingState>);
  }
  if (view.kind === "provider_required") {
    return frame("copilot-cohort-provider-required", <>
      <p className="max-w-prose leading-relaxed">{COHORT_NEEDS_LOCAL_MODEL}</p>
      <p className="max-w-prose text-sm leading-relaxed text-ink-muted">{COPILOT_LOCAL_ONLY}</p>
      <Link href={route("settings.copilot")} className="link-target underline underline-offset-2">{REVIEW_SETTINGS_BUTTON}</Link>
    </>);
  }
  return (
    <div className="mx-auto flex min-h-[32rem] max-w-3xl flex-col gap-4" data-slot="copilot-cohort">
      {header}
      <p className="max-w-prose leading-relaxed">{COHORT_COPILOT_LEDE}</p>
      <p data-slot="copilot-standing-statement" className="max-w-prose text-sm leading-relaxed text-ink">{view.standingStatement}</p>
      <p data-slot="copilot-local-only" className="max-w-prose text-sm leading-relaxed text-ink-muted">{COPILOT_LOCAL_ONLY}</p>
      <section aria-labelledby="copilot-cohort-embryos" className="rounded-xl border border-line bg-card px-4 py-3 text-sm">
        <h2 id="copilot-cohort-embryos" className="font-medium">{COHORT_EMBRYOS_HEADING}</h2>
        <ul data-slot="copilot-cohort-embryos" className="mt-2 space-y-1">
          {view.embryos.map((embryo) => <li key={embryo.label}>{cohortEmbryoLine(embryo.label, embryo.status)}</li>)}
        </ul>
        <Link href={comparison(view.cohortId)} className="link-target mt-2 inline-block underline underline-offset-2">
          {OPEN_COMPARISON_BUTTON}
        </Link>
      </section>
      <OwnChatPanel key={view.contextHash} contextToken={view.contextToken} info={view.providerInfo} chats={view.chats}
        displayLabel={view.cohortLabel} scopeKind="cohort" threadHint={COHORT_THREAD_HINT} placeholder={COHORT_PLACEHOLDER_LABEL} />
    </div>
  );
}
