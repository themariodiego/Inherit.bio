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
      // Corrected 2026-09-21: eligible-pair resolution DOES exist, on the
      // Family hub (`src/app/(family-hub)/family/page.tsx`), which reads the
      // viewer's self subject and the pending/current `family_pairs` row and
      // links `family.portrait` with that id. What is missing here is not the
      // lookup but the authority to do it from Overview: that read is gated on
      // a live `family.portrait` grant and the hub rechecks captured authority
      // before rendering any ready state, because a stale grant must reveal no
      // file state. Resolving a pair id here without the same recheck would
      // disclose that a pair exists to someone whose grant has been revoked.
      // So the domain landing stays the blocking state, and closing this needs
      // the grant check carried across, not a `pairId` threaded through.
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
