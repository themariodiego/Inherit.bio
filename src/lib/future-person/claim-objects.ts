import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The private `future-person-identity` bucket (storage.future-person-identity-v1),
 * reached only by the service role. Keys always come from the database;
 * nothing here builds or accepts one from a request.
 *
 * Writes are create-only: an existing key is an error, never an overwrite.
 * There is no list, no signed URL and no public URL.
 */

export const CLAIM_DOCUMENT_BUCKET = "future-person-identity";

export class ClaimObjectError extends Error {
  constructor(readonly operation: "create" | "read" | "remove") {
    super(`claim_object_${operation}_failed`);
  }
}

export interface ClaimObjectStore {
  create(key: string, sealed: Uint8Array): Promise<void>;
  read(key: string): Promise<Uint8Array>;
  /** Idempotent: a key already gone is not an error. */
  remove(keys: readonly string[]): Promise<void>;
}

export function supabaseClaimObjectStore(admin: SupabaseClient): ClaimObjectStore {
  // The literal, not the constant, so the register correspondence scan sees the bucket.
  const bucket = () => admin.storage.from("future-person-identity");
  return {
    async create(key, sealed) {
      const { data, error } = await bucket().upload(key, sealed, {
        upsert: false, contentType: "application/octet-stream", cacheControl: "0",
      });
      if (error || !data || data.path !== key) throw new ClaimObjectError("create");
    },
    async read(key) {
      const { data, error } = await bucket().download(key);
      if (error || !data) throw new ClaimObjectError("read");
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(keys) {
      if (keys.length === 0) return;
      const { error } = await bucket().remove([...keys]);
      if (error) throw new ClaimObjectError("remove");
    },
  };
}

/** Only native appeal evidence sessions choose this separate registered bucket. */
export function supabaseAppealObjectStore(admin: SupabaseClient): ClaimObjectStore {
  const bucket = () => admin.storage.from("legal-evidence");
  return {
    async create(key, sealed) {
      const { data, error } = await bucket().upload(key, sealed, { upsert: false, contentType: "application/octet-stream", cacheControl: "0" });
      if (error || !data || data.path !== key) throw new ClaimObjectError("create");
    },
    async read(key) {
      const { data, error } = await bucket().download(key); if (error || !data) throw new ClaimObjectError("read");
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(keys) { if (!keys.length) return; const { error } = await bucket().remove([...keys]); if (error) throw new ClaimObjectError("remove"); },
  };
}
