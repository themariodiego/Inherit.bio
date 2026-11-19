/**
 * Test-only harness that runs the actual, unmodified worker source in process.
 *
 * `workers/requester-statement-archive/src/private-transport.ts` and its
 * Durable Object class are loaded as written. Only their platform bindings are
 * replaced: an in-memory R2 bucket that counts every call by class, and an
 * in-memory Durable Object namespace that serializes `blockConcurrencyWhile`
 * and clones RPC arguments the way a real RPC boundary does. The bucket's
 * conditional rules (If-Match, If-None-Match, a failed get condition returning
 * an object without a body, a failed put condition returning null) are the
 * provider behaviour the worker source assumes; they are a model, and only a
 * live run can show the real bucket matches it.
 *
 * The caller's test file must mock `cloudflare:workers` before calling
 * `loadWorkerSource`.
 */
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { FetchLike } from "./requester-statement-archive-qualification";

export type R2CallCounts = { classA: number; classB: number; delete: number };
type StoredObject = { bytes: Uint8Array; version: string; etag: string; customMetadata: Record<string, string>;
  httpMetadata: Record<string, string>; uploaded: Date };
type Conditional = Readonly<{ onlyIf?: Headers }>;

const CHUNK_BYTES = 65_536;

export class InMemoryR2Bucket {
  readonly calls: R2CallCounts = { classA: 0, classB: 0, delete: 0 };
  readonly objects = new Map<string, StoredObject>();
  peakStoredBytes = 0;

  storedBytes(): number {
    let total = 0;
    for (const object of this.objects.values()) total += object.bytes.byteLength;
    return total;
  }

  private describe(key: string, object: StoredObject) {
    return { key, version: object.version, etag: object.etag, httpEtag: `"${object.etag}"`, size: object.bytes.byteLength,
      customMetadata: { ...object.customMetadata }, httpMetadata: { ...object.httpMetadata }, uploaded: object.uploaded };
  }

  private passes(onlyIf: Headers | undefined, current: StoredObject | undefined): boolean {
    if (!onlyIf) return true;
    const tags = (value: string) => value.split(",").map(tag => tag.trim().replace(/^W\//u, "").replace(/^"(.*)"$/u, "$1"));
    const ifMatch = onlyIf.get("if-match"), ifNoneMatch = onlyIf.get("if-none-match");
    if (ifMatch !== null) {
      if (!current) return false;
      const wanted = tags(ifMatch);
      if (!wanted.includes("*") && !wanted.includes(current.etag)) return false;
    }
    if (ifNoneMatch !== null && current) {
      const refused = tags(ifNoneMatch);
      if (refused.includes("*") || refused.includes(current.etag)) return false;
    }
    return true;
  }

  async head(key: string) {
    this.calls.classB++;
    const object = this.objects.get(key);
    return object ? this.describe(key, object) : null;
  }

  async get(key: string, options: Conditional = {}) {
    this.calls.classB++;
    const object = this.objects.get(key);
    if (!object) return null;
    if (!this.passes(options.onlyIf, object)) return this.describe(key, object);
    const copy = object.bytes.slice();
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= copy.byteLength) { controller.close(); return; }
        controller.enqueue(copy.slice(offset, offset + CHUNK_BYTES));
        offset += CHUNK_BYTES;
      },
    });
    return { ...this.describe(key, object), body };
  }

  async put(key: string, value: Uint8Array, options: Conditional & Readonly<{ customMetadata?: Record<string, string>;
    httpMetadata?: Record<string, string> }> = {}) {
    this.calls.classA++;
    if (!this.passes(options.onlyIf, this.objects.get(key))) return null;
    const bytes = Uint8Array.from(value);
    const stored: StoredObject = { bytes, version: randomBytes(16).toString("hex"),
      etag: createHash("md5").update(bytes).digest("hex"), customMetadata: { ...(options.customMetadata ?? {}) },
      httpMetadata: { ...(options.httpMetadata ?? {}) }, uploaded: new Date() };
    this.objects.set(key, stored);
    this.peakStoredBytes = Math.max(this.peakStoredBytes, this.storedBytes());
    return this.describe(key, stored);
  }

  async delete(key: string) {
    this.calls.delete++;
    this.objects.delete(key);
  }
}

class InMemoryDurableStorage {
  private readonly values = new Map<string, unknown>();
  private alarm: number | null = null;
  async get(key: string) { return this.values.has(key) ? structuredClone(this.values.get(key)) : undefined; }
  async put(key: string, value: unknown) { this.values.set(key, structuredClone(value)); }
  async delete(key: string) { return this.values.delete(key); }
  async list(options: { prefix?: string; limit?: number } = {}) {
    const keys = [...this.values.keys()].filter(key => key.startsWith(options.prefix ?? "")).sort().slice(0, options.limit);
    return new Map(keys.map(key => [key, structuredClone(this.values.get(key))]));
  }
  async getAlarm() { return this.alarm; }
  async setAlarm(at: number) { this.alarm = at; }
}

class InMemoryDurableState {
  readonly storage = new InMemoryDurableStorage();
  private queue: Promise<unknown> = Promise.resolve();
  /** One callback at a time, in arrival order, like the platform's input gate. */
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    const run = this.queue.then(callback);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}

type GatewayInstance = Record<string, (...args: unknown[]) => Promise<unknown>>;
type GatewayConstructor = new (state: InMemoryDurableState, env: Record<string, unknown>) => GatewayInstance;
export type WorkerSource = Readonly<{
  default: { fetch(request: Request, env: Record<string, unknown>): Promise<Response> };
  RequesterStatementArchiveGateway: GatewayConstructor;
}>;

/** An RPC boundary copies its arguments; the transport zeroes its own buffer after the call. */
function cloneArgument(value: unknown): unknown {
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (value instanceof Headers) return new Headers(value);
  return structuredClone(value);
}

export class InMemoryGatewayNamespace {
  readonly instances = new Map<string, GatewayInstance>();
  constructor(private readonly construct: () => GatewayInstance) {}
  idFromName(name: string) { return name; }
  get(id: string) {
    let instance = this.instances.get(id);
    if (!instance) { instance = this.construct(); this.instances.set(id, instance); }
    const target = instance;
    return new Proxy({}, { get: (_, method: string) => (...args: unknown[]) => target[method](...args.map(cloneArgument)) });
  }
}

export async function loadWorkerSource(): Promise<WorkerSource> {
  const file = path.resolve(process.cwd(), "workers/requester-statement-archive/src/private-transport.ts");
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as WorkerSource;
}

export type InProcessWorker = Readonly<{
  fetch: FetchLike; bucket: InMemoryR2Bucket; namespace: InMemoryGatewayNamespace; requests: () => number;
}>;

/** The actual worker behind an in-memory bucket and namespace, enabled for TEST. */
export function createInProcessWorker(source: WorkerSource, configuration: Readonly<{ bucket: string;
  bindingSha256: string; transportKey: string }>): InProcessWorker {
  const bucket = new InMemoryR2Bucket();
  const gatewayEnv = { CASE_ARCHIVE_BUCKET: bucket, CASE_ARCHIVE_BUCKET_NAME: configuration.bucket,
    CASE_ARCHIVE_BINDING_SHA256: configuration.bindingSha256, CASE_ARCHIVE_TEST_ENABLED: "1" };
  const namespace = new InMemoryGatewayNamespace(() =>
    new source.RequesterStatementArchiveGateway(new InMemoryDurableState(), gatewayEnv));
  const transportEnv = { CASE_ARCHIVE_GATEWAYS: namespace, CASE_ARCHIVE_TRANSPORT_KEY: configuration.transportKey,
    CASE_ARCHIVE_TEST_ENABLED: "1" };
  let requests = 0;
  const fetch: FetchLike = async (input, init) => {
    requests++;
    return source.default.fetch(new Request(input, init), transportEnv);
  };
  return Object.freeze({ fetch, bucket, namespace, requests: () => requests });
}
