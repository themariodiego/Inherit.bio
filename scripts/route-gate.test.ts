import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { createdBuckets, exportedMethods, runRouteGate, titleProves } from "./route-gate";

/**
 * The gate is only worth having if a planted defect fails it, so every check
 * is tested against a repository that is real except for the one thing the
 * test breaks. The big inputs — the app tree, the migrations, the browser
 * tests — are symlinked from this repository so the floor guards see their
 * true size, and only the file under test is rewritten.
 */
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoots: string[] = [];

afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

interface Overrides {
  /** Receives the real brief text and returns the planted one. */
  brief?: (source: string) => string;
  register?: (register: Record<string, unknown>) => void;
  ledger?: (ledger: Record<string, unknown>) => void;
  nextConfig?: string;
}

/** A repository whose unchanged parts point back at the real ones. */
function plant(overrides: Overrides): string {
  const root = mkdtempSync(path.join(tmpdir(), "route-gate-"));
  temporaryRoots.push(root);
  mkdirSync(path.join(root, "docs"));
  mkdirSync(path.join(root, "src"));
  mkdirSync(path.join(root, "supabase"));
  symlinkSync(path.join(REPOSITORY_ROOT, "src/app"), path.join(root, "src/app"));
  symlinkSync(path.join(REPOSITORY_ROOT, "e2e"), path.join(root, "e2e"));
  symlinkSync(path.join(REPOSITORY_ROOT, "supabase/migrations"), path.join(root, "supabase/migrations"));

  const register = JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, "docs/route-register.json"), "utf8"));
  overrides.register?.(register);
  writeFileSync(path.join(root, "docs/route-register.json"), JSON.stringify(register));

  const ledger = JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, "docs/route-divergence.json"), "utf8"));
  overrides.ledger?.(ledger);
  writeFileSync(path.join(root, "docs/route-divergence.json"), JSON.stringify(ledger));

  const brief = readFileSync(path.join(REPOSITORY_ROOT, "docs/inherit-v2-brief.md"), "utf8");
  writeFileSync(path.join(root, "docs/inherit-v2-brief.md"), overrides.brief?.(brief) ?? brief);

  writeFileSync(
    path.join(root, "next.config.ts"),
    overrides.nextConfig ?? readFileSync(path.join(REPOSITORY_ROOT, "next.config.ts"), "utf8"),
  );
  return root;
}

type Route = { id: string; kind: string; methods?: string[]; stateProfile?: string };

describe("the route gate holds the register to the code", () => {
  it("passes on this repository, having actually read all four inputs", async () => {
    const result = await runRouteGate(REPOSITORY_ROOT);
    expect(result.failures).toEqual([]);
    expect(result.builtRouteCount).toBeGreaterThan(100);
    expect(result.matchedEndpointCount).toBeGreaterThan(30);
    expect(result.registeredRedirectCount).toBe(10);
    expect(result.checkedKindCount).toBeGreaterThan(90);
    // 226 since 2026-09-12, when the operator signed corrections item 4 and `error`
    // came off nine `stateProfiles` as a state no request can reach. Pinned exactly
    // rather than as a floor, so a profile quietly losing a state fails here.
    expect(result.requiredStateCount).toBe(226);
    expect(result.browserTestTitleCount).toBeGreaterThan(100);
  });

  it("fails when a route exports a verb the register does not declare", async () => {
    const root = plant({
      register: (register) => {
        const route = (register.routes as Route[]).find((entry) => entry.id === "api.browse-region")!;
        route.methods = ["POST", "DELETE"];
      },
    });
    const { failures } = await runRouteGate(root);
    expect(failures).toContain(
      "declared methods: not recorded in docs/route-divergence.json: " +
        "api.browse-region declared=DELETE+POST exported=POST",
    );
  });

  it("fails when a recorded method divergence has been fixed but left in the ledger", async () => {
    const root = plant({
      ledger: (ledger) => {
        (ledger.methodDivergence as { routeId: string; declared: string[]; exported: string[] }[]).push({
          routeId: "api.browse-region", declared: ["POST"], exported: ["POST", "PUT"],
        });
      },
    });
    const { failures } = await runRouteGate(root);
    expect(failures).toContain(
      "declared methods: recorded in docs/route-divergence.json but no longer present: " +
        "api.browse-region declared=POST exported=POST+PUT",
    );
  });

  it("fails when a legacy alias emits 307 instead of the registered 308", async () => {
    const root = plant({
      nextConfig: `const nextConfig = {
        async redirects() {
          return [
            { source: "/signup", destination: "/auth/sign-up", permanent: false },
            { source: "/login", destination: "/auth/sign-in", permanent: true },
            { source: "/copilot", destination: "/copilot/me", permanent: true },
          ];
        },
      };
      export default nextConfig;
      `,
    });
    const { failures } = await runRouteGate(root);
    expect(failures).toContain(
      "redirect status: not recorded in docs/route-divergence.json: legacy.signup /signup expected=308 emits=307",
    );
    // The alias that still reads permanent: true is not reported, so the check
    // is reading each entry rather than the shape of the file.
    expect(failures.join("\n")).not.toContain("legacy.login");
  });

  it("fails when a registered page literal is served by an endpoint", async () => {
    const root = plant({
      ledger: (ledger) => {
        ledger.kindDivergence = (ledger.kindDivergence as { path: string }[]).filter(
          (known) => known.path !== "/withdraw/request",
        );
      },
    });
    const { failures } = await runRouteGate(root);
    expect(failures).toContain(
      "route kind: not recorded in docs/route-divergence.json: " +
        "rights.withdraw /withdraw/request declared=page built=endpoint",
    );
  });

  it("fails when a registered endpoint is built as a page", async () => {
    const root = plant({
      register: (register) => {
        const route = (register.routes as Route[]).find((entry) => entry.id === "api.browse-region")!;
        route.kind = "page";
      },
    });
    const { failures } = await runRouteGate(root);
    expect(failures).toContain(
      "route kind: not recorded in docs/route-divergence.json: " +
        "api.browse-region /api/browse/region declared=page built=endpoint",
    );
  });

  it("fails when a bucket holding bytes has no declared prefix", async () => {
    const root = plant({
      register: (register) => {
        register.storagePrefixes = (register.storagePrefixes as { bucket: string }[]).filter(
          (prefix) => prefix.bucket !== "genomes",
        );
      },
    });
    const { failures } = await runRouteGate(root);
    expect(failures).toContain(
      "storage bucket: not recorded in docs/route-divergence.json: created-not-declared genomes",
    );
  });

  it("fails when a declared bucket that no migration creates is not recorded", async () => {
    const root = plant({
      ledger: (ledger) => {
        ledger.storageBucketDivergence = (
          ledger.storageBucketDivergence as { bucket: string }[]
        ).filter((known) => known.bucket !== "exports");
      },
    });
    const { failures } = await runRouteGate(root);
    expect(failures).toContain(
      "storage bucket: not recorded in docs/route-divergence.json: declared-not-created exports",
    );
  });

  it("fails when the register requires a state no browser test proves", async () => {
    const root = plant({
      register: (register) => {
        const profiles = register.stateProfiles as Record<string, { supported: string[] }>;
        profiles.endpoint.supported = [...profiles.endpoint.supported, "consent-required"];
      },
    });
    const { failures } = await runRouteGate(root);
    expect(failures.join("\n")).toContain("route state ratchet:");
    expect(failures.join("\n")).toContain("unproven, and UNPROVEN_ROUTE_STATE_PAIRS");
  });

  /**
   * The planted entry names a route the register does not contain, and that is
   * deliberate. `plant` symlinks the real `e2e/` directory, so the proven set
   * is computed from this repository's real test titles - which means any real
   * (route, state) pair used here is a time bomb: it works only until someone
   * proves that pair, and then this test fails for a reason that has nothing
   * to do with what it is checking. It happened, with `/files complete`. The
   * proven set is only ever built from the register's own routes, so a path
   * that is not in the register can never enter it, whatever anyone proves.
   */
  it("fails when a proof recorded in the ledger is no longer proven", async () => {
    const absent = "/no-such-route-in-the-register complete";
    const root = plant({
      ledger: (ledger) => {
        (ledger.provenRouteStates as string[]).push(absent);
      },
    });
    const { failures } = await runRouteGate(root);
    expect(failures).toContain(
      `proven route state: recorded in docs/route-divergence.json but no longer present: ${absent}`,
    );
  });

  it("fails loudly rather than passing when the walkers find nothing", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "route-gate-empty-"));
    temporaryRoots.push(root);
    mkdirSync(path.join(root, "docs"));
    mkdirSync(path.join(root, "src/app"), { recursive: true });
    mkdirSync(path.join(root, "supabase/migrations"), { recursive: true });
    mkdirSync(path.join(root, "e2e"));
    writeFileSync(
      path.join(root, "docs/route-register.json"),
      JSON.stringify({ routes: [], stateProfiles: {}, storagePrefixes: [] }),
    );
    writeFileSync(path.join(root, "docs/route-divergence.json"), JSON.stringify({}));
    writeFileSync(path.join(root, "next.config.ts"), "export default {};\n");
    const { failures } = await runRouteGate(root);
    // An empty scan reports nothing wrong with the product, which is exactly
    // the failure mode the floor guards exist to catch.
    expect(failures.join("\n")).toContain("route walker found 0 built routes");
    expect(failures.join("\n")).toContain("migration walker found 0 files");
    expect(failures.join("\n")).toContain("browser test walker found 0 titles");
    expect(failures.join("\n")).toContain("kind check compared 0 concrete paths");
    expect(failures.length).toBeGreaterThanOrEqual(7);
  });
});

describe("the detectors the gate is built from", () => {
  it("reads every export form Next.js accepts for a verb", () => {
    expect(exportedMethods("export async function POST(request: Request) {}")).toEqual(["POST"]);
    expect(exportedMethods("export const GET = handler;")).toEqual(["GET"]);
    expect(exportedMethods("const DELETE = handler;\nexport { DELETE };")).toEqual(["DELETE"]);
    expect(exportedMethods("export const maxDuration = 300;\nexport async function GET() {}")).toEqual(["GET"]);
    // A name that merely contains a verb is not an export of it.
    expect(exportedMethods("export function GETTER() {}\nexport const POSTED = 1;")).toEqual([]);
  });

  it("reads every bucket a multi-row insert creates", () => {
    expect(
      createdBuckets(
        "insert into storage.buckets (id, name, public)\nvalues\n  ('one', 'one', false),\n  ('two', 'two', false)\non conflict (id) do nothing;",
      ),
    ).toEqual(["one", "two"]);
    expect(createdBuckets("select id from storage.buckets;")).toEqual([]);
  });

  it("requires the path and the state to be whole, separate tokens", () => {
    expect(titleProves("/files complete: download a prepared original", "/files", "complete")).toBe(true);
    // The state that is a prefix of a longer word is a different state.
    expect(titleProves("/files empty-history: return through browser Back", "/files", "empty")).toBe(false);
    // A path that continues is a different route.
    expect(titleProves("/files/[id] complete: open one file", "/files", "complete")).toBe(false);
    // A state id that appears only inside the path proves nothing about it.
    expect(titleProves("/genome/[subject]/error opens", "/genome/[subject]/error", "error")).toBe(false);
    expect(titleProves("/files: no state named here", "/files", "complete")).toBe(false);
  });

  it("fails when the brief changes and the register's pin does not follow", async () => {
    // The pin exists so that editing the brief without revisiting the register
    // is caught. It had never been compared to anything until 2026-09-11, and
    // the value it held named no file that has ever existed here.
    const root = plant({ brief: (source) => `${source}\nA sentence the register was never derived from.\n` });
    const failures = (await runRouteGate(root)).failures;
    expect(failures.some((failure) => failure.startsWith("brief pin:"))).toBe(true);
  });

  it("fails when the pin names a file that does not exist, which is how it shipped", async () => {
    const root = plant({
      register: (register) => {
        register.briefSha256 = "2914f42bba3ccdb34816f07c23b4cffdee14f3328b4fa5f2a0f231133be9abbe";
      },
    });
    const failures = (await runRouteGate(root)).failures;
    expect(failures.some((failure) => failure.includes("2914f42bba3ccdb34816f07c23b4cffdee14f3328b4fa5f2a0f231133be9abbe"))).toBe(true);
  });
});
