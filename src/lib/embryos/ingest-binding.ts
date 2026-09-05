import { EMBRYO_INGEST_SESSION_LIMITS as LIMITS } from "../genome/ingest-limits";
import { EmbryoTransportError } from "./ingest-lines";

export interface EmbryoTransportBinding {
  /** Random server-issued challenge, never derived from source text. */
  challenge: string;
  revision: number;
  /** Resolved by the server build decision; never defaulted by a parser. */
  build: "GRCh37" | "GRCh38";
  sampleCount: number;
}

export interface BrowserTransportBinding extends EmbryoTransportBinding {
  /** Issued handles in reserved ordinal order; browser memory only. */
  handles: readonly string[];
}

export interface ServerTransportBinding extends EmbryoTransportBinding {
  /** Match this live session's stored handle hashes, never a global map. */
  resolveHandle: (handle: string) => number | null;
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function checkTransportBinding(binding: EmbryoTransportBinding): void {
  if (!TOKEN.test(binding.challenge) || !Number.isSafeInteger(binding.revision) || binding.revision < 1 ||
    !["GRCh37", "GRCh38"].includes(binding.build) || !Number.isInteger(binding.sampleCount) ||
    binding.sampleCount < 1 || binding.sampleCount > LIMITS.maximumSampleColumns) {
    throw new EmbryoTransportError("invalid_session");
  }
}

export function checkTransportHandles(handles: readonly string[], count: number): void {
  if (handles.length !== count || new Set(handles).size !== count || handles.some((value) => !TOKEN.test(value))) {
    throw new EmbryoTransportError("invalid_session");
  }
}

export function resolveTransportHandle(handle: string, binding: ServerTransportBinding): number {
  if (!TOKEN.test(handle)) throw new EmbryoTransportError("invalid_session");
  const ordinal = binding.resolveHandle(handle);
  if (ordinal === null || !Number.isInteger(ordinal) || ordinal < 0 || ordinal >= binding.sampleCount) {
    throw new EmbryoTransportError("invalid_session");
  }
  return ordinal;
}
