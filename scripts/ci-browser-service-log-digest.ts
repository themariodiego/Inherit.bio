/**
 * Failure evidence from the job's own local auth service and API gateway,
 * reduced to fields that cannot carry a credential or a person's details.
 *
 * Why it exists: a signed-in browser was sent to the sign-in page in the
 * middle of a journey on CI (e2e/figures-two-seed.spec.ts, 19 November 2026).
 * The app treats any failed `GET /auth/v1/user` (a 5xx, a 429, a refused
 * connection, a `session_not_found`) as "signed out", and the job kept only
 * the browser's side. These two logs are the server's side.
 *
 * What the raw logs can hold, and why none of it survives here: GoTrue's JSON
 * lines carry audit events with the account's email (`actor_username`), IP
 * and user agent, request ids, user ids and free-text `error` messages that
 * can quote SQL values; Kong's access log carries the full request target,
 * whose query string can hold an `apikey`, a signed-URL `token` or a
 * PostgREST filter on an email. Nothing is copied from a raw line: each
 * output field is rebuilt from an allowlist (method, status, a numeric
 * duration, a lowercase error code, a five-character SQLSTATE) or a fixed
 * enum (the error class, the gateway event), the path loses its query and
 * every segment that is not a short lowercase word, and every output line
 * must match one closed grammar or the digest refuses to produce anything.
 */

export const SERVICE_LOG_SOURCES = ["auth", "kong"] as const;
export type ServiceLogSource = (typeof SERVICE_LOG_SOURCES)[number];

/** Lines read from each container's log, newest last (`docker logs --tail`). */
export const SERVICE_LOG_TAIL_LINES = 50_000;

const METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;
const LEVELS = ["debug", "info", "notice", "warn", "warning", "error", "crit", "alert", "emerg", "fatal", "panic"] as const;
/** Levels whose non-request lines are kept, as an event with no text. */
const KEPT_EVENT_LEVELS = new Set(["warn", "warning", "error", "crit", "alert", "emerg", "fatal", "panic"]);

const DOCKER_TIME = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z) (.*)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORD = /^[a-z][a-z0-9_-]{0,39}$/;
const NUMBER = /^[0-9]{1,6}$/;
const ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const COMPONENT = /^[a-z][a-z0-9_-]{0,31}$/;

/**
 * The causes a free-text error is reduced to; the text itself is never kept.
 * First match wins. D-142's hosted runs 44607979037 and 44614403733 recorded
 * a burst of simultaneous 500s from the auth service as `other`, so the
 * causes such a burst can have were added: first the one measured on the
 * local stack, where the auth service dials a new database connection for its
 * queries and under load its container runs out of local ports to dial from
 * ("connect: cannot assign requested address"); then a connection the server
 * ended or the driver gave up on, a connection used by two queries at once,
 * the two transaction conflicts, a cached statement the schema invalidated or
 * a pooler dropped, a unique-key race and a lock wait.
 */
const ERROR_CLASSES: ReadonlyArray<[string, RegExp]> = [
  ["local_ports_exhausted", /cannot assign requested address/i],
  ["db_connections_exhausted", /too many clients|remaining connection slots|too many connections/i],
  ["connection_refused", /connection refused/i],
  ["connection_reset", /connection reset|broken pipe|reset by peer|unexpected eof/i],
  ["connection_terminated", /terminating connection|server closed the connection|conn closed|connection is closed|closed pool|bad connection|database system is (?:shutting down|starting up|in recovery)/i],
  ["connection_busy", /conn busy/i],
  ["deadlock", /deadlock detected/i],
  ["serialization_failure", /could not serialize access|serialization failure/i],
  ["cached_plan_invalid", /cached plan must not change result type/i],
  ["prepared_statement", /prepared statement \S+ (?:does not exist|already exists)/i],
  ["duplicate_key", /duplicate key value violates unique constraint/i],
  ["lock_not_available", /could not obtain lock|lock not available/i],
  ["timeout", /deadline exceeded|timed out|timeout/i],
  ["canceled", /context canceled|canceling statement due to user request/i],
  ["dns", /no such host|name resolution|could not resolve|dns/i],
];
/**
 * Postgres's own code for a failed statement, as pgx prints it inside the
 * auth service's error text (`... (SQLSTATE 40P01)`): five characters from a
 * fixed alphabet, which name the condition and nothing else. Only the code is
 * kept, never the text around it.
 */
const SQLSTATE = /\(SQLSTATE ([0-9A-Z]{5})\)/;
/** nginx error-log causes; the line's text, client and request are never kept. */
const GATEWAY_CLASSES: ReadonlyArray<[string, RegExp]> = [
  ["upstream_connect_failed", /connect\(\) failed/],
  ["upstream_timeout", /upstream timed out/],
  ["upstream_closed", /upstream prematurely closed/],
  ["no_live_upstreams", /no live upstreams/],
  ["connection_reset", /recv\(\) failed|send\(\) failed|reset by peer|broken pipe/],
  ["dns", /DNS|resolve|name resolution/i],
  ["body_too_large", /too large body/],
];
/** Gateway lifecycle notices worth a line: a reload closes idle keep-alive connections. */
const GATEWAY_EVENTS: ReadonlyArray<[string, RegExp]> = [
  ["reload", /signal 1 \(SIGHUP\) received|reconfiguring/],
  ["worker_shutdown", /gracefully shutting down/],
  ["worker_crash", /exited on signal/],
];

const TS = String.raw`\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z`;
const PATH = String.raw`/[a-z0-9_<>/-]{0,255}`;
const METHOD = `(?:${METHODS.join("|")})`;
const ENUM = "[a-z_]{1,40}";
/** Every line the digest may emit. Anything else refuses the whole digest. */
export const DIGEST_LINE = new RegExp(
  `^(?:# digest (?:auth|kong) read=\\d{1,9} kept=\\d{1,9} unparsed=\\d{1,9}`
  + `|${TS} (?:auth|kong) ${METHOD} ${PATH} \\d{3}(?: error_code=[a-z][a-z0-9_]{0,63})?(?: error_class=${ENUM})?(?: sqlstate=[0-9A-Z]{5})?(?: ms=\\d{1,9})?`
  + `|${TS} (?:auth|kong) level=(?:${LEVELS.join("|")})(?: component=[a-z][a-z0-9_-]{0,31})?`
  + `(?: (?:error_class|gateway_class|gateway_event)=${ENUM})?(?: sqlstate=[0-9A-Z]{5})?(?: ${METHOD} ${PATH})?)$`,
);

function classify(text: string, classes: ReadonlyArray<[string, RegExp]>): string {
  return classes.find(([, pattern]) => pattern.test(text))?.[0] ?? "other";
}

/** An error text's class, and its SQLSTATE when it carries one. */
function errorFields(text: string): string[] {
  const code = SQLSTATE.exec(text)?.[1];
  return [`error_class=${classify(text, ERROR_CLASSES)}`, ...(code ? [`sqlstate=${code}`] : [])];
}

/**
 * The path of a request target with its query and fragment gone, and every
 * segment that is not a short lowercase word or a small number replaced:
 * ids by `<id>`, anything else (an email, a file name, a long mixed token)
 * by `<seg>`. Returns null for a target that is not an absolute path.
 */
export function digestPath(target: string): string | null {
  const path = target.split(/[?#]/, 1)[0] ?? "";
  if (!path.startsWith("/")) return null;
  const segments = path.slice(1).split("/").map(segment => {
    if (segment === "") return "";
    if (UUID.test(segment)) return "<id>";
    if (NUMBER.test(segment)) return segment;
    // A word that mixes letters and digits at token length is treated as a token.
    if (WORD.test(segment) && !(segment.length >= 8 && /\d/.test(segment))) return segment;
    return "<seg>";
  });
  return `/${segments.join("/")}`.slice(0, 256);
}

function level(value: unknown): string | null {
  return typeof value === "string" && (LEVELS as readonly string[]).includes(value.toLowerCase()) ? value.toLowerCase() : null;
}

function digestAuthLine(time: string, body: string): string | null {
  let record: unknown;
  try { record = JSON.parse(body); } catch { return null; }
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const line = record as Record<string, unknown>;
  const method = typeof line.method === "string" && (METHODS as readonly string[]).includes(line.method) ? line.method : null;
  const path = typeof line.path === "string" ? digestPath(line.path) : null;
  const status = Number.isInteger(line.status) && (line.status as number) >= 100 && (line.status as number) <= 599 ? line.status as number : null;
  if (method && path && status !== null) {
    const fields = [`${time} auth ${method} ${path} ${status}`];
    if (line.error_code !== undefined) fields.push(`error_code=${typeof line.error_code === "string" && ERROR_CODE.test(line.error_code) ? line.error_code : "other"}`);
    if (typeof line.error === "string" && line.error.length > 0) fields.push(...errorFields(line.error));
    if (Number.isSafeInteger(line.duration) && (line.duration as number) >= 0) fields.push(`ms=${Math.min(Math.round((line.duration as number) / 1e6), 999_999_999)}`);
    return fields.join(" ");
  }
  const severity = level(line.level);
  if (!severity || !KEPT_EVENT_LEVELS.has(severity)) return null;
  const fields = [`${time} auth level=${severity}`];
  if (typeof line.component === "string" && COMPONENT.test(line.component)) fields.push(`component=${line.component}`);
  const text = [line.msg, line.error].filter(value => typeof value === "string").join(" ");
  fields.push(...errorFields(text));
  return fields.join(" ");
}

const ACCESS = /^\S+ \S+ \S+ \[[^\]]*\] "(\S+) (\S+) HTTP\/[0-9.]+" (\d{3}) /;
const NGINX = /^\d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d \[([a-z]+)\] (.*)$/;
const NGINX_REQUEST = /request: "(\S+) (\S+) HTTP\/[0-9.]+"/;

function digestKongLine(time: string, body: string): string | null {
  const access = ACCESS.exec(body);
  if (access) {
    const [, method, target, status] = access;
    const path = digestPath(target!);
    if (!(METHODS as readonly string[]).includes(method!) || !path) return null;
    return `${time} kong ${method} ${path} ${status}`;
  }
  const nginx = NGINX.exec(body);
  if (!nginx) return null;
  const severity = level(nginx[1]);
  const text = nginx[2]!;
  if (!severity) return null;
  const event = GATEWAY_EVENTS.find(([, pattern]) => pattern.test(text))?.[0];
  if (!event && !KEPT_EVENT_LEVELS.has(severity)) return null;
  const fields = [`${time} kong level=${severity}`, event ? `gateway_event=${event}` : `gateway_class=${classify(text, GATEWAY_CLASSES)}`];
  const request = NGINX_REQUEST.exec(text);
  const path = request ? digestPath(request[2]!) : null;
  if (request && (METHODS as readonly string[]).includes(request[1]!) && path) fields.push(`${request[1]} ${path}`);
  return fields.join(" ");
}

/**
 * Digest one service's `docker logs --timestamps` output (stdout and stderr
 * together, in any order): one header line, then the kept lines in time
 * order, newest last, at most `limit` of them. Throws, producing nothing,
 * if a line it built does not match the closed grammar.
 */
export function digestServiceLog(source: ServiceLogSource, raw: string, limit = SERVICE_LOG_TAIL_LINES): string {
  const kept: { time: string; order: number; line: string }[] = [];
  let read = 0, unparsed = 0;
  for (const rawLine of raw.split(/\r?\n/)) {
    if (rawLine.length === 0) continue;
    read += 1;
    const stamped = DOCKER_TIME.exec(rawLine);
    const line = stamped ? (source === "auth" ? digestAuthLine : digestKongLine)(stamped[1]!, stamped[2]!) : null;
    if (line === null) { if (!stamped) unparsed += 1; continue; }
    kept.push({ time: stamped![1]!, order: kept.length, line });
  }
  kept.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : a.order - b.order);
  const lines = [`# digest ${source} read=${read} kept=${kept.length} unparsed=${unparsed}`,
    ...kept.slice(-limit).map(item => item.line)];
  for (const line of lines) {
    if (!DIGEST_LINE.test(line)) throw new Error(`Service log digest refused: a ${source} line left the closed grammar`);
  }
  return `${lines.join("\n")}\n`;
}
