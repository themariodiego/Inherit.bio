import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The two wrangler files, the Dockerfile, the root .dockerignore and the
 * deploy workflow are the whole repository side of hosted preparation
 * (ADR-0030), and nothing else exercises them. Their failure modes are quiet:
 * a bucket name that differs between the gateway and the container Worker
 * refuses every artifact with a 404; a var that carried a key would publish
 * it to the dashboard in clear text; a workflow without its guard deploys a
 * gateway that trusts nothing. Every rule here is one of those.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATEWAY = "workers/prepared-artifacts/wrangler.json";
const CONTAINER = "workers/prepared-worker/wrangler.json";
const HOST = "workers/prepared-worker/src/index.mjs";
const DOCKERFILE = "workers/prepared-worker/Dockerfile";
const DOCKERIGNORE = ".dockerignore";
const WORKFLOW = ".github/workflows/deploy-cloudflare.yml";
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

type Vars = Record<string, string>;
interface GatewayScope { name: string; vars: Vars; r2_buckets: { binding: string; bucket_name: string }[] }
interface GatewayConfig extends GatewayScope {
  main: string; compatibility_date: string; workers_dev: boolean; preview_urls: boolean;
  observability: { enabled: boolean }; env: { preview: GatewayScope };
}
interface ContainerScope {
  name: string; vars: Vars; triggers: { crons: string[] };
  containers: { class_name: string; image: string; image_build_context: string; instance_type: string; max_instances: number }[];
  durable_objects: { bindings: { name: string; class_name: string }[] };
  migrations: { tag: string; new_sqlite_classes?: string[] }[];
}
interface ContainerConfig extends ContainerScope {
  main: string; compatibility_date: string; workers_dev: boolean; preview_urls: boolean;
  observability: { enabled: boolean }; env: { preview: ContainerScope };
}

// JSON.parse is the strict-JSON check: a comment, a trailing comma or a byte-order mark all throw here.
const gateway = JSON.parse(read(GATEWAY)) as GatewayConfig;
const container = JSON.parse(read(CONTAINER)) as ContainerConfig;
const TARGETS = ["production", "preview"] as const;
type Target = (typeof TARGETS)[number];
const gatewayScope = (target: Target): GatewayScope => (target === "production" ? gateway : gateway.env.preview);
const containerScope = (target: Target): ContainerScope => (target === "production" ? container : container.env.preview);
const allVars = (config: { vars: Vars; env: { preview: { vars: Vars } } }): [string, string][] =>
  [...Object.entries(config.vars), ...Object.entries(config.env.preview.vars)];

const COMPATIBILITY_DATE = "2026-09-08";
const BUCKET = /^inherit-prepared-[a-z0-9-]{1,40}$/;
const SUPABASE_PROJECT = /^https:\/\/([a-z]{20})\.supabase\.co$/;
const TOKEN_ISSUER = /^https:\/\/([a-z]{20})\.supabase\.co\/auth\/v1$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const COORDINATE = /^[A-Za-z0-9_-]{43}$/;
/** A JWT, a Stripe-style key, or any long base64 run: none of them belongs in a var. */
const CREDENTIAL = /eyJ|sk_|[A-Za-z0-9+/=_-]{40,}/;
const SECRET_NAMES = ["INHERIT_UPLOAD_SIGNING_JWK", "SUPABASE_SERVICE_ROLE_KEY"];
const PLAIN_NAMES = ["INHERIT_PREPARED_R2_BUCKET", "INHERIT_PREPARED_R2_ORIGIN", "INHERIT_PREPARED_WGS_ENABLED", "NEXT_PUBLIC_SUPABASE_URL"];
const WRANGLER = "wrangler@4.134.0";

describe("both Worker configurations", () => {
  it("are strict JSON with their names, one compatibility date and observability off", () => {
    expect(gateway.name).toBe("inherit-prepared-artifacts");
    expect(gateway.env.preview.name).toBe("inherit-prepared-artifacts-preview");
    expect(container.name).toBe("inherit-prepared-worker");
    expect(container.env.preview.name).toBe("inherit-prepared-worker-preview");
    for (const config of [gateway, container]) {
      expect(config.compatibility_date).toBe(COMPATIBILITY_DATE);
      expect(config.observability).toEqual({ enabled: false });
      expect(config.preview_urls).toBe(false);
    }
  });

  it("carry no value that looks like a credential and no secret under a var name", () => {
    for (const [name, value] of [...allVars(gateway), ...allVars(container)]) {
      expect(typeof value).toBe("string");
      expect(name).not.toMatch(/(?:_KEY|_SECRET|_TOKEN|_PASSWORD|_JWK)$/);
      expect(SECRET_NAMES).not.toContain(name);
      // Public P-256 coordinates are 43 base64url characters by definition;
      // that list is held to public fields only, in the gateway rules below.
      if (name !== "SIGNING_PUBLIC_KEYS") expect(value).not.toMatch(CREDENTIAL);
    }
  });
});

describe("the gateway configuration", () => {
  it("serves worker.mjs on workers.dev only, with no preview URLs", () => {
    expect(gateway.main).toBe("worker.mjs");
    expect(gateway.workers_dev).toBe(true);
    expect(gateway.preview_urls).toBe(false);
  });

  it("binds ARTIFACTS to the bucket its BUCKET_NAME names, one per target", () => {
    for (const target of TARGETS) {
      const scope = gatewayScope(target);
      expect(scope.r2_buckets).toHaveLength(1);
      expect(scope.r2_buckets[0].binding).toBe("ARTIFACTS");
      expect(scope.r2_buckets[0].bucket_name).toMatch(BUCKET);
      expect(scope.vars.BUCKET_NAME).toBe(scope.r2_buckets[0].bucket_name);
    }
    expect(gatewayScope("production").vars.BUCKET_NAME).toBe("inherit-prepared-production");
    expect(gatewayScope("preview").vars.BUCKET_NAME).toBe("inherit-prepared-preview");
  });

  it("names the app's own Supabase project as the token issuer", () => {
    expect(containerScope("production").vars.NEXT_PUBLIC_SUPABASE_URL).toMatch(SUPABASE_PROJECT);
    for (const target of TARGETS) {
      const issuer = TOKEN_ISSUER.exec(gatewayScope(target).vars.TOKEN_ISSUER);
      expect(issuer).not.toBeNull();
      // The preview project URL is empty until that branch exists; once set it must be the same ref.
      const project = SUPABASE_PROJECT.exec(containerScope(target).vars.NEXT_PUBLIC_SUPABASE_URL);
      if (project) expect(issuer?.[1]).toBe(project[1]);
    }
  });

  it("commits only public P-256 keys with version-4 uuid kids", () => {
    for (const target of TARGETS) {
      const keys: unknown = JSON.parse(gatewayScope(target).vars.SIGNING_PUBLIC_KEYS);
      expect(Array.isArray(keys)).toBe(true);
      for (const key of keys as Record<string, unknown>[]) {
        expect(key.kty).toBe("EC");
        expect(key.crv).toBe("P-256");
        expect(key.kid).toMatch(UUID_V4);
        expect(key.x).toMatch(COORDINATE);
        expect(key.y).toMatch(COORDINATE);
        expect(key).not.toHaveProperty("d");
        for (const field of Object.keys(key)) expect(["kty", "crv", "kid", "x", "y", "alg", "use"]).toContain(field);
      }
    }
  });
});

describe("the container Worker configuration", () => {
  it("runs the host module on a five-minute cron with no public URL", () => {
    expect(container.main).toBe("src/index.mjs");
    expect(container.workers_dev).toBe(false);
    for (const target of TARGETS) expect(containerScope(target).triggers.crons).toEqual(["*/5 * * * *"]);
  });

  it("names one class consistently across the container, the binding and the migration, at one instance", () => {
    for (const target of TARGETS) {
      const scope = containerScope(target);
      expect(scope.containers).toHaveLength(1);
      const [app] = scope.containers;
      expect(app.class_name).toBe("PreparationWorker");
      expect(scope.durable_objects.bindings).toEqual([{ name: "PREPARATION_WORKER", class_name: app.class_name }]);
      expect(scope.migrations.some((migration) => migration.new_sqlite_classes?.includes(app.class_name))).toBe(true);
      expect(app.max_instances).toBe(1);
      expect(["standard-1", "standard-2"]).toContain(app.instance_type);
      expect(app.image).toBe("./Dockerfile");
      expect(app.image_build_context).toBe("../..");
      const configDirectory = path.join(ROOT, path.dirname(CONTAINER));
      expect(path.resolve(configDirectory, app.image_build_context)).toBe(ROOT);
      expect(existsSync(path.resolve(configDirectory, app.image))).toBe(true);
    }
  });

  it("configures exactly the four plain variables the host forwards, with the two secrets left to wrangler", () => {
    for (const target of TARGETS) {
      const scope = containerScope(target);
      expect(Object.keys(scope.vars).sort()).toEqual(PLAIN_NAMES);
      expect(scope.vars.INHERIT_PREPARED_WGS_ENABLED).toBe("true");
      expect(scope.vars.INHERIT_PREPARED_R2_BUCKET).toMatch(BUCKET);
      expect(scope.vars.INHERIT_PREPARED_R2_BUCKET).toBe(gatewayScope(target).vars.BUCKET_NAME);
      // Empty until the first gateway deploy reveals the URL; the app refuses anything but an https origin.
      const origin = scope.vars.INHERIT_PREPARED_R2_ORIGIN;
      if (origin !== "") {
        const url = new URL(origin);
        expect(url.protocol).toBe("https:");
        expect(url.origin).toBe(origin);
      }
    }
    const host = read(HOST);
    const forwarded = /CONTAINER_ENV = \[([^\]]*)\]/.exec(host)?.[1] ?? "";
    expect([...forwarded.matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((match) => match[1]).sort()).toEqual([...PLAIN_NAMES, ...SECRET_NAMES].sort());
    // The runtime test proves the call; this holds the name the cron wakes and the silence of the module.
    expect(host).toContain('"preparation-worker"');
    expect(host).toContain("idFromName(");
    expect(host).not.toMatch(/console\./);
  });
});

describe("the image", () => {
  const dockerfile = read(DOCKERFILE);
  const lines = dockerfile.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));

  it("is Node 24, runs unprivileged, runs one pass, and copies neither an environment file nor a dependency tree", () => {
    expect(lines.filter((line) => line.startsWith("FROM "))).toEqual([expect.stringMatching(/^FROM node:24-/)]);
    const users = lines.filter((line) => line.startsWith("USER "));
    expect(users.length).toBeGreaterThan(0);
    expect(users.at(-1)).toBe("USER node");
    expect(lines.at(-1)).toBe('CMD ["corepack", "pnpm", "worker:prepared", "--once"]');
    const copies = lines.filter((line) => line.startsWith("COPY "));
    for (const copy of copies) {
      expect(copy).not.toMatch(/\.env/);
      expect(copy).not.toMatch(/node_modules/);
    }
    for (const required of ["tsconfig.json", "scripts/prepared-worker.run.mts", "scripts/server-only-shim.mjs", "data ", "docs/route-register.json", "src "]) {
      expect(copies.some((copy) => copy.includes(required))).toBe(true);
    }
    const install = lines.find((line) => line.includes("pnpm install"));
    for (const flag of ["--frozen-lockfile", "--ignore-scripts", "--prod=false"]) expect(install).toContain(flag);
    // Setting NODE_ENV=production before the install would drop tsx with the other devDependencies.
    expect(lines.filter((line) => line.includes("NODE_ENV"))).toEqual([]);
  });

  it("starts the same operator entry the README documents, including the marker shim", () => {
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
    const entry = scripts["worker:prepared"];
    for (const part of ["--conditions=react-server", "--import ./scripts/server-only-shim.mjs", "--import tsx", "scripts/prepared-worker.run.mts"]) {
      expect(entry).toContain(part);
    }
    expect(entry.indexOf("server-only-shim")).toBeLessThan(entry.indexOf("--import tsx"));
  });

  it("keeps the build context to what the image copies", () => {
    const ignored = read(DOCKERIGNORE).split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
    for (const entry of [".git", "node_modules", ".next", "e2e", "test-results", "playwright-report", "supabase", "docs",
      "content", "public", "worker", ".github", "*.md", ".env*", "scripts/**"]) {
      expect(ignored).toContain(entry);
    }
    expect(ignored).toContain("!scripts/prepared-worker.run.mts");
    expect(ignored).toContain("!scripts/server-only-shim.mjs");
    expect(ignored).toContain("!docs/route-register.json");
  });

  it("copies every file the worker entry imports, transitively, from outside src/", () => {
    // The first container runs (19 September 2026) exited before their first
    // request because the worker module imports docs/route-register.json and
    // the image copied src/ alone. This follows the entry's import graph the
    // way tsx resolves it (relative and @/ specifiers; packages are skipped)
    // and requires every file it reaches outside src/ to be copied, either
    // by name or through a copied directory, and let through .dockerignore.
    const copies = lines.filter((line) => line.startsWith("COPY ")).flatMap((line) => line.split(/\s+/).slice(1, -1)).filter((part) => !part.startsWith("--"));
    const ignored = read(DOCKERIGNORE).split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
    const resolveImport = (from: string, specifier: string): string | null => {
      const base = specifier.startsWith("@/") ? path.join(ROOT, "src", specifier.slice(2))
        : specifier.startsWith(".") ? path.resolve(path.dirname(from), specifier) : null;
      if (!base) return null;
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.mjs`, path.join(base, "index.ts")]) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      }
      throw new Error(`${path.relative(ROOT, from)} imports ${specifier}, which does not resolve`);
    };
    const seen = new Set<string>();
    const queue = [path.join(ROOT, "scripts/prepared-worker.run.mts")];
    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      if (!/\.(?:ts|tsx|mts|mjs)$/.test(file)) continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/(?:from\s+|import\()\s*"([^"]+)"/g)) {
        const target = resolveImport(file, match[1]);
        if (target) queue.push(target);
      }
    }
    const outside = [...seen].map((file) => path.relative(ROOT, file)).filter((file) => !file.startsWith("src/") && file !== "scripts/prepared-worker.run.mts").sort();
    expect(outside).toEqual(["docs/route-register.json"]);
    for (const target of outside) {
      expect(copies.some((copy) => copy === target || target.startsWith(`${copy.replace(/\/$/, "")}/`)), `${target} must be copied into the image`).toBe(true);
      const directory = target.split("/")[0];
      if (ignored.includes(directory)) expect(ignored, `${target} must be let through the build context`).toContain(`!${target}`);
    }
  });
});

describe("the deploy workflow", () => {
  const workflow = read(WORKFLOW);
  const lines = workflow.split("\n");

  it("deploys only from the cloudflare environment once the owner enables it, with read-only contents", () => {
    expect(workflow).toContain("    environment: cloudflare\n");
    expect(workflow).toContain("    if: vars.CLOUDFLARE_DEPLOY_ENABLED == 'true'\n");
    expect(workflow).toMatch(/^permissions:\n {2}contents: read\n\n/m);
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("cancel-in-progress: false");
  });

  it("guards first, then deploys both configurations through one pinned wrangler", () => {
    for (const match of workflow.matchAll(/wrangler@[^ \n"]+/g)) expect(match[0]).toBe(WRANGLER);
    const guard = workflow.indexOf('scripts/cloudflare-deploy-guard.ts "$DEPLOY_TARGET"');
    expect(guard).toBeGreaterThan(-1);
    for (const config of [GATEWAY, CONTAINER]) {
      const deploy = workflow.indexOf(`pnpm dlx ${WRANGLER} deploy --config ${config} --env "$WRANGLER_ENV"`);
      expect(deploy).toBeGreaterThan(guard);
    }
    expect(workflow).toContain('if [ "$DEPLOY_TARGET" = preview ]; then\n            echo "WRANGLER_ENV=preview"');
  });

  it("reads secrets only inside env blocks, each under its own name", () => {
    lines.forEach((line, index) => {
      if (!line.includes("${{ secrets.")) return;
      expect(line).toMatch(/^ +([A-Z][A-Z0-9_]*): \$\{\{ secrets\.\1 \}\}$/);
      const indent = line.search(/\S/);
      let owner = index - 1;
      while (owner >= 0 && (lines[owner].trim() === "" || lines[owner].search(/\S/) >= indent)) owner--;
      expect(lines[owner]?.trim()).toBe("env:");
    });
    expect(workflow).toContain("CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}");
    expect(workflow).toContain("CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}");
  });

  it("is triggered by what changes the image or the Workers, and by hand for either target", () => {
    for (const trigger of [".dockerignore", ".github/workflows/deploy-cloudflare.yml", "data/**", "package.json", "pnpm-lock.yaml",
      "scripts/prepared-worker.run.mts", "scripts/server-only-shim.mjs", "src/**", "tsconfig.json", "workers/**"]) {
      expect(workflow).toContain(`      - "${trigger}"\n`);
    }
    expect(workflow).toMatch(/workflow_dispatch:\n {4}inputs:\n {6}target:\n(?: {8}.*\n)*? {8}default: production\n/);
    expect(workflow).toContain("          - production\n          - preview\n");
  });
});
