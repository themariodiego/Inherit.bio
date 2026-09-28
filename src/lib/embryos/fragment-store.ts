import "server-only";

import { z } from "zod";

/**
 * Where the chunk route puts each per-embryo fragment. The route never
 * chooses a name: a reservation creates the server-owned object identities,
 * the store reports each one's exact name and state, and the route writes
 * exactly the bytes it validated to exactly that name.
 *
 * This is the seam, not a backend. The owner moved embryo upload objects to a
 * versioned, listable store with create-only writes (ADR 0025's approach, so
 * an interrupted write can be proved absent), and the safeguards stream owns
 * that backend. Until it lands `embryoFragmentStore()` answers null and the
 * chunk route refuses before it reserves anything.
 */

export type FragmentTargetState = "open" | "landed" | "uncertain";

export interface FragmentTarget {
  ordinal: number;
  /** The exact server-owned object name. Opaque to the route. */
  objectName: string;
  state: FragmentTargetState;
}

export type FragmentTargets =
  | { status: "reserved" | "stored"; targets: FragmentTarget[] }
  | { status: "failure_pending" }
  | { status: "denied" };

/**
 * `written`: created now. `exists`: an object is already at that name, so it
 * may have landed on an earlier try; the caller re-reads the targets.
 * `refused`: the store would not accept this write now (a closed window, a
 * fence); the caller re-reads the targets, which may renew the window.
 */
export type FragmentWriteOutcome = "written" | "exists" | "refused";

export interface EmbryoFragmentStore {
  /** The reserved chunk's fragment targets, renewing an expired write window where the store allows it. */
  targets(session: string, sequence: number): Promise<FragmentTargets>;
  /** One create-only write of exactly these bytes, whose SHA-256 is `sha256`, at `target.objectName`. */
  write(session: string, sequence: number, target: FragmentTarget, bytes: Uint8Array, sha256: string): Promise<FragmentWriteOutcome>;
}

/**
 * The configured store, or null when this deployment has none. A backend
 * registers itself here when it lands; nothing else constructs one.
 */
export function embryoFragmentStore(): EmbryoFragmentStore | null {
  return null;
}

const target = z.object({
  ordinal: z.number().int().min(0).max(63),
  objectName: z.string().min(1).max(1024),
  state: z.enum(["open", "landed", "uncertain"]),
}).strict();

/** A store's answer, checked before the route acts on it: a closed shape, one target per ordinal. */
export const fragmentTargets = z.discriminatedUnion("status", [
  z.object({ status: z.enum(["reserved", "stored"]), targets: z.array(target).max(64) }).strict(),
  z.object({ status: z.literal("failure_pending") }).strict(),
  z.object({ status: z.literal("denied") }).strict(),
]);
