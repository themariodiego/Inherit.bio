import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  EmbryoFragmentStorageError,
  embryoFragmentStorageConfigured,
  parseEmbryoWriteTargets,
  writeEmbryoFragment,
  type EmbryoFragmentRpc,
  type EmbryoWriteTarget,
} from "./fragment-storage";

/**
 * Where the chunk route puts each per-embryo fragment
 * (docs/embryo-fragment-storage.md). The route never chooses a name: the
 * reservation creates the server-owned identities, `embryo_ingest_write_targets_v1`
 * reports each one's exact receipt and state, and the route writes exactly
 * the bytes it validated against exactly that receipt.
 *
 * Embryo upload objects live in a private R2 bucket behind the signed
 * fragment gateway, with create-only writes (owner decision of 28 September,
 * ADR 0025's approach), so an interrupted write can later be proved absent.
 * This module is the chunk route's one seam onto that backend; the transport
 * itself is `src/lib/embryos/fragment-storage.ts`.
 */

export type FragmentTargetState = "open" | "landed" | "uncertain";

export interface FragmentTarget {
  ordinal: number;
  state: FragmentTargetState;
  /** The exact receipt SQL issued. Presented back unchanged. */
  receipt: EmbryoWriteTarget;
}

export type FragmentTargets =
  | { status: "reserved" | "stored"; targets: FragmentTarget[] }
  | { status: "failure_pending" }
  | { status: "denied" };

/**
 * `landed`: written create-only, read back to EOF and acknowledged by SQL.
 * `retry`: the intent is still open (the store was unavailable, the window
 * closed, the read-back or acknowledgement did not match, or the request was
 * aborted); re-read the targets, which renew an expired window, and retry.
 * `conflict`: the key holds something other than these bytes; this fragment
 * can never land, so retrying is pointless.
 */
export type FragmentWriteOutcome = "landed" | "retry" | "conflict";

export interface EmbryoFragmentStore {
  /** The reserved chunk's targets. Reading them renews an expired open window. Throws when the answer breaks its contract. */
  targets(session: string, sequence: number): Promise<FragmentTargets>;
  /** Land one fragment at its receipt. Never throws. */
  write(target: FragmentTarget, bytes: Uint8Array, signal: AbortSignal): Promise<FragmentWriteOutcome>;
}

type Rpc = (name: string, args: Record<string, unknown>) => {
  abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }>;
} & PromiseLike<{ data: unknown; error: unknown }>;

/** The R2-backed store over a service-role RPC. Exported for tests; routes use `embryoFragmentStore()`. */
export function r2FragmentStore(rpc: Rpc, write: typeof writeEmbryoFragment = writeEmbryoFragment): EmbryoFragmentStore {
  return {
    async targets(session, sequence) {
      const { data, error } = await rpc("embryo_ingest_write_targets_v1", { p_session_id: session, p_sequence: sequence });
      if (error) throw new EmbryoFragmentStorageError("unavailable");
      const parsed = parseEmbryoWriteTargets(data);
      if (!("targets" in parsed)) return { status: parsed.status === "failure_pending" ? "failure_pending" : "denied" };
      return {
        status: parsed.status,
        targets: parsed.targets.map((target) => ({ ordinal: target.receipt.ordinal, state: target.state, receipt: target.receipt })),
      };
    },
    async write(target, bytes, signal) {
      try {
        await write({ rpc: rpc as EmbryoFragmentRpc, target: target.receipt, bytes, signal });
        return "landed";
      } catch (error) {
        return error instanceof EmbryoFragmentStorageError && error.code === "conflict" ? "conflict" : "retry";
      }
    },
  };
}

/**
 * The configured store, or null unless `embryoFragmentStorageConfigured()`
 * says this deployment names a usable fragment gateway: an https origin with
 * no path or credentials and an `inherit-embryo-*` bucket, checked exactly as
 * the writer checks them. The chunk route calls this before it authorizes,
 * reads or reserves anything, so an unconfigured deployment never reserves a
 * fragment it cannot write. Nothing here reads the environment itself, and it
 * claims nothing about the gateway being reachable or a backend being
 * selected in SQL; `reserve_embryo_ingest_chunk_v1` refuses until one is.
 */
export function embryoFragmentStore(): EmbryoFragmentStore | null {
  if (!embryoFragmentStorageConfigured()) return null;
  const admin = createAdminClient();
  return r2FragmentStore(admin.rpc.bind(admin) as unknown as Rpc);
}
