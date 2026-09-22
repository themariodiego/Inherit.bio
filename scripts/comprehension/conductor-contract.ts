import { z } from "zod";

export const taskIds = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10"] as const;
export type TaskId = (typeof taskIds)[number];
export const opaque = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const digest = z.string().regex(/^[0-9a-f]{64}$/);
const count = z.number().int().nonnegative().max(1_000_000);
const route = z.string().max(2048).regex(/^\/(?!\/)[^\s?#\\]*$/);
export const settingsSchema = z.object({
  temperature: z.number().finite().min(0).max(2), maxSteps: z.number().int().min(1).max(100),
  maxAttempts: z.number().int().min(1).max(3), timeoutMs: z.number().int().min(10).max(60_000),
  maximumInputTokens: count.min(1), maximumOutputTokens: count.min(1),
  price: z.object({ inputMicroDollarsPerMillion: count, outputMicroDollarsPerMillion: count }).strict(),
}).strict();
export type Settings = z.infer<typeof settingsSchema>;
export const verdictSchema = z.object({ passed: z.boolean(), prohibited: z.boolean(), noRouteFound: z.boolean() }).strict();
export const viewSchema = z.object({ path: route, visibleText: z.string().max(65_536), controls: z.array(opaque).max(1000) }).strict();
export type View = z.infer<typeof viewSchema>;
export const actionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), target: opaque }).strict(),
  z.object({ kind: z.literal("submit"), target: opaque, value: z.string().max(4096) }).strict(),
  z.object({ kind: z.literal("type"), target: opaque, value: z.string().max(4096) }).strict(),
  z.object({ kind: z.literal("scroll"), direction: z.enum(["up", "down"]) }).strict(),
  z.object({ kind: z.literal("entry"), path: route, channel: z.enum(["mailed-link", "typed-url"]) }).strict(),
]);
export type BrowserAction = z.infer<typeof actionSchema>;
export const participantResultSchema = z.union([actionSchema,
  z.object({ kind: z.literal("finish"), answer: z.string().min(1).max(65_536) }).strict()]);
export const browserRecordSchema = z.object({ completed: z.boolean(), path: z.array(route).min(1).max(1000),
  // The adapter records actual DOM events, not the number of requested actions.
  actions: count, entries: count,
  confirmationExclusions: z.array(opaque).max(100),
}).strict();
export type BrowserRecord = z.infer<typeof browserRecordSchema>;

export type Role = "participant" | "grader" | "regrader";
export type ParticipantPayload = Readonly<{ persona: string; task: string;
  history: readonly Readonly<{ view: View; action?: BrowserAction }>[] }>;
export type GraderPayload = Readonly<{ rubric: string; answer: string }>;
export type Payload = ParticipantPayload | GraderPayload;
export interface ProcessAdapter {
  id: string;
  invoke(payload: Payload, settings: Readonly<Settings>, signal: AbortSignal): Promise<unknown>;
  close(): Promise<void>;
}
export interface BrowserAdapter {
  id: string;
  observe(): Promise<unknown>;
  act(action: BrowserAction): Promise<void>;
  record(): Promise<unknown>;
  close(): Promise<void>;
}
/** Factories are test doubles only. Unique instances do not prove OS isolation. */
export interface DryEnvironment {
  kind: "synthetic-local-adapter";
  openBrowser(input: Readonly<{ id: string; taskId: TaskId; account: string; fixtures: readonly string[] }>, signal: AbortSignal): Promise<BrowserAdapter>;
  openProcess(input: Readonly<{ id: string; role: Role }>, signal: AbortSignal): Promise<ProcessAdapter>;
}
export const inferenceResultSchema = z.object({ value: z.unknown(),
  usage: z.object({ complete: z.literal(true), inputTokens: count, outputTokens: count }).strict(),
}).strict();

export function freeze<T>(input: T): Readonly<T> {
  if (input && typeof input === "object") {
    Object.values(input).forEach(value => freeze(value));
    Object.freeze(input);
  }
  return input;
}
