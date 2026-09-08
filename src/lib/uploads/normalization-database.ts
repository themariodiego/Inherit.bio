import "server-only";
import { X509Certificate } from "node:crypto";
import postgres from "postgres";
import { z } from "zod";
import { subjectNormalizationReceipt } from "./subject-upload-contract";

type Environment = Readonly<Record<string, string | undefined>>;
export type CompletionIdentity = {
  p_account_id: string; p_session_id: string; p_file_id: string; p_claim: string;
};
const unavailable = () => new Error("normalization_database_unavailable");
const completionPayloadSchema = z.record(z.string(), z.json());
/** Deployment-owned public trust anchor only; never a peer certificate, key,
 * bundle or global TLS override. The TLS handshake still verifies hostname. */
function hostedCertificateAuthority(raw: string | undefined) {
  if (raw === undefined) return undefined;
  if (raw.length > 16_384) throw unavailable();
  const pem = raw.trim();
  const body = /^-----BEGIN CERTIFICATE-----\r?\n([A-Za-z0-9+/=\r\n]+)\r?\n-----END CERTIFICATE-----$/.exec(pem)?.[1];
  if (!body) throw unavailable();
  const certificate = new X509Certificate(pem);
  if (!certificate.ca || certificate.raw.toString("base64") !== body.replace(/[\r\n]/g, "")) throw unavailable();
  return pem + "\n";
}
type DiagnosticPhase = "configuration" | "identity" | "payload" | "budget" | "driver" | "connect" |
  "role" | "timeouts" | "complete" | "commit" | "deadline" | "close";
const diagnosticCodes = new Set([
  "57014", "42501", "55000", "28P01", "28000", "53300", "53400", "55P03", "25P03",
  "08006", "08001", "57P01", "57P02", "57P03", "23514", "23503", "22P02", "22023", "42883",
  "ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "ECONNRESET", "EAI_AGAIN", "ENOTFOUND",
  "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED",
  "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_HAS_EXPIRED", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
]);
function diagnostic(phase: DiagnosticPhase, error?: unknown) {
  let code = "unavailable";
  try {
    const candidate = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (typeof candidate === "string" && diagnosticCodes.has(candidate)) code = candidate;
  } catch { /* An unknown provider shape must not expose details or affect cleanup. */ }
  console.warn("normalization_database_failed", { phase, code });
}

/** Parse once, without passing a URL (or its option overrides) to the driver.
 * No connection is opened here. Local plaintext requires an explicit registered
 * test project and its exact paired loopback endpoints, never a hosted marker. */
export function normalizationDatabaseConfig(env: Environment) {
  const enabled = env.INHERIT_NORMALIZATION_DIRECT_DATABASE;
  if (enabled === undefined || enabled === "false") return null;
  if (enabled !== "true") throw unavailable();
  try {
    const raw = env.DATABASE_URL;
    if (!raw || /[\s\\]/.test(raw)) throw unavailable();
    const db = new URL(raw), api = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    if (!["postgres:", "postgresql:"].includes(db.protocol) || db.pathname !== "/postgres" || db.hash
      || [...db.searchParams].some(([key, value]) => key !== "sslmode" || value !== "verify-full")
      || db.searchParams.size > 1 || api.username || api.password || api.search || api.hash
      || api.pathname !== "/") throw unavailable();
    const username = decodeURIComponent(db.username), password = decodeURIComponent(db.password);
    const port = Number(db.port || "5432");
    if (!password || /[\u0000-\u001f\u007f]/.test(password)) throw unavailable();
    const project = /^([a-z0-9]{20})\.supabase\.co$/.exec(api.hostname)?.[1];
    const direct = project && db.hostname === `db.${project}.supabase.co` && username === "postgres";
    const pooler = project && /^aws-\d+-[a-z]{2}(?:-[a-z]+)+-\d+\.pooler\.supabase\.com$/.test(db.hostname)
      && username === `postgres.${project}`;
    const hosted = api.protocol === "https:" && !api.port && [5432, 6543].includes(port) && (direct || pooler);
    const localProject = env.INHERIT_LOCAL_E2E_PROJECT;
    const localPorts = localProject === "sequence" ? [54321, 54322]
      : localProject === "inherit-family-20260907" && !env.CI ? [55321, 55322] : null;
    const local = !env.VERCEL && !env.VERCEL_ENV && !env.VERCEL_URL && localPorts
      && api.origin === `http://127.0.0.1:${localPorts[0]}` && db.hostname === "127.0.0.1"
      && port === localPorts[1] && username === "postgres" && !db.search;
    if (!hosted && !local) throw unavailable();
    const ca = hosted ? hostedCertificateAuthority(env.INHERIT_NORMALIZATION_DATABASE_CA_CERT) : undefined;
    return { host: db.hostname, port, username, password, database: "postgres",
      ssl: hosted ? { rejectUnauthorized: true as const, servername: db.hostname, ...(ca ? { ca } : {}) } : false as const };
  } catch { throw unavailable(); }
}

/** Completion alone may bypass REST's request statement budget. The unchanged
 * SQL function remains the sole authority, lease and atomic publication gate.
 * `deadline` is the route-entry monotonic clock +270s, leaving 30s of its 300s
 * operation budget for failure handling. No pool/connection survives this call. */
export function normalizationDatabaseCompletion(env: Environment = process.env) {
  let config: ReturnType<typeof normalizationDatabaseConfig>;
  try { config = normalizationDatabaseConfig(env); }
  catch (error) { diagnostic("configuration", error); throw unavailable(); }
  if (!config) return null;
  return async (identity: CompletionIdentity, payload: unknown, deadline: number) => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    if (![identity.p_account_id, identity.p_session_id, identity.p_file_id, identity.p_claim]
      .every(value => typeof value === "string" && uuid.test(value))) {
      diagnostic("identity"); throw unavailable();
    }
    const parsedPayload = completionPayloadSchema.safeParse(payload);
    if (!parsedPayload.success) { diagnostic("payload"); throw unavailable(); }
    // Five seconds to connect, with headroom for setup, COMMIT/ROLLBACK and close.
    if (!Number.isFinite(deadline)) { diagnostic("budget"); throw unavailable(); }
    const budget = Math.min(195_000, Math.floor(deadline - performance.now()));
    if (!Number.isFinite(budget) || budget < 15_000) { diagnostic("budget"); throw unavailable(); }
    const statementMs = Math.min(180_000, budget - 10_000);
    const sql = (() => {
      try {
        return postgres({ ...config, max: 1, prepare: false, fetch_types: false,
          connect_timeout: 5, idle_timeout: 5, max_lifetime: 200,
          connection: { application_name: "inherit-normalization-complete" },
          onnotice: () => {}, debug: false });
      } catch (error) { diagnostic("driver", error); throw unavailable(); }
    })();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let phase: DiagnosticPhase = "connect";
    try {
      const expired = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          // End(timeout:0) destroys this call's one socket, including a stuck
          // connect/query/COMMIT. Never retry an uncertain publication.
          phase = "deadline";
          void sql.end({ timeout: 0 }).catch(error => diagnostic("close", error));
          reject(unavailable());
        }, budget);
      });
      const committed = sql.begin(async tx => {
        phase = "role";
        await tx`set local role service_role`;
        phase = "timeouts";
        await tx`select set_config('statement_timeout', ${String(statementMs)}, true),
          set_config('lock_timeout', '5000', true),
          set_config('idle_in_transaction_session_timeout', '5000', true)`;
        phase = "complete";
        const rows = await tx<{ receipt: unknown }[]>`select public.own_upload_normalization_v1(
          p_operation => 'complete', p_account_id => ${identity.p_account_id}::uuid,
          p_session_id => ${identity.p_session_id}::uuid, p_file_id => ${identity.p_file_id}::uuid,
          p_claim => ${identity.p_claim}::uuid, p_payload => ${tx.json(parsedPayload.data)}::jsonb) as receipt`;
        const parsed = subjectNormalizationReceipt.safeParse(rows[0]?.receipt);
        if (rows.length !== 1 || !parsed.success || parsed.data.fileId !== identity.p_file_id) throw unavailable();
        phase = "commit";
        return parsed.data;
      });
      // postgres.begin resolves only after the actual COMMIT response. Returning
      // from the transaction callback alone is deliberately insufficient.
      return { data: await Promise.race([committed, expired]), error: null };
    } catch (error) {
      diagnostic(phase, error);
      // Do not expose provider errors, queries, URLs, payloads or credentials.
      throw unavailable();
    } finally {
      if (timer) clearTimeout(timer);
      await sql.end({ timeout: 0 }).catch(error => diagnostic("close", error));
    }
  };
}
