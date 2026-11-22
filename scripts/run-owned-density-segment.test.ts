import { describe, expect, it } from "vitest";
import { densityOwnedSegmentFrameSchema } from "./run-owned-density-segment.mjs";

const frame = () => ({ version: 1, selection: { routeId: "embryos.index", state: "empty", viewport: "390x844" },
  output: "/home/runner/fresh-owner/capture", freshPublicObservationDirectory: "/home/runner/fresh-owner/native-observations",
  fontManifestPath: "/home/runner/current-font-manifest.json", fontManifestSha256: "a".repeat(64), prepare: false });

describe("closed public owned density segment frame", () => {
  it("admits one complete public selection without credential or borrowed ownership fields", () => {
    const input = frame(); expect(densityOwnedSegmentFrameSchema.parse(input)).toEqual(input);
  });
  it.each([
    (x: ReturnType<typeof frame>) => Object.assign(x, { credential: "private-never-forwarded" }),
    (x: ReturnType<typeof frame>) => Object.assign(x, { nativeClosed: true }),
    (x: ReturnType<typeof frame>) => Object.assign(x.selection, { extra: true }),
    (x: ReturnType<typeof frame>) => { x.selection.viewport = "391x844"; },
    (x: ReturnType<typeof frame>) => { x.output = "relative/capture"; },
    (x: ReturnType<typeof frame>) => { x.output = "/home/runner/fresh-owner/../capture"; },
    (x: ReturnType<typeof frame>) => { x.fontManifestSha256 = "not-a-full-sha"; },
    (x: ReturnType<typeof frame>) => Reflect.deleteProperty(x, "freshPublicObservationDirectory"),
    (x: ReturnType<typeof frame>) => Object.assign(x, { prepare: "true" }),
  ])("refuses unknown authority, incomplete metadata or malformed selection %#", change => {
    const input = frame(); change(input); expect(() => densityOwnedSegmentFrameSchema.parse(input)).toThrow();
  });
});

describe("the owned density segment command line", async () => {
  const { createHash } = await import("node:crypto");
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const { parseOwnedDensitySegmentArguments, runOwnedDensitySegmentCommand } = await import("./run-owned-density-segment.mjs");
  const owner = { version: 1, nonce: "00000000-0000-4000-8000-000000000001", bootId: "00000000-0000-4000-8000-000000000002",
    head: "a".repeat(40), root: "/home/runner/inherit", scratch: "/home/runner/fresh-owner", dockerSocket: "/var/run/docker.sock" };
  const encoded = Buffer.from(JSON.stringify(owner), "utf8").toString("base64url");
  const { afterAll } = await import("vitest"), made: string[] = [];
  afterAll(() => made.forEach(directory => fs.rmSync(directory, { recursive: true, force: true })));
  const packet = () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "density-originals-")); made.push(directory);
    const file = path.join(directory, "baseline-originals.json"), bytes = Buffer.from('{"version":1}\n');
    fs.writeFileSync(file, bytes, { mode: 0o600 });
    return { directory, file, bytes, sha: createHash("sha256").update(bytes).digest("hex") };
  };

  it("admits --owner alone, and the pinned packet with its sha256 in either order", () => {
    expect(parseOwnedDensitySegmentArguments(["--owner", encoded])).toEqual({ owner });
    const pinned = packet();
    const expected = { owner, baselineOriginals: { directory: pinned.directory, packetBytes: pinned.bytes.length, packetSha256: pinned.sha } };
    expect(parseOwnedDensitySegmentArguments(["--owner", encoded, "--baseline-originals", pinned.file,
      "--baseline-originals-sha256", pinned.sha])).toEqual(expected);
    expect(parseOwnedDensitySegmentArguments(["--baseline-originals-sha256", pinned.sha, "--baseline-originals", pinned.file,
      "--owner", encoded])).toEqual(expected);
  });

  it("calls runOwnedDensitySegment(owner, { baselineOriginals }) with exactly what was pinned", async () => {
    const pinned = packet(), calls: unknown[][] = [];
    const run = (async (...args: unknown[]) => { calls.push(args); return { ran: true }; }) as never;
    await expect(runOwnedDensitySegmentCommand(["--owner", encoded], run)).resolves.toEqual({ ran: true });
    await runOwnedDensitySegmentCommand(["--owner", encoded, "--baseline-originals", pinned.file,
      "--baseline-originals-sha256", pinned.sha], run);
    expect(calls).toEqual([[owner], [owner, { baselineOriginals: { directory: pinned.directory,
      packetBytes: pinned.bytes.length, packetSha256: pinned.sha } }]]);
  });

  it.each([
    ["no arguments", () => []],
    ["the owner flag without its value", () => ["--owner"]],
    ["the old positional form with a trailing flag", () => ["--owner", encoded, "--prepare"]],
    ["an unknown flag", (x: ReturnType<typeof packet>) => ["--owner", encoded, "--baseline", x.file]],
    ["a repeated owner", () => ["--owner", encoded, "--owner", encoded]],
    ["no owner", (x: ReturnType<typeof packet>) => ["--baseline-originals", x.file, "--baseline-originals-sha256", x.sha]],
    ["a non-canonical owner encoding", () => ["--owner", `${encoded}=`]],
    ["a packet without its sha256", (x: ReturnType<typeof packet>) => ["--owner", encoded, "--baseline-originals", x.file]],
    ["a sha256 without its packet", (x: ReturnType<typeof packet>) => ["--owner", encoded, "--baseline-originals-sha256", x.sha]],
    ["an upper-case sha256", (x: ReturnType<typeof packet>) => ["--owner", encoded, "--baseline-originals", x.file,
      "--baseline-originals-sha256", x.sha.toUpperCase()]],
    ["a short sha256", (x: ReturnType<typeof packet>) => ["--owner", encoded, "--baseline-originals", x.file,
      "--baseline-originals-sha256", x.sha.slice(1)]],
    ["a different packet sha256", (x: ReturnType<typeof packet>) => ["--owner", encoded, "--baseline-originals", x.file,
      "--baseline-originals-sha256", "0".repeat(64)]],
    ["a relative packet path", (x: ReturnType<typeof packet>) => ["--owner", encoded, "--baseline-originals",
      path.relative(process.cwd(), x.file), "--baseline-originals-sha256", x.sha]],
    ["an unnormalized packet path", (x: ReturnType<typeof packet>) => ["--owner", encoded, "--baseline-originals",
      `${x.directory}/../${path.basename(x.directory)}/baseline-originals.json`, "--baseline-originals-sha256", x.sha]],
    ["the directory instead of the packet", (x: ReturnType<typeof packet>) => ["--owner", encoded, "--baseline-originals",
      x.directory, "--baseline-originals-sha256", x.sha]],
    ["a packet under another name", (x: ReturnType<typeof packet>) => {
      const renamed = path.join(x.directory, "originals.json"); fs.renameSync(x.file, renamed);
      return ["--owner", encoded, "--baseline-originals", renamed, "--baseline-originals-sha256", x.sha]; }],
    ["a value that is another flag", () => ["--owner", encoded, "--baseline-originals", "--baseline-originals-sha256"]],
  ])("refuses %s before any runtime is established", async (_name, args) => {
    const calls: unknown[] = [], run = (async (...input: unknown[]) => { calls.push(input); }) as never;
    const argv = (args as (x: ReturnType<typeof packet>) => string[])(packet());
    expect(() => parseOwnedDensitySegmentArguments(argv)).toThrow();
    await expect(runOwnedDensitySegmentCommand(argv, run)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it.each([
    ["a group-readable packet", (x: ReturnType<typeof packet>) => fs.chmodSync(x.file, 0o640)],
    ["a world-listable directory", (x: ReturnType<typeof packet>) => fs.chmodSync(x.directory, 0o755)],
    ["a linked packet", (x: ReturnType<typeof packet>) => {
      const real = path.join(x.directory, "real.json"); fs.renameSync(x.file, real); fs.symlinkSync(real, x.file); }],
    ["a hard-linked packet", (x: ReturnType<typeof packet>) => fs.linkSync(x.file, path.join(x.directory, "copy.json"))],
    ["an empty packet", (x: ReturnType<typeof packet>) => { fs.writeFileSync(x.file, ""); x.sha = createHash("sha256").update("").digest("hex"); }],
    ["a packet over 1 MiB", (x: ReturnType<typeof packet>) => {
      const bytes = Buffer.alloc(1024 * 1024 + 1, 32); fs.writeFileSync(x.file, bytes); x.sha = createHash("sha256").update(bytes).digest("hex"); }],
  ])("refuses %s", (_name, change) => {
    const pinned = packet(); change(pinned);
    expect(() => parseOwnedDensitySegmentArguments(["--owner", encoded, "--baseline-originals", pinned.file,
      "--baseline-originals-sha256", pinned.sha])).toThrow();
  });
});
