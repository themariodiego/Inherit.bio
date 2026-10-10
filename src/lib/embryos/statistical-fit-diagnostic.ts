/** Closed fitted-worker failure observations. Never payloads or error text.
 * This frame carries no success decision; the original terminal still decides. */
const OUTER = ["NOT_OBSERVED", "COMMAND_TIMEOUT", "COMMAND_EXIT", "COMMAND_OUTPUT_BOUND",
  "COMMAND_SPAWN_REFUSED", "COMMAND_SIGNAL", "COMMAND_REFUSED"] as const;
const INNER = ["NOT_OBSERVED", "WORK_DEADLINE", "WORK_EXIT", "WORK_OUTPUT_BOUND", "WORK_SPAWN_REFUSED",
  "WORK_CANCELLED", "WORK_TERMINAL_REFUSED", "WORK_RETURNED_FAILURE", "ENTRYPOINT_REFUSED", "RPC_REFUSED"] as const;
const OPERATIONS = ["NOT_OBSERVED", "STARTUP", "CLAIM", "CHECK", "READ", "RECOMPUTE", "SAVE", "FAIL"] as const;
const CODES = ["NOT_OBSERVED", "worker_disabled", "invalid_response", "aborted", "unavailable"] as const;
export type FittedFailure = { outer: typeof OUTER[number]; inner: typeof INNER[number];
  operation: typeof OPERATIONS[number]; code: typeof CODES[number] };
export type FittedFailureOperation = FittedFailure["operation"];
export type FittedFailureInner = FittedFailure["inner"];
const PREFIX = "EMBRYO_FITTED_FAILURE_V1", PROPERTY = "embryoFittedFailure";
function own(value: unknown, key: string): unknown {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return undefined;
  try { const property = Object.getOwnPropertyDescriptor(value, key);return property && "value" in property ? property.value : undefined; }
  catch { return undefined; }
}
function closed(value: unknown): FittedFailure | null {
  const outer = own(value, "outer"), inner = own(value, "inner"), operation = own(value, "operation"), code = own(value, "code");
  if (!OUTER.includes(outer as FittedFailure["outer"]) || !INNER.includes(inner as FittedFailure["inner"])
    || !OPERATIONS.includes(operation as FittedFailure["operation"]) || !CODES.includes(code as FittedFailure["code"])) return null;
  return { outer, inner, operation, code } as FittedFailure;
}
export function encodeFittedFailure(value: FittedFailure): string {
  const fields = closed(value);
  if (!fields) throw new Error("Invalid closed fitted diagnostic");
  return [PREFIX, fields.outer, fields.inner, fields.operation, fields.code].join("|");
}
export function decodeFittedFailure(value: unknown): FittedFailure | null {
  if (typeof value !== "string" || value.length > 256) return null;
  const fields = (value.endsWith("\n") ? value.slice(0, -1) : value).split("|");
  if (fields.length !== 5 || fields[0] !== PREFIX) return null;
  const result = { outer: fields[1], inner: fields[2], operation: fields[3], code: fields[4] } as FittedFailure;
  return closed(result);
}
export function fittedFailureFrom(value: unknown, inner: FittedFailureInner = "ENTRYPOINT_REFUSED",
  operation: FittedFailureOperation = "STARTUP"): FittedFailure {
  const observed = decodeFittedFailure(own(value, PROPERTY));
  if (observed) return observed;
  const code = own(value, "code");
  return { outer: "NOT_OBSERVED", inner, operation,
    code: CODES.includes(code as FittedFailure["code"]) ? code as FittedFailure["code"] : "NOT_OBSERVED" };
}
export function attachFittedFailure<T extends object>(target: T, value: FittedFailure): T {
  Object.defineProperty(target, PROPERTY, { value: encodeFittedFailure(value), enumerable: false });return target;
}
/** Node execFile's fixed public control fields; message/stack are never read. */
export function fittedCommandFailure(error: unknown): FittedFailure {
  const code = own(error, "code"), killed = own(error, "killed"), signal = own(error, "signal");
  const nested = decodeFittedFailure(own(error, "stderr"));
  const outer: FittedFailure["outer"] = code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "COMMAND_OUTPUT_BOUND"
    : killed === true && signal === "SIGKILL" ? "COMMAND_TIMEOUT"
    : typeof code === "number" && Number.isInteger(code) && code !== 0 ? "COMMAND_EXIT"
    : code === "ENOENT" || code === "EACCES" || code === "EAGAIN" ? "COMMAND_SPAWN_REFUSED"
    : typeof signal === "string" && signal.length > 0 ? "COMMAND_SIGNAL" : "COMMAND_REFUSED";
  return { outer, inner: nested?.inner ?? "NOT_OBSERVED", operation: nested?.operation ?? "NOT_OBSERVED",
    code: nested?.code ?? "NOT_OBSERVED" };
}
/** Diagnostic selection only; worker admission still validates the full frame. */
export function isFittedJourneyCommand(args: readonly string[], input: string | undefined, container: string): boolean {
  if (args.length !== 9 || args[0] !== "exec" || args[1] !== "-i" || args[2] !== "--user"
    || !/^[0-9]+:[0-9]+$/.test(args[3]) || args[4] !== container || args[5] !== "node"
    || args[6] !== "--import" || args[7] !== "tsx" || args[8] !== "/app/scripts/ci-browser/embryo-statistical-worker.mts"
    || typeof input !== "string" || input.length > 16_384) return false;
  try { const value: unknown = JSON.parse(input);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      && Object.keys(value).length === 2 && Object.keys(value).every(key => key === "kind" || key === "environment")
      && own(value, "kind") === "fitted-test";
  } catch { return false; }
}
