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

export class PreparationWorker extends DurableObject {
  /** Idempotent per wake: a running container is left alone. */
  async wake() {
    const container = this.ctx.container;
    if (container.running) return "running";
    const env = Object.fromEntries(CONTAINER_ENV.map(name => [name, String(this.env[name] ?? "")]));
    container.start({ env, enableInternet: true });
    // Exit and failure are both terminal for this run; the next cron starts a
    // fresh one. Nothing is logged, so no exit detail can carry configuration.
    container.monitor().then(() => {}).catch(() => {});
    return "started";
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
