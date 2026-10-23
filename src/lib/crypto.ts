import crypto from "node:crypto";

// AES-256-GCM for user-supplied LLM API keys (BYOK). The data key comes from
// the deployment env (BYOK_ENCRYPTION_KEY, 32 bytes base64) and never lives
// in the database; ciphertext lives in llm_keys, which has no client grants.

function decodeDataKey(raw: string | undefined): Buffer {
  if (!raw) throw new Error("BYOK_ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("BYOK_ENCRYPTION_KEY must be 32 bytes of base64");
  }
  return key;
}

function dataKey(): Buffer {
  return decodeDataKey(process.env.BYOK_ENCRYPTION_KEY);
}

export function encryptSecret(plaintext: string): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", dataKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function decryptSecret(blob: Buffer): string {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ct = blob.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", dataKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
    "utf8",
  );
}

/**
 * Produce a keyed, context-separated digest for values that must be matched
 * without being stored in plaintext. The context derives a distinct sub-key
 * from the deployment encryption key, so ciphertext encryption and indexes do
 * not reuse the same key material directly.
 */
export function hmacSecret(value: string, context: string): string {
  return hmacUnder(dataKey(), value, context);
}

/**
 * The same digest under a key the caller supplies (32 bytes base64), for a
 * local browser test helper that mints with the local server's test key
 * without setting it in its own process environment. Product code uses
 * `hmacSecret`.
 */
export function hmacSecretWithKey(value: string, context: string, encodedKey: string): string {
  return hmacUnder(decodeDataKey(encodedKey), value, context);
}

function hmacUnder(key: Buffer, value: string, context: string): string {
  const subKey = crypto
    .createHmac("sha256", key)
    .update(context, "utf8")
    .digest();
  return crypto.createHmac("sha256", subKey).update(value, "utf8").digest("hex");
}
