/**
 * The honest states of the Embryo surfaces (design §1.4). Server components.
 * Every empty or blocking state here is the product's one <EmptyState>
 * (an inset surface, the sentence, at most one action); the wrappers keep
 * the roles and `data-*` the browser suite names.
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
 *     The heading stays an h2 and is set in the title role, so the hub keeps
 *     one display voice.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/site/empty-state";
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
    <Button asChild size="lg" variant={action.primary ? "default" : "outline"}>
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
    >
      <EmptyState action={action ? <ActionLink action={action} /> : undefined}>
        <div className="space-y-3">
          <p className="text-ink">{decision.userFacingCopy}</p>
          <p className="text-sm">
            <Link href={route("legal.future-person")} className="link-target quiet-link">
              {FUTURE_PERSON_LINK}
            </Link>
          </p>
        </div>
      </EmptyState>
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
    <section role="status" data-slot="blocking-state" data-state={state}>
      <EmptyState action={action ? <ActionLink action={action} /> : undefined}>{children}</EmptyState>
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
      className="surface surface-pad max-w-measure space-y-4"
    >
      <h2 className="title text-ink">{heading}</h2>
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
    <EmptyState
      title={
        <h2 data-slot="empty-state-heading" className="title">
          {heading}
        </h2>
      }
      action={<ActionLink action={{ ...action, primary: true }} />}
    >
      <div className="space-y-2">
        <p className="text-base leading-relaxed">{whatAppears}</p>
        <p className="text-base leading-relaxed">{howToMakeItAppear}</p>
      </div>
    </EmptyState>
  );
}
