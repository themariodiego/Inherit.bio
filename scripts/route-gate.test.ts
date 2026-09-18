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
  dispositions?: (ledger: Record<string, unknown>) => void;
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

  const dispositions = JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, "docs/route-dispositions.json"), "utf8"));
  overrides.dispositions?.(dispositions);
  writeFileSync(path.join(root, "docs/route-dispositions.json"), JSON.stringify(dispositions));

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
    // 288 -> 226 -> 216 -> 213 on 2026-09-12: corrections item 4 took `error` off
    // nine `stateProfiles`; then `consent-required` and `jurisdiction-unavailable`
    // came off `account-management`; then `/files`, `/files/upload` and
    // `/copilot/[scope]` moved to `own-product-result`, which is `product-result`
    // without `jurisdiction-unavailable`. 213 -> 162 on 2026-09-13: corrections
    // items 6, 8 and 10, five profiles giving a state up wholesale and 26 routes
    // waiving one their profile keeps. 162 -> 155 on 2026-09-13: G2.2 amended
    // (D-108), and the seven Family and Embryo routes that declared
    // consent-required with nothing to require stopped declaring it. 155 -> 156
    // on 2026-09-14: the ninth state id, `awaiting-choice`, supported on
    // `product-result` and waived on the thirteen routes of that profile which
    // are not /overview, so it adds exactly the one pair it names. 156 -> 152
    // on 2026-09-18 (evening): four owner-signed waivers on states the product
    // cannot render as a distinct page (the ancestry page's partial-coverage,
    // the data page's not-covered, the Family hub's not-covered and
    // partial-coverage), each with its reason beside it in the register. Pinned
    // exactly rather than as a floor, so
    // a profile quietly losing a state fails here instead of reading as progress.
    expect(result.requiredStateCount).toBe(152);
    expect(result.browserTestTitleCount).toBeGreaterThan(100);
    // The 34 routes src/app served at the baseline commit, measured by git
    // ls-tree and recorded in docs/route-dispositions.json: 27 kept, 7
    // redirects, none gone. Pinned exactly, so a route quietly leaving the
    // ledger fails here rather than reading as a cleaner product.
    expect(result.preExistingRouteCount).toBe(34);
  });

  /**
   * A route may waive a state its profile supports (`notApplicableStates`).
   * That is an exemption mechanism, so these three are the whole reason it is
   * allowed to exist: a waiver must waive something, must say why, and must
   * not waive the one n/a G2.2 forbids outright.
   */
  it("fails when a route waives a state its profile does not support", async () => {
    const root = plant({
      register: (register) => {
        const route = (register.routes as Route[]).find((entry) => entry.id === "settings.people")!;
        (route as Route & { notApplicableStates: Record<string, string> })
          .notApplicableStates["jurisdiction-unavailable"] = "A reason long enough to pass the length check.";
      },
    });
    const { failures } = await runRouteGate(root);
    expect(failures).toContain(
      "route state exemption: /settings/people waives jurisdiction-unavailable, which its " +
        "account-management profile does not support. A waiver with nothing to waive is a " +
        "stale exemption; remove it.",
    );
  });

  it("fails when a route waives a state without writing down why", async () => {
    const root = plant({
      register: (register) => {
        const route = (register.routes as Route[]).find((entry) => entry.id === "settings.people")!;
        (route as Route & { notApplicableStates: Record<string, string> })
          .notApplicableStates.complete = "not built";
      },
    });
    const { failures } = await runRouteGate(root);
    expect(failures).toContain(
      "route state exemption: /settings/people waives complete without saying why. " +
        "An exemption whose reason nobody wrote down is one nobody can review.",
    );
  });

  /**
   * G2.2's consent prohibition was a blanket until 2026-09-13 and is now
   * three named exceptions (D-108). These four hold the amendment to its
   * width: a waiver still fails unless the register says WHICH case applies,
   * an item-level claim has to name what carries the refusal instead, and an
   * exception that excepts nothing is a stale exemption.
   */
  it("fails when a Family route waives consent-required without claiming a G2.2 exception", async () => {
    const root = plant({
      register: (register) => {
        const route = (register.routes as Route[]).find((entry) => entry.id === "family.health-picture")!;
        (route as Route & { notApplicableStates?: Record<string, string> }).notApplicableStates = {
          "consent-required": "The page never renders a consent refusal, measured 2026-09-11.",
        };
      },
    });
    const { failures } = await runRouteGate(root);
    expect(failures).toContain(
      "route state exemption: /family/health-picture waives consent-required without claiming one of " +
        "G2.2's exceptions (item-level, consent-is-given-here, reads-no-consent). On a Family or Embryo " +
        "Analysis route the prohibition holds unless the register says which case applies.",
    );
  });

  it("fails when the claimed exception is not one G2.2 names", async () => {
    const root = plant({
      register: (register) => {
        const route = (register.routes as Route[]).find((entry) => entry.id === "family.invite")!;
        (route as Route & { consentRequiredException: { kind: string } }).consentRequiredException.kind =
          "the-page-is-only-a-form";
      },
    });
    const { failures } = await runRouteGate(root);
    expect(failures.join("\n")).toContain("/family/invite waives consent-required without claiming one of");
  });

  it("fails when an item-level claim does not name what carries the refusal", async () => {
    const root = plant({
      register: (register) => {
        const route = (register.routes as Route[]).find((entry) => entry.id === "family.index")!;
        delete (route as Route & { consentRequiredException: { carriedBy?: string } }).consentRequiredException.carriedBy;
      },
    });
    const { failures } = await runRouteGate(root);
    expect(failures).toContain(
      "route state exemption: /family claims G2.2's item-level exception without naming what carries " +
        "the refusal instead. An item-level claim is only reviewable if it says which item state a " +
        "reader meets in its place.",
    );
  });

  it("fails when an exception is left behind on a route that no longer waives the state", async () => {
    const root = plant({
      register: (register) => {
        const route = (register.routes as Route[]).find((entry) => entry.id === "family.invite")!;
        delete (route as Route & { notApplicableStates?: Record<string, string> }).notApplicableStates!["consent-required"];
      },
    });
    const { failures } = await runRouteGate(root);
    expect(failures).toContain(
      "route state exemption: /family/invite carries a consentRequiredException but does not waive " +
        "consent-required. An exception with nothing to except is a stale exemption; remove it.",
    );
  });

  /**
   * D-083: five routes require a jurisdiction attestation version and hash
   * that nothing can produce, because `policy.jurisdiction` does not exist.
   * The owner chose to record that rather than author a legal artifact to
   * satisfy a field — and a record nothing checks is a sentence, so it is
   * compared both ways.
   */
  it("fails when a sixth route declares the attestation fields without recording it", async () => {
    const root = plant({
      register: (register) => {
        const route = (register.routes as (Route & { requestContract?: unknown })[])
          .find((entry) => entry.id === "api.browse-region")!;
        route.requestContract = { closedBody: { jurisdictionAttestationHash: "lowercase-sha256" } };
      },
    });
    const { failures } = await runRouteGate(root);
    expect(failures).toContain(
      "unhashable attestation field: not recorded in docs/route-divergence.json: " +
        "api.browse-region jurisdictionAttestationHash",
    );
  });

  it("fails when a recorded attestation row outlives the field it records", async () => {
    const root = plant({
      ledger: (ledger) => {
        (ledger.unhashableAttestationFields as { routeId: string; fields: string[] }[]).push({
          routeId: "api.browse-region",
          fields: ["jurisdictionAttestationVersion", "jurisdictionAttestationHash"],
        });
      },
    });
    const { failures } = await runRouteGate(root);
    expect(failures).toContain(
      "unhashable attestation field: recorded in docs/route-divergence.json but no longer present: " +
        "api.browse-region jurisdictionAttestationHash+jurisdictionAttestationVersion",
    );
  });

  /**
   * Corrections item 11: eight ids were counted by the ratchet and defined
   * nowhere, so precedent supplied the meanings and supplied four for
   * `complete` alone. These three keep the definitions and the ids in step.
   */
  it("fails when a state id has no definition", async () => {
    const root = plant({
      register: (register) => {
        delete (register.stateDefinitions as Record<string, unknown>)["not-covered"];
      },
    });
    const { failures } = await runRouteGate(root);
    expect(failures).toContain(
      "state definition: `not-covered` is in stateIds with no definition worth the name. " +
        "An id the ratchet counts and nobody has defined is how one column came to mean four things.",
    );
  });

  it("fails when a named reading does not say where it applies", async () => {
    const root = plant({
      register: (register) => {
        const complete = (register.stateDefinitions as Record<string, { readings: { where: string }[] }>).complete;
        complete.readings[0].where = "   ";
      },
    });
    const { failures } = await runRouteGate(root);
    expect(failures.join("\n")).toContain("names the reading \"complete-for-the-question\" without saying where it applies");
  });

  // The planted id was `awaiting-choice` until 2026-09-14, when that became a
  // real state id and the defect stopped biting. The fixture now uses a name
  // no register could plausibly adopt, so the next id to be added does not
  // quietly disarm this check the way the last one did.
  it("fails when a definition outlives the id it defines", async () => {
    const root = plant({
      register: (register) => {
        (register.stateDefinitions as Record<string, unknown>)["renamed-away-v0"] = {
          means: "A definition for an id that nothing declares, left behind by a rename.",
        };
      },
    });
    const { failures } = await runRouteGate(root);
    expect(failures).toContain(
      "state definition: `renamed-away-v0` is defined but is not a state id. " +
        "Remove it, or the register describes a column that does not exist.",
    );
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

type Disposition = { path: string; registerId: string; kind: string; adr?: string;
  disposition: "kept" | "gone" | { redirect: string; expectedStatus?: number } };

/**
 * Check 6 (G2.3). The ledger of pre-existing routes is an exemption-shaped
 * thing — a list that says "these old URLs are accounted for" — so each way
 * it could go stale or lie is planted here: a route the register lost, a
 * page route retired outright, a redirect pointed somewhere the register does
 * not name, a kept entry the register has turned into a redirect, and a gone
 * endpoint with no ADR and no handler left to answer 410.
 */
describe("the route gate holds every pre-existing route to its registered disposition", () => {
  const dispositionsOf = (ledger: Record<string, unknown>) => ledger.routes as Disposition[];

  it("fails when the ledger names a route the register does not carry", async () => {
    const root = plant({
      dispositions: (ledger) => dispositionsOf(ledger).push({ path: "/nowhere", registerId: "legacy.nowhere", kind: "page", disposition: "kept" }),
    });
    const { failures } = await runRouteGate(root);
    expect(failures).toContain(
      "pre-existing route: /nowhere is not in the register. G2.3 requires every route " +
        "the baseline served to be registered with exactly one disposition.",
    );
  });

  it("fails when a pre-existing page route is marked gone", async () => {
    const root = plant({
      dispositions: (ledger) => { dispositionsOf(ledger).find((entry) => entry.path === "/about")!.disposition = "gone"; },
    });
    const { failures } = await runRouteGate(root);
    expect(failures).toContain(
      "pre-existing route: /about is a page route marked gone; G2.3 allows gone only for API handlers, " +
        "form endpoints and storage prefixes with no successor, and a pre-existing page route is kept or redirected",
    );
  });

  it("fails when a redirect's successor is not the one the register names", async () => {
    const root = plant({
      dispositions: (ledger) => { dispositionsOf(ledger).find((entry) => entry.path === "/dashboard")!.disposition = { redirect: "/files", expectedStatus: 308 }; },
    });
    const { failures } = await runRouteGate(root);
    expect(failures).toContain(
      "pre-existing route: /dashboard redirects to /files in the ledger; the register names /overview",
    );
  });

  it("fails when the ledger keeps a route the register redirects, and the reverse", async () => {
    const root = plant({
      dispositions: (ledger) => {
        dispositionsOf(ledger).find((entry) => entry.path === "/dashboard")!.disposition = "kept";
        dispositionsOf(ledger).find((entry) => entry.path === "/about")!.disposition = { redirect: "/overview" };
      },
    });
    const { failures } = await runRouteGate(root);
    expect(failures).toContain(
      'pre-existing route: /dashboard is kept in the ledger; the register says {"redirectToRoute":"app.overview"}',
    );
    expect(failures).toContain("pre-existing route: /about redirects in the ledger; the register kind is page");
  });

  it("fails when a gone endpoint carries no ADR, and when the register still keeps it", async () => {
    const root = plant({
      dispositions: (ledger) => { dispositionsOf(ledger).find((entry) => entry.path === "/api/jobs/annotation-refresh")!.disposition = "gone"; },
    });
    const { failures } = await runRouteGate(root);
    expect(failures).toContain("pre-existing route: /api/jobs/annotation-refresh is gone without an ADR; G2.3 requires one");
    expect(failures).toContain('pre-existing route: /api/jobs/annotation-refresh is gone in the ledger; the register says "kept"');
  });

  it("fails when the ledger has lost most of its routes", async () => {
    const root = plant({
      dispositions: (ledger) => { ledger.routes = dispositionsOf(ledger).slice(0, 3); },
    });
    const { failures } = await runRouteGate(root);
    expect(failures).toContain("docs/route-dispositions.json lists 3 pre-existing routes, expected at least 30");
  });
});

/**
 * The corrections document carries a table of where the unproven pairs stand,
 * and its first version said the table "moves on its own as the ratchet does".
 * Numbers typed into markdown do not move on their own: two proofs later it
 * said 95 while the register said 93. This is what makes the sentence true.
 *
 * It pins the three figures a reader would act on, not the whole table. The
 * per-state breakdown below them depends on which pairs each proposal covers,
 * which lives in prose and cannot be recomputed from the register — so it is
 * left to the document, and this test does not pretend to check it.
 */
describe("the corrections table agrees with the register it claims to be counted from", () => {
  const document = readFileSync(path.join(REPOSITORY_ROOT, "docs/protocol/brief-corrections-proposed.md"), "utf8");
  const register = JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, "docs/route-register.json"), "utf8")) as {
    routes: { path: string; stateProfile?: string; notApplicableStates?: Record<string, string> }[];
    stateProfiles: Record<string, { supported?: string[] }>;
  };
  const ledger = JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, "docs/route-divergence.json"), "utf8")) as {
    provenRouteStates?: string[];
  };
  /** The same arithmetic the gate does, from the same two files. */
  const proven = new Set(ledger.provenRouteStates ?? []);
  let unproven = 0;
  for (const route of register.routes) {
    for (const state of register.stateProfiles[route.stateProfile ?? ""]?.supported ?? []) {
      if (state in (route.notApplicableStates ?? {})) continue;
      if (!proven.has(`${route.path} ${state}`)) unproven += 1;
    }
  }
  it("states the current total in its heading and its total row", () => {
    expect(unproven, "the register must hold at least one unproven pair for this to mean anything").toBeGreaterThan(0);
    expect(document).toContain(`## Where the ${unproven} unproven pairs stand`);
    expect(document).toContain(`| **Total unproven** | **${unproven}** | |`);
  });

  /**
   * Until 2026-09-13 the open count was the total less the pairs a signature
   * could still retire, and that difference is now zero: items 6, 8, 10 and 13
   * are applied and no pair waits on a register correction. The invariant that
   * replaces it is the stronger one — every unproven pair is genuinely open —
   * and it fails the moment someone writes a row implying a correction could
   * move this number again.
   */
  it("states an open count equal to the total, because no pair waits on a correction", () => {
    expect(document).toContain(`| **Genuinely open** | **${unproven}** |`);
    expect(document).toContain(`### And of the ${unproven} that are open,`);
    expect(document).toContain("Nothing in this number is a register correction any more.");
  });
});
