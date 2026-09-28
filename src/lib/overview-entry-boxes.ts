import type { EntryBoxCopy } from "@/copy/overview";
import { cohortScopeSegment, copilotGroupScopes, type CopilotGroupScopes } from "@/lib/copilot/group-scopes";
import { route } from "@/lib/primary-routes";

/** Where an entry box sends someone, for the boxes whose target is not static. */
export interface EntryBoxTargets {
  firstAdultSegment: string | null;
  cohortId: string | null;
  portraitPairId: string | null;
}

/**
 * Five of the nine boxes carry a static `href`; the other four resolve against
 * the account. Each of those four deliberately falls back to a domain landing
 * rather than a dead route. Portrait resolves only after its exact metadata
 * authority has been confirmed. The two Copilot boxes open their group scope
 * only where it is built (`copilotGroupScopes()`: Family under TEST-LOCAL,
 * the embryo cohort nowhere yet); `/copilot/family` itself then renders the
 * registered unavailable page on a deployment that cannot run a local model.
 *
 * The `default` branch is a self-link and is unreachable today only because
 * every box either carries a static `href` or has a case here. Nothing about
 * the type system enforces that, so `overview-entry-boxes.test.ts` walks the
 * committed boxes and fails if any resolves to Overview itself — a tenth box
 * added without a case would otherwise link Overview to itself silently, which
 * is the one latent hazard `docs/acceptance-matrix.md` records against this
 * function.
 */
export function resolveBoxHref(
  box: EntryBoxCopy,
  targets: EntryBoxTargets,
  scopes: CopilotGroupScopes = copilotGroupScopes(),
): string {
  if (box.href) return box.href;
  switch (box.id) {
    case "family.individual-risks":
      return targets.firstAdultSegment
        ? route("family.person", { person: targets.firstAdultSegment })
        : route("family.index");
    case "family.portrait":
      return targets.portraitPairId
        ? route("family.portrait", { pairId: targets.portraitPairId })
        : route("family.index");
    case "family.copilot":
      return scopes.family
        ? route("copilot.scope", { scope: "family" })
        : route("family.index");
    case "embryos.copilot":
      return scopes.cohort && targets.cohortId
        ? route("copilot.scope", { scope: cohortScopeSegment(targets.cohortId) })
        : route("embryos.index");
    default:
      return route("app.overview");
  }
}
