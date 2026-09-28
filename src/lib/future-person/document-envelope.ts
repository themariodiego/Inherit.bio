import "server-only";

import crypto from "node:crypto";
import { decryptSecret } from "@/lib/crypto";

/**
 * Application envelope encryption for claim documents
 * (storage.future-person-identity-v1.encryption): every fragment and every
 * composed document is sealed with AES-256-GCM under the claim's own data
 * key, the one its intake identity is sealed under. The data key reaches
 * this process only wrapped by the deployment key and is unwrapped here, in
 * memory, for the one operation.
 *
 * The object key is the additional authenticated data, so a sealed object
 * cannot be moved to another key, document or claim and still open.
 * Layout: 12-byte IV, 16-byte tag, ciphertext.
 */

export const ENVELOPE_OVERHEAD = 28;

/** The claim data key, from the hex of the wrapped key the database holds. */
export function claimDataKey(wrappedHex: string): Buffer {
  if (!/^[0-9a-f]{58,512}$/u.test(wrappedHex)) throw new Error("claim_key_invalid");
  const key = Buffer.from(decryptSecret(Buffer.from(wrappedHex, "hex")), "base64");
  if (key.length !== 32) {
    key.fill(0);
    throw new Error("claim_key_invalid");
  }
  return key;
}

export function sealDocumentBytes(key: Buffer, objectKey: string, bytes: Uint8Array): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(objectKey, "utf8"));
  const text = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), text]);
}

/** The plaintext, or null when the object was altered, moved or sealed under another key. */
export function openDocumentBytes(key: Buffer, objectKey: string, sealed: Uint8Array): Buffer | null {
  if (sealed.length <= ENVELOPE_OVERHEAD) return null;
  const blob = Buffer.from(sealed.buffer, sealed.byteOffset, sealed.byteLength);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, blob.subarray(0, 12));
    decipher.setAAD(Buffer.from(objectKey, "utf8"));
    decipher.setAuthTag(blob.subarray(12, ENVELOPE_OVERHEAD));
    return Buffer.concat([decipher.update(blob.subarray(ENVELOPE_OVERHEAD)), decipher.final()]);
  } catch {
    return null;
  }
}
