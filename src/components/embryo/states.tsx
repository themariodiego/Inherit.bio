/**
 * The honest states of the Embryo surfaces (design §1.4). Server components.
 *
 *   - <EmbryoUnavailable>: the jurisdiction refuses. The register's own
 *     `userFacingCopy` renders inside the frame with the future-person link;
 *     the frame carries no sentence of its own.
 *   - <BlockingState>: one sentence and at most one action, for the empty,
 *     processing and consent-required states. Nothing derived is fetched
 *     behind it.
 *   - <EmbryoErrorState>: the closed-shape refusal — what happened, naming
 *     the page, and one action; never a value.
 *   - <EmbryoEmptyState>: brief line 930's four parts: a heading of at most
 *     six words, what would appear here, how to make it appear, one action.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { FUTURE_PERSON_LINK } from "@/copy/embryos/index";
import { route } from "@/lib/primary-routes";
import type { CapabilityDecision } from "@/lib/legal/jurisdictions";

export interface StateAction {
  label: string;
  href: string;
  /** The one primary action of the page; every other action is an outline. */
  primary?: boolean;
}

function ActionLink({ action }: { action: StateAction }) {
  return (
    <Button asChild size="lg" variant={action.primary ? "default" : "outline"} className="min-h-11">
      <Link href={action.href}>{action.label}</Link>
    </Button>
  );
}

export function EmbryoUnavailable({
  decision,
  action,
}: {
  decision: CapabilityDecision;
  action?: StateAction;
}) {
  return (
    <section
      role="status"
      data-slot="jurisdiction-unavailable"
      data-jurisdiction-source={decision.source}
      className="max-w-prose space-y-4 rounded-2xl border border-line bg-card p-6"
    >
      <p className="text-base leading-relaxed text-ink">{decision.userFacingCopy}</p>
      <p className="text-sm leading-relaxed">
        <Link href={route("legal.future-person")} className="underline underline-offset-2">
          {FUTURE_PERSON_LINK}
        </Link>
      </p>
      {action ? <ActionLink action={action} /> : null}
    </section>
  );
}

export function BlockingState({
  state,
  children,
  action,
}: {
  /** The §1.4 state name, exposed for the browser suite. */
  state: "empty" | "processing" | "consent-required";
  children: ReactNode;
  action?: StateAction;
}) {
  return (
    <section
      role="status"
      data-slot="blocking-state"
      data-state={state}
      className="max-w-prose space-y-4 rounded-2xl border border-line bg-card p-6"
    >
      <p className="text-base leading-relaxed text-ink">{children}</p>
      {action ? <ActionLink action={action} /> : null}
    </section>
  );
}

export function EmbryoErrorState({
  heading,
  children,
  action,
}: {
  heading: string;
  children: ReactNode;
  action: StateAction;
}) {
  return (
    <section
      role="alert"
      data-slot="error-state"
      className="max-w-prose space-y-4 rounded-2xl border border-line bg-card p-6"
    >
      <h2 className="font-medium">{heading}</h2>
      <p className="text-base leading-relaxed text-ink">{children}</p>
      <ActionLink action={action} />
    </section>
  );
}

export function EmbryoEmptyState({
  heading,
  whatAppears,
  howToMakeItAppear,
  action,
}: {
  heading: string;
  whatAppears: string;
  howToMakeItAppear: string;
  action: StateAction;
}) {
  return (
    <section data-slot="empty-state" data-density-top-level-section className="max-w-prose space-y-4">
      <h2 data-slot="empty-state-heading" className="text-lg font-semibold text-ink">
        {heading}
      </h2>
      <p className="text-base leading-relaxed text-ink">{whatAppears}</p>
      <p className="text-base leading-relaxed text-ink">{howToMakeItAppear}</p>
      <ActionLink action={{ ...action, primary: true }} />
    </section>
  );
}
