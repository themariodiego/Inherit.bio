import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { requiredDensityCaptures, type DensityRegister } from "./density-current";
import { densitySegmentDirectories, densitySegmentDirectoryName, densitySegmentUnionRefusal, observeCheckoutSource,
  parseDensitySegmentUnionArguments, runDensitySegmentUnionCommand } from "./run-density-segment-union.mjs";

const root = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const register = JSON.parse(fs.readFileSync(path.join(root, "docs/route-register.json"), "utf8")) as DensityRegister;
const contract = JSON.parse(fs.readFileSync(path.join(root, "docs/density-baseline.json"), "utf8"));
const required = requiredDensityCaptures(register);
const made: string[] = [];
afterAll(() => made.forEach(directory => fs.rmSync(directory, { recursive: true, force: true })));
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const source = { head: "b".repeat(40), tree: "c".repeat(40), registerSha256: sha(fs.readFileSync(path.join(root, "docs/route-register.json"))) };

/** A fresh host layout: 348 private segment directories, a font manifest and an output path. */
function host(complete = true) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "density-union-")); made.push(base);
  const segments = path.join(base, "segments"); fs.mkdirSync(segments, { mode: 0o700 });
  if (complete) for (const row of required) {
    const name = densitySegmentDirectoryName(row.route.id, row.state, row.viewport);
    fs.mkdirSync(path.join(segments, name), { mode: 0o700 });
    fs.writeFileSync(path.join(segments, name, `${name}.json`), "{}", { mode: 0o600 });
  }
  const font = path.join(base, "font-manifest.json"); fs.writeFileSync(font, '{"fonts":[]}\n', { mode: 0o600 });
  const output = path.join(base, "union.json");
  return { base, segments, font, fontSha: sha(fs.readFileSync(font)), output,
    argv: ["--segments", segments, "--font-manifest", font, "--font-manifest-sha256", sha(fs.readFileSync(font)), "--output", output] };
}
const set = (argv: string[], flag: string, value: string) => argv.map((item, index) => argv[index - 1] === flag ? value : item);

describe("the density segment union command line", () => {
  it("names each segment directory by the stem of its own capture files, one per required capture", () => {
    const names = required.map(row => densitySegmentDirectoryName(row.route.id, row.state, row.viewport));
    expect(required).toHaveLength(348);
    expect(new Set(names).size).toBe(348);
    expect(densitySegmentDirectoryName("public.home", "complete", "390x844"))
      .toBe(`${sha(JSON.stringify(["public.home", "complete"]))}__390x844`);
  });

  it("admits the four required flags in any order", () => {
    const layout = host(false);
    const parsed = { segments: layout.segments, fontManifestPath: layout.font, fontManifestSha256: layout.fontSha, output: layout.output };
    expect(parseDensitySegmentUnionArguments(layout.argv, root)).toEqual(parsed);
    const reversed = [6, 4, 2, 0].flatMap(index => [layout.argv[index], layout.argv[index + 1]]);
    expect(parseDensitySegmentUnionArguments(reversed, root)).toEqual(parsed);
  });

  it.each([
    ["no arguments", () => []],
    ["a missing output", (x: ReturnType<typeof host>) => x.argv.slice(0, 6)],
    ["a repeated flag in place of another", (x: ReturnType<typeof host>) => [...x.argv.slice(0, 6), "--segments", x.segments]],
    ["an unknown flag", (x: ReturnType<typeof host>) => [...x.argv.slice(0, 6), "--out", x.output]],
    ["a value that is another flag", (x: ReturnType<typeof host>) => set(x.argv, "--output", "--segments")],
    ["an upper-case font sha256", (x: ReturnType<typeof host>) => set(x.argv, "--font-manifest-sha256", x.fontSha.toUpperCase())],
    ["a different font manifest", (x: ReturnType<typeof host>) => set(x.argv, "--font-manifest-sha256", "0".repeat(64))],
    ["a relative segments path", (x: ReturnType<typeof host>) => set(x.argv, "--segments", path.relative(process.cwd(), x.segments))],
    ["an unnormalized segments path", (x: ReturnType<typeof host>) => set(x.argv, "--segments", `${x.base}/./segments`)],
    ["segments inside the checkout", (x: ReturnType<typeof host>) => set(x.argv, "--segments", path.join(root, "scripts"))],
    ["an output inside the checkout", (x: ReturnType<typeof host>) => set(x.argv, "--output", path.join(root, "union.json"))],
    ["an output inside the segments", (x: ReturnType<typeof host>) => set(x.argv, "--output", path.join(x.segments, "union.json"))],
    ["an output that is not .json", (x: ReturnType<typeof host>) => set(x.argv, "--output", path.join(x.base, "union.txt"))],
    ["an output that already exists", (x: ReturnType<typeof host>) => { fs.writeFileSync(x.output, ""); return x.argv; }],
    ["an output that is a dangling link", (x: ReturnType<typeof host>) => { fs.symlinkSync(path.join(x.base, "gone"), x.output); return x.argv; }],
    ["a segments directory others can list", (x: ReturnType<typeof host>) => { fs.chmodSync(x.segments, 0o755); return x.argv; }],
    ["a linked segments directory", (x: ReturnType<typeof host>) => {
      const link = path.join(x.base, "linked"); fs.symlinkSync(x.segments, link); return set(x.argv, "--segments", link); }],
    ["a linked font manifest", (x: ReturnType<typeof host>) => {
      const link = path.join(x.base, "font-link.json"); fs.symlinkSync(x.font, link); return set(x.argv, "--font-manifest", link); }],
  ])("refuses %s before reading any segment", async (_name, change) => {
    const layout = host(false), argv = (change as (x: ReturnType<typeof host>) => string[])(layout);
    const calls: unknown[] = [];
    expect(() => parseDensitySegmentUnionArguments(argv, root)).toThrow();
    await expect(runDensitySegmentUnionCommand(argv, { root, observeSource: async () => source,
      aggregate: (async (input: unknown) => { calls.push(input); }) as never })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("the segment directory census", () => {
  it("returns the 348 directories in the register's required order", () => {
    const layout = host();
    expect(densitySegmentDirectories(layout.segments, register)).toEqual(required.map(row =>
      path.join(layout.segments, densitySegmentDirectoryName(row.route.id, row.state, row.viewport))));
  });
  it.each([
    ["a missing capture", (x: ReturnType<typeof host>, name: string) => fs.rmSync(path.join(x.segments, name), { recursive: true })],
    ["an extra directory", (x: ReturnType<typeof host>) => fs.mkdirSync(path.join(x.segments, `${"d".repeat(64)}__390x844`))],
    ["a stray file", (x: ReturnType<typeof host>) => fs.writeFileSync(path.join(x.segments, "notes.txt"), "")],
    ["a linked segment", (x: ReturnType<typeof host>, name: string) => {
      const moved = path.join(x.base, name); fs.renameSync(path.join(x.segments, name), moved); fs.symlinkSync(moved, path.join(x.segments, name)); }],
    ["a misnamed segment", (x: ReturnType<typeof host>, name: string) =>
      fs.renameSync(path.join(x.segments, name), path.join(x.segments, `${"e".repeat(64)}${name.slice(64)}`))],
    ["a directory whose files are another capture's", (x: ReturnType<typeof host>, name: string) =>
      fs.rmSync(path.join(x.segments, name, `${name}.json`))],
  ])("refuses %s", (_name, change) => {
    const layout = host(), first = densitySegmentDirectoryName(required[0].route.id, required[0].state, required[0].viewport);
    change(layout, first);
    expect(() => densitySegmentDirectories(layout.segments, register)).toThrow();
  });
});

describe("running the union", () => {
  const union = () => ({ version: 1, status: "COMPLETE_SOURCE_BOUND_SEGMENT_UNION_ROOT_CLOSURE_REQUIRED", source, packet: {},
    numeric: { status: "WITHIN_NUMERIC_BUDGETS" }, contractNumeric: { status: "OUTSIDE_CONTRACT_BUDGETS", reason: "x" },
    captures: 348, remainingCaptureCount: 0, resumable: false, g2_5Acceptance: false, requiredActualClosureAdapter: "Root",
    originalFilePins: [], currentPublicSourcePins: [] });

  it("hands aggregateDensitySegmentOriginals the exact census and writes a new private result", async () => {
    const layout = host(), calls: Record<string, unknown>[] = [];
    const observeSource = async () => source;
    const result = await runDensitySegmentUnionCommand(layout.argv, { root, observeSource,
      aggregate: (async (input: Record<string, unknown>) => { calls.push(input); return union(); }) as never });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ root, source, register, contract, fontManifestPath: layout.font, observeSource,
      directories: required.map(row => path.join(layout.segments, densitySegmentDirectoryName(row.route.id, row.state, row.viewport))) });
    const written = fs.readFileSync(layout.output);
    expect(JSON.parse(written.toString("utf8"))).toEqual(union());
    expect(fs.statSync(layout.output).mode & 0o777).toBe(0o600);
    expect(result).toEqual({ version: 1, status: "COMPLETE_SOURCE_BOUND_SEGMENT_UNION_ROOT_CLOSURE_REQUIRED",
      numeric: "WITHIN_NUMERIC_BUDGETS", contractNumeric: "OUTSIDE_CONTRACT_BUDGETS", captures: 348, output: layout.output,
      outputSha256: sha(written), g2_5Acceptance: false,
      next: "Root's closure review of every owner is still required; this union is not acceptance." });
  });

  it.each([
    ["an aggregate refusal", async () => { throw new Error("Density budget exceeded: [\"public.home\",\"complete\",\"1280x800\"]"); }],
    ["a union that claims acceptance", async () => ({ ...union(), g2_5Acceptance: true })],
    ["a union of fewer captures", async () => ({ ...union(), captures: 347 })],
    ["a union that is not the closure HOLD", async () => ({ ...union(), status: "ACCEPTED" })],
  ])("writes nothing for %s", async (_name, aggregate) => {
    const layout = host();
    await expect(runDensitySegmentUnionCommand(layout.argv, { root, observeSource: async () => source,
      aggregate: aggregate as never })).rejects.toThrow();
    expect(fs.existsSync(layout.output)).toBe(false);
  });

  it("refuses a census short of 348 before the union reader is called", async () => {
    const layout = host(), calls: unknown[] = [];
    const first = densitySegmentDirectoryName(required[0].route.id, required[0].state, required[0].viewport);
    fs.rmSync(path.join(layout.segments, first), { recursive: true });
    await expect(runDensitySegmentUnionCommand(layout.argv, { root, observeSource: async () => source,
      aggregate: (async (input: unknown) => { calls.push(input); return union(); }) as never })).rejects.toThrow(/347 of 348/u);
    expect(calls).toEqual([]);
  });

  it("names a breached capture, and nothing else, in a refusal", () => {
    expect(densitySegmentUnionRefusal(new Error("Density budget exceeded: [\"public.home\",\"complete\",\"1280x800\"]")))
      .toBe("Density segment union refused: Density budget exceeded: [\"public.home\",\"complete\",\"1280x800\"]");
    expect(densitySegmentUnionRefusal(new Error("Relative density budget exceeded"))).toBe(
      "Density segment union refused: Relative density budget exceeded");
    for (const error of [new Error("ENOENT: no such file or directory, open '/home/runner/private/x.json'"),
      new Error("Density budget exceeded: [x]\nsecret"), "string", null])
      expect(densitySegmentUnionRefusal(error)).toBe("Density segment union refused; no private values printed");
  });

  it("observes a clean checkout's head, tree and register, and refuses a dirty one", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "density-union-git-")); made.push(base);
    const env = { PATH: process.env.PATH, HOME: base, GIT_CONFIG_NOSYSTEM: "1" } as unknown as NodeJS.ProcessEnv;
    const git = (...args: string[]) => execFileSync("git", args, { cwd: base, env, encoding: "utf8" }).trim();
    git("init", "-q"); fs.mkdirSync(path.join(base, "docs"));
    fs.writeFileSync(path.join(base, "docs/route-register.json"), '{"routes":[]}\n');
    git("add", "."); git("-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "x");
    expect(observeCheckoutSource(base)).toEqual({ head: git("rev-parse", "HEAD"), tree: git("rev-parse", "HEAD^{tree}"),
      registerSha256: sha('{"routes":[]}\n') });
    fs.writeFileSync(path.join(base, "untracked"), "");
    expect(() => observeCheckoutSource(base)).toThrow(/Clean checkout/u);
  });
});

describe("the operator runbook", () => {
  const runbook = fs.readFileSync(path.join(root, "docs/evidence/density-public-corrected-20261022/OPERATOR.md"), "utf8");
  it("lists exactly the 348 required selections, one prepare line, and the 38 compared captures", async () => {
    const { comparableDensityBaseline } = await import("./density-baseline-originals");
    const block = /^```selections\n([\s\S]*?)^```$/mu.exec(runbook)?.[1].trimEnd().split("\n");
    const first = required.findIndex(row => !comparableDensityBaseline(row, contract));
    expect(block).toEqual(required.map((row, index) => [String(index + 1).padStart(3, "0"), row.route.id, row.state, row.viewport,
      densitySegmentDirectoryName(row.route.id, row.state, row.viewport), index === first ? "prepare" : "reuse",
      comparableDensityBaseline(row, contract) ? "compared" : "absolute"].join(" ")));
    expect(block!.filter(line => line.endsWith(" compared"))).toHaveLength(38);
  });
  it("runs both commands with every flag they require, and no other", () => {
    expect(runbook).toContain('"$NODE" --import tsx scripts/run-owned-density-segment.mts --owner "$owner" "${packet[@]}"');
    expect(runbook).toContain('packet=(--baseline-originals "$ORIGINALS" --baseline-originals-sha256 "$ORIGINALS_SHA256")');
    expect(runbook).toContain("env -i PATH=\"$PATH\" HOME=\"$HOME\" LANG=C.UTF-8 NODE_ENV=production TZ=UTC");
    expect(runbook).toContain('fontManifestSha256, freshPublicObservationDirectory, prepare: build === "prepare" }) + "\\n");');
    expect(runbook).toContain("scripts/run-density-segment-union.mts \\\n  --segments \"$SEGMENTS\" --font-manifest \"$FONT_MANIFEST\" "
      + "--font-manifest-sha256 \"$FONT_MANIFEST_SHA256\" \\\n  --output \"$HOME/density-union-$HEAD_SHA.json\"");
  });
});
