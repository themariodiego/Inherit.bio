// Cron-woken host for the operator preparation worker. A single Durable Object
// owns one Cloudflare Container that runs `pnpm worker:prepared --once` and
// exits; every wake starts it again only if it is not already running.
import { DurableObject } from "cloudflare:workers";

// Exactly what scripts/prepared-worker.run.mts reads: four plain vars from
// wrangler.json and the two Worker secrets. Nothing else reaches the container.
const CONTAINER_ENV = [
  "INHERIT_PREPARED_WGS_ENABLED",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "INHERIT_PREPARED_R2_ORIGIN",
  "INHERIT_PREPARED_R2_BUCKET",
  "INHERIT_UPLOAD_SIGNING_JWK",
];
const SINGLETON = "preparation-worker";
/** How often the object re-arms itself while its container runs. */
const KEEPALIVE_MS = 20_000;

export class PreparationWorker extends DurableObject {
  /** Idempotent per wake: a running container is left alone. */
  async wake() {
    const container = this.ctx.container;
    if (container.running) return "running";
    const env = Object.fromEntries(CONTAINER_ENV.map(name => [name, String(this.env[name] ?? "")]));
    container.start({ env, enableInternet: true });
    // Hold this object open until the container exits. An object with no
    // pending work is evicted, and an evicted object takes its container with
    // it: measured on the preview stack on 20 September 2026, every
    // preparation was killed about ninety seconds in, whatever the instance
    // size, so small files finished and a 64 MiB file never could. The alarm
    // below is the backstop for the wake's own wall-clock limit.
    await this.#keepAlive();
    // Exit and failure are both terminal for this run; the next cron starts a
    // fresh one. Nothing is logged, so no exit detail can carry configuration.
    await container.monitor().catch(() => {});
    return "started";
  }

  /** Re-arms while the container runs, so the object stays resident. */
  async alarm() {
    if (this.ctx.container?.running) await this.#keepAlive();
  }

  async #keepAlive() {
    await this.ctx.storage?.setAlarm?.(Date.now() + KEEPALIVE_MS);
  }
}

const preparationWorkerHost = {
  async scheduled(_controller, env, ctx) {
    const stub = env.PREPARATION_WORKER.get(env.PREPARATION_WORKER.idFromName(SINGLETON));
    const wake = stub.wake();
    ctx.waitUntil(wake);
    await wake;
  },
  // No HTTP surface: the container is reached only through the cron above.
  async fetch() {
    return new Response(null, { status: 404 });
  },
};

export default preparationWorkerHost;
