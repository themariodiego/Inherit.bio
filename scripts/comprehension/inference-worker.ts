/**
 * One comprehension inference call, in its own process (G3.1, G3.3).
 *
 * `inference-isolation.ts` starts this file once per call with
 * `node --experimental-strip-types`, from a fresh empty directory outside the
 * checkout and with an environment holding nothing but PATH, a locale and, for
 * a real provider, the one credential variable and proxy settings. The call's
 * whole input arrives on stdin and its whole output leaves on stdout. Nothing
 * here reads the repository, the brief, another session or an earlier run, so
 * what a model sees is exactly the request this file renders:
 *
 *  - a participant sees its persona, the task prompt, its own actions so far
 *    and the current page as text;
 *  - a grader or re-grader sees the rubric's shared instructions, the one task
 *    section, and the verbatim answer. Never the persona, the page, the path,
 *    the brief, the repository or any other verdict.
 *
 * It imports only Node built-ins so it can run without the repository's
 * module graph. The request digest it returns covers the messages and sampling
 * settings but not the model identifier, so a committed record lets anyone
 * re-render and audit a grading request without learning which model ran it.
 */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export type Role = "participant" | "grader" | "regrader";
export type Provider =
  | { kind: "local-deterministic-stub" }
  | { kind: "isolation-probe" }
  | { kind: "openai-compatible-chat"; endpoint: string; model: string; apiKeyVariable: string };
export interface WorkerSettings {
  temperature: number; graderTemperature?: number; maxSteps: number; timeoutMs: number;
  maximumInputTokens: number; maximumOutputTokens: number;
}
export interface WorkerRequest { role: Role; payload: unknown; settings: WorkerSettings; provider: Provider }
type View = { path: string; visibleText: string; controls: string[] };
type Action = { kind: string; target?: string; value?: string; direction?: string; path?: string; channel?: string };
type ParticipantPayload = { persona: string; task: string; history: { view: View; action?: Action }[] };
type GraderPayload = { rubric: string; answer: string };
type Message = { role: "system" | "user"; content: string };

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const bytes = (value: string) => Buffer.byteLength(value, "utf8");
/** Chat templates add a few tokens per message; reserve generously. */
const TEMPLATE_OVERHEAD = 64;

const PARTICIPANT_INSTRUCTIONS = [
  "You are using a website in a web browser to do one task. You see the page as text.",
  "Controls you can use appear as [id kind] label, for example [c4 link] Settings.",
  "Reply with exactly one JSON object and nothing else. Choose one of:",
  '{"kind":"click","target":"<id>"}',
  '{"kind":"type","target":"<id>","value":"<text>"}   fills a field without sending it',
  '{"kind":"submit","target":"<id>","value":"<text>"}   fills a field and presses Enter',
  '{"kind":"scroll","direction":"down"} or {"kind":"scroll","direction":"up"}   reads more of a long page',
  '{"kind":"entry","path":"/a/path","channel":"typed-url"}   types an address on this website into the address bar',
  '{"kind":"finish","answer":"<your answer>"}',
  "Finish when you have done the task or decided you cannot. Your answer is what you would say out loud,",
  "in your own words, to the person who gave you the task. Do only what this person would do.",
].join("\n");

const GRADER_INSTRUCTIONS = [
  "You grade one answer from a usability test. Use only the grading guide below and the answer.",
  "Do not use anything else you know about the website.",
  'Reply with exactly one JSON object and nothing else: {"passed":true|false,"prohibited":true|false,"noRouteFound":true|false}',
  '"passed": the answer meets the guide\'s pass condition for this task.',
  '"prohibited": the answer contains an answer the guide calls prohibited. Only tasks with a prohibited class can have one.',
  '"noRouteFound": the answer reports that no route, page or way to do the task could be found.',
].join("\n");

function actionLabel(view: View, action: Action): string {
  if (!action.target) return "";
  const line = view.visibleText.split("\n").find(candidate => candidate.startsWith(`[${action.target} `));
  return line ? line.replace(/^\[[^\]]+\]\s*/, "").slice(0, 120) : action.target;
}

function describeAction(view: View, action: Action): string {
  const label = actionLabel(view, action);
  switch (action.kind) {
    case "click": return `on ${view.path} you clicked "${label}"`;
    case "type": return `on ${view.path} you typed "${action.value ?? ""}" into "${label}"`;
    case "submit": return `on ${view.path} you entered "${action.value ?? ""}" into "${label}" and pressed Enter`;
    case "scroll": return `on ${view.path} you scrolled ${action.direction}`;
    case "entry": return `you went to the address ${action.path}`;
    default: return `on ${view.path} you did "${action.kind}"`;
  }
}

/** Past steps are one line each; only the current page is shown in full. The
 * whole prompt fits the pinned input bound, measured in bytes, and a
 * byte-level tokenizer never produces more tokens than bytes. */
export function renderParticipant(payload: ParticipantPayload, settings: WorkerSettings): Message[] {
  const current = payload.history.at(-1);
  if (!current) throw new Error("No observation");
  const remaining = settings.maxSteps - payload.history.length;
  const done = payload.history.slice(0, -1).map((step, index) => `${index + 1}. ${describeAction(step.view, step.action ?? { kind: "none" })}`);
  const system = `${payload.persona}\n\n${PARTICIPANT_INSTRUCTIONS}`;
  const closing = remaining <= 0
    ? "This is your last step. Reply with finish and your answer now."
    : `You can take ${remaining} more action${remaining === 1 ? "" : "s"} after this one before you must answer.`;
  const build = (history: string[], page: string) => [
    `Your task: "${payload.task}"`, "",
    "What you have done so far:", ...(history.length ? history : ["Nothing yet. You have just opened the website."]), "",
    `The page you are looking at now (${current.view.path}):`, page, "", closing,
  ].join("\n");
  const budget = settings.maximumInputTokens - TEMPLATE_OVERHEAD - bytes(system);
  let history = done, page = current.view.visibleText, user = build(history, page);
  if (bytes(user) > budget && history.length > 3) { history = ["(earlier steps omitted)", ...history.slice(-3)]; user = build(history, page); }
  if (bytes(user) > budget) {
    const over = bytes(user) - budget + 64;
    page = Buffer.from(page, "utf8").subarray(0, Math.max(0, bytes(page) - over)).toString("utf8").replace(/�$/, "")
      + "\n[page text cut here to fit]";
    user = build(history, page);
  }
  if (bytes(user) > budget) throw new Error("Participant prompt exceeds the pinned input bound");
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

export function renderGrader(payload: GraderPayload, settings: WorkerSettings): Message[] {
  const user = `${payload.rubric.trimEnd()}\n\n---\nThe answer to grade, verbatim:\n<<<\n${payload.answer}\n>>>`;
  if (bytes(GRADER_INSTRUCTIONS) + bytes(user) + TEMPLATE_OVERHEAD > settings.maximumInputTokens) {
    throw new Error("Grading prompt exceeds the pinned input bound");
  }
  return [{ role: "system", content: GRADER_INSTRUCTIONS }, { role: "user", content: user }];
}

/** The first balanced JSON object in a reply, or null. */
export function firstJsonObject(text: string): unknown {
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0, quoted = false, escaped = false;
    for (let index = start; index < text.length; index++) {
      const char = text[index];
      if (quoted) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') quoted = false; continue; }
      if (char === '"') quoted = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        try { return JSON.parse(text.slice(start, index + 1)); } catch { break; }
      }
    }
  }
  return null;
}

/** Keep only the fields the conductor's strict schema accepts for the kind a
 * model chose; the conductor still validates the result. */
export function participantReply(text: string): unknown {
  const value = firstJsonObject(text) as Record<string, unknown> | null;
  if (!value || typeof value.kind !== "string") return { kind: "invalid" };
  const fields: Record<string, string[]> = { click: ["target"], type: ["target", "value"], submit: ["target", "value"],
    scroll: ["direction"], entry: ["path", "channel"], finish: ["answer"] };
  const keep = fields[value.kind];
  if (!keep) return { kind: "invalid" };
  return Object.fromEntries([["kind", value.kind], ...keep.filter(key => key in value).map(key => [key, value[key]])]);
}

export function verdictReply(text: string): unknown {
  const value = firstJsonObject(text) as Record<string, unknown> | null;
  if (!value) return { invalid: true };
  return { passed: value.passed, prohibited: value.prohibited, noRouteFound: value.noRouteFound };
}

// ---- The deterministic local stub. It exercises every boundary of a live run
// ---- and is never evidence: runs using it are recorded outside
// ---- docs/comprehension-runs and carry the stub-provider blocker.

const STOP = new Set(["about", "after", "again", "also", "does", "find", "from", "have", "into", "just", "only", "said",
  "say", "that", "their", "them", "then", "there", "these", "they", "this", "what", "when", "where", "which", "while",
  "with", "your", "yours", "would", "whether", "starting", "someone", "something", "inherit"]);
const words = (text: string) => new Set((text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).filter(word => !STOP.has(word)));
const overlap = (left: Set<string>, right: Set<string>) => [...left].filter(word => right.has(word)).length;
const unit = (seed: string) => parseInt(sha256(seed).slice(0, 8), 16) / 0xffffffff;

export function stubParticipant(payload: ParticipantPayload, settings: WorkerSettings) {
  const current = payload.history.at(-1)!;
  const task = words(payload.task);
  const lines = current.view.visibleText.split("\n");
  const clicked = new Set(payload.history.slice(0, -1).map(step => step.action?.target && actionLabel(step.view, step.action)).filter(Boolean));
  const candidates = lines.map(line => line.match(/^\[([A-Za-z0-9_-]+) (link|button|tab|summary|mailed-link)[^\]]*\]\s*(.*)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match && current.view.controls.includes(match[1]) && !clicked.has(match[3].slice(0, 120))))
    .map(match => ({ id: match[1], score: overlap(task, words(match[3])) + unit(`${payload.persona}/${payload.history.length}/${match[1]}`) * 0.5 }))
    .filter(candidate => candidate.score >= 1)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  const stepsLeft = settings.maxSteps - payload.history.length;
  if (candidates.length && payload.history.length < 5 && stepsLeft > 0) return { kind: "click", target: candidates[0].id };
  // Page text only: never a control line or the harness's own framing lines.
  const sentences = lines.filter(line => !/^(?:\[|Page title:|Note:|\(Showing|---|Email:)/.test(line))
    .flatMap(line => line.split(/(?<=[.!?])\s+/))
    .map(text => text.trim()).filter(text => text.length > 20)
    .map((text, index) => ({ text, index, score: overlap(task, words(text)) }))
    .sort((left, right) => right.score - left.score || left.index - right.index).slice(0, 2);
  return { kind: "finish", answer: sentences.length ? sentences.map(item => item.text).join(" ") : "I could not find it." };
}

function quoted(section: string, heading: RegExp): Set<string> {
  const start = section.search(heading);
  if (start < 0) return new Set();
  const after = section.slice(start).split("\n").slice(1);
  const quote: string[] = [];
  for (const line of after) { if (line.startsWith(">")) quote.push(line.slice(1)); else if (quote.length && line.trim() === "") break; }
  return words(quote.join(" "));
}

export function stubGrader(payload: GraderPayload) {
  const answer = words(payload.answer);
  const pass = quoted(payload.rubric, /^\*\*(?:Pass|Acceptable)\b/m), fail = quoted(payload.rubric, /^\*\*(?:Fail|Prohibited)\b/m);
  return { passed: overlap(answer, pass) > 0 && overlap(answer, pass) > overlap(answer, fail), prohibited: false,
    noRouteFound: /\b(?:could ?n.?t|could not|cannot|can.?t) find\b|\bno (?:page|route|way)\b/i.test(payload.answer) };
}

const approximateTokens = (value: string) => Math.ceil(bytes(value) / 4);

async function callChat(provider: Extract<Provider, { kind: "openai-compatible-chat" }>, messages: Message[],
  temperature: number, settings: WorkerSettings, environment: Record<string, string | undefined>) {
  const endpoint = new URL(provider.endpoint);
  const loopback = endpoint.hostname === "127.0.0.1" || endpoint.hostname === "localhost";
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback)) throw new Error("Endpoint must be HTTPS");
  const key = environment[provider.apiKeyVariable];
  if (!key) throw new Error("Credential variable is not set");
  const sampling = { temperature, max_tokens: settings.maximumOutputTokens, messages };
  const body = JSON.stringify({ model: provider.model, ...sampling });
  const response = await fetch(new URL("chat/completions", endpoint.href.endsWith("/") ? endpoint : `${endpoint.href}/`), {
    method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body,
    signal: AbortSignal.timeout(Math.max(1000, settings.timeoutMs - 500)), redirect: "error" });
  if (!response.ok) throw new Error(`Provider answered ${response.status}`);
  const reply = await response.json() as { choices?: { message?: { content?: unknown } }[];
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
  const content = reply.choices?.[0]?.message?.content;
  const input = reply.usage?.prompt_tokens, output = reply.usage?.completion_tokens;
  // Missing or malformed usage is uncertain spend: the caller keeps the full
  // reservation rather than settling on a guess.
  if (typeof content !== "string" || !Number.isSafeInteger(input) || !Number.isSafeInteger(output)) throw new Error("Incomplete provider reply");
  return { text: content, usage: { complete: true as const, inputTokens: input as number, outputTokens: output as number },
    requestDigest: sha256(JSON.stringify(sampling)) };
}

export async function handle(request: WorkerRequest, environment: Record<string, string | undefined> = process.env) {
  const { role, settings, provider } = request;
  if (provider.kind === "isolation-probe") {
    return { value: { cwd: process.cwd(), environmentKeys: Object.keys(environment).sort() },
      usage: { complete: true as const, inputTokens: 1, outputTokens: 1 } };
  }
  const messages = role === "participant"
    ? renderParticipant(request.payload as ParticipantPayload, settings) : renderGrader(request.payload as GraderPayload, settings);
  const temperature = role === "participant" ? settings.temperature : settings.graderTemperature ?? settings.temperature;
  if (provider.kind === "local-deterministic-stub") {
    const value = role === "participant" ? stubParticipant(request.payload as ParticipantPayload, settings) : stubGrader(request.payload as GraderPayload);
    const inputTokens = Math.min(settings.maximumInputTokens, approximateTokens(JSON.stringify(messages)));
    const outputTokens = Math.min(settings.maximumOutputTokens, approximateTokens(JSON.stringify(value)));
    return { value, usage: { complete: true as const, inputTokens, outputTokens },
      requestDigest: sha256(JSON.stringify({ temperature, max_tokens: settings.maximumOutputTokens, messages })) };
  }
  const reply = await callChat(provider, messages, temperature, settings, environment);
  return { value: role === "participant" ? participantReply(reply.text) : verdictReply(reply.text),
    usage: reply.usage, requestDigest: reply.requestDigest };
}

async function main() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  let output: unknown;
  try { output = await handle(JSON.parse(Buffer.concat(chunks).toString("utf8")) as WorkerRequest); }
  // Never echo provider text or request content into a failure.
  catch (error) { output = { error: error instanceof Error ? error.message.slice(0, 120) : "failed" }; }
  process.stdout.write(JSON.stringify(output) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
