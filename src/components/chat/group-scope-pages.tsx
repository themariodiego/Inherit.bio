import Link from "next/link";
import { notFound } from "next/navigation";
import { OwnChatPanel } from "@/components/chat/own-chat-panel";
import {
  COPY_IDS,
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
import { prepareFamilyCopilotChat } from "@/lib/copilot/family-chat";
import { EMBRYO_ANALYSIS, embryoCapability, permits } from "@/lib/embryos/access";
import { listCohortsForAccount } from "@/lib/embryos/cohorts";
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
 * `/copilot/c-{cohort}`: the Embryo group scope is designed but refused until
 * embryo publication exists. A cohort this account cannot read answers the
 * same 404 as an unknown one; a readable one renders the registered
 * unavailable page and reads nothing else about it.
 */
export async function CohortCopilotPage({ accountId, cohortId }: { accountId: string; cohortId: string }) {
  if (!permits(await embryoCapability(accountId, [], EMBRYO_ANALYSIS))) notFound();
  const cohorts = await listCohortsForAccount(accountId);
  if (!cohorts.some((cohort) => cohort.id === cohortId)) notFound();
  return <LocalTransportUnavailable />;
}
