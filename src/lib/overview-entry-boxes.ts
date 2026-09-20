import { COPILOT_GROUP_SCOPES_AVAILABLE, type EntryBoxCopy } from "@/copy/overview";
import { route } from "@/lib/primary-routes";

/** Where an entry box sends someone, for the boxes whose target is not static. */
export interface EntryBoxTargets {
  firstAdultSegment: string | null;
  cohortId: string | null;
}

/**
 * Five of the nine boxes carry a static `href`; the other four resolve against
 * the account. Each of those four deliberately falls back to a domain landing
 * rather than a dead route, which is why three of them do not yet arrive where
 * the box says (G2.4's reachability half).
 *
 * The `default` branch is a self-link and is unreachable today only because
 * every box either carries a static `href` or has a case here. Nothing about
 * the type system enforces that, so `overview-entry-boxes.test.ts` walks the
 * committed boxes and fails if any resolves to Overview itself — a tenth box
 * added without a case would otherwise link Overview to itself silently, which
 * is the one latent hazard `docs/acceptance-matrix.md` records against this
 * function.
 */
export function resolveBoxHref(box: EntryBoxCopy, targets: EntryBoxTargets): string {
  if (box.href) return box.href;
  switch (box.id) {
    case "family.individual-risks":
      return targets.firstAdultSegment
        ? route("family.person", { person: targets.firstAdultSegment })
        : route("family.index");
    case "family.portrait":
      // No eligible-pair resolution exists yet: the domain landing is the
      // blocking state.
      return route("family.index");
    case "family.copilot":
      return COPILOT_GROUP_SCOPES_AVAILABLE
        ? route("copilot.scope", { scope: "family" })
        : route("family.index");
    case "embryos.copilot":
      return COPILOT_GROUP_SCOPES_AVAILABLE && targets.cohortId
        ? route("copilot.scope", { scope: targets.cohortId })
        : route("embryos.index");
    default:
      return route("app.overview");
  }
}
