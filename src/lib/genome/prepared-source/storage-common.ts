import "server-only";
import { z } from "zod";

// Permanently reserved by the Storage metadata trigger, including after a
// reservation is retired. A raw original UUID is never a prepared artifact.
export const preparedObjectKeySchema = z.string().regex(
  /^prepared\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);

/** Trusted server configuration only; no caller-selected origin or credentials. */
export function preparedStorageConfig(): { origin: string; key: string } {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    if (!configured || !key) throw new Error();
    const url = new URL(configured);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password
      || url.search || url.hash || url.pathname !== "/") throw new Error();
    // 55321 is the existing isolated family verification stack's Kong port.
    if (url.protocol === "http:" && !["http://127.0.0.1:54321", "http://localhost:54321",
      "http://[::1]:54321", "http://127.0.0.1:55321"].includes(url.origin)) throw new Error();
    return { origin: url.origin, key };
  } catch { throw new Error("unavailable"); }
}
