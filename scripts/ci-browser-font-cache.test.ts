import { afterEach, describe, expect, it } from "vitest";
import { linkSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { admitAptSupervisorVersion, admitClosedAptUnit, admitFreshAptRefresh, admitOwnedAptUnit, admitRestoredCache, aptArchiveNames, aptResolverOutput, cacheKey, normalizeAptDownloads, publicationAptService, sha256, validateManifest, verifyAptMetadata, verifyCache, type FontManifest, type FontPackage } from "./ci-browser-font-cache";

const original = readFileSync(new URL("../data/ci/browser-font-packages.json", import.meta.url));
const manifest = JSON.parse(original.toString()) as FontManifest;
const directories: string[] = [];
afterEach(() => { for (const p of directories.splice(0)) rmSync(p, { recursive: true, force: true }); });

function fixture() {
  const directory = mkdtempSync(path.join(realpathSync(os.tmpdir()), "font-cache-"));
  directories.push(directory);
  const pins = structuredClone(manifest);
  for (const p of pins.packages) {
    const body = Buffer.from(`synthetic font archive ${p.name}`);
    p.bytes = body.length;
    p.sha256 = sha256(body);
    writeFileSync(path.join(directory, path.basename(p.filename)), body);
  }
  return { directory, pins };
}
function metadata(pin: FontPackage) {
  return `Package: ${pin.name}\nVersion: ${pin.version}\nArchitecture: ${pin.architecture}\nFilename: ${pin.filename}\nSize: ${pin.bytes}\nSHA256: ${pin.sha256}\n`;
}
const policy = (p: FontPackage) => `${p.name}:\n  Installed: (none)\n  Candidate: ${p.version}\n`;
const uris = () => manifest.packages.map((p) => `'http://azure.archive.ubuntu.com/ubuntu/${p.filename}' ${p.name}_${p.version.replace(":", "%3a")}_${p.architecture}.deb ${p.bytes} MD5Sum:unused`).join("\n");

describe("font archive cache admission", () => {
  it("admits the complete nine-file byte-verified cache", () => {
    const { directory, pins } = fixture();
    expect(() => verifyCache(directory, pins)).not.toThrow();
    expect(() => validateManifest(manifest)).not.toThrow();
    expect(manifest.packages.reduce((sum, p) => sum + p.bytes, 0)).toBe(21_086_590);
  });
  it("refuses a cache miss without an archive read", () => {
    const { directory, pins } = fixture();
    rmSync(directory, { recursive: true });
    expect(() => verifyCache(directory, pins)).toThrow();
  });
  it("bypasses primary-key prefix matches, misses and corrupt exact hits before APT authentication", () => {
    const { directory, pins } = fixture();
    let authenticated = 0;
    const authenticate = () => { authenticated++; return "verified"; };
    for (const hit of [undefined, "", "false", "TRUE"]) expect(admitRestoredCache(directory, pins, hit, authenticate).ready).toBe(false);
    expect(authenticated).toBe(0);
    expect(admitRestoredCache(directory, pins, "true", authenticate)).toEqual({ ready: true, value: "verified" });
    expect(authenticated).toBe(1);
    writeFileSync(path.join(directory, path.basename(pins.packages[0].filename)), Buffer.alloc(pins.packages[0].bytes));
    expect(admitRestoredCache(directory, pins, "true", authenticate).ready).toBe(false);
    expect(authenticated).toBe(1);
  });
  it("bypasses an authenticated newer candidate before any seeding", () => {
    const { directory, pins } = fixture();
    const pin = pins.packages[0];
    const result = admitRestoredCache(directory, pins, "true", () => verifyAptMetadata(pin, metadata(pin), policy({ ...pin, version: `${pin.version}+security1` })));
    expect(result.ready).toBe(false);
    if (result.ready) throw new Error("Unexpected candidate-drift admission");
    expect(result.reason).toContain("candidate version drift");
  });
  it("refuses an incomplete set and unexpected additional archive", () => {
    const { directory, pins } = fixture();
    const file = path.join(directory, path.basename(pins.packages[0].filename));
    rmSync(file);
    expect(() => verifyCache(directory, pins)).toThrow(/complete pinned set/);
    writeFileSync(file, Buffer.from(`synthetic font archive ${pins.packages[0].name}`));
    writeFileSync(path.join(directory, "unexpected.deb"), "extra");
    expect(() => verifyCache(directory, pins)).toThrow(/complete pinned set/);
  });
  it("refuses same-size corrupt archive bytes", () => {
    const { directory, pins } = fixture();
    writeFileSync(path.join(directory, path.basename(pins.packages[0].filename)), Buffer.alloc(pins.packages[0].bytes, 0));
    expect(() => verifyCache(directory, pins)).toThrow(/digest mismatch/);
  });
  it("refuses wrong-size archive bytes", () => {
    const { directory, pins } = fixture();
    writeFileSync(path.join(directory, path.basename(pins.packages[0].filename)), "truncated");
    expect(() => verifyCache(directory, pins)).toThrow(/identity\/size/);
  });
  it("refuses symlink and hardlink archives even with matching content", () => {
    const { directory, pins } = fixture();
    const first = path.join(directory, path.basename(pins.packages[0].filename));
    const external = path.join(mkdtempSync(path.join(realpathSync(os.tmpdir()), "font-external-")), "font.deb");
    directories.push(path.dirname(external));
    writeFileSync(external, readFileSync(first));
    rmSync(first); symlinkSync(external, first);
    expect(() => verifyCache(directory, pins)).toThrow(/identity\/size/);
    rmSync(first); linkSync(external, first);
    expect(() => verifyCache(directory, pins)).toThrow(/identity\/size/);
  });
  it("refuses a cache directory symlink", () => {
    const { directory, pins } = fixture();
    const parent = mkdtempSync(path.join(realpathSync(os.tmpdir()), "font-link-")); directories.push(parent);
    const alias = path.join(parent, "cache"); symlinkSync(directory, alias);
    expect(() => verifyCache(alias, pins)).toThrow(/real canonical directory/);
  });
  it("refuses path traversal, a fourth-party package and invalid digests", () => {
    for (const update of [{ filename: "../font.deb" }, { name: "unreviewed-font" }, { sha256: "invented" }]) {
      const pins = structuredClone(manifest); Object.assign(pins.packages[0], update);
      expect(() => validateManifest(pins)).toThrow();
    }
  });
  it("binds exact manifest, frozen dependency lock and Playwright version in the key", () => {
    const key = cacheKey(original, Buffer.from("lock-one"));
    expect(cacheKey(original, Buffer.from("lock-two"))).not.toBe(key);
    const drift = structuredClone(manifest); drift.playwrightVersion = "1.62.2";
    expect(cacheKey(Buffer.from(JSON.stringify(drift)), Buffer.from("lock-one"))).not.toBe(key);
    drift.packages[0].sha256 = "a".repeat(64);
    expect(cacheKey(Buffer.from(JSON.stringify(drift)), Buffer.from("lock-one"))).not.toBe(key);
    expect(key).toMatch(/^font-debs-v1-Linux-noble-amd64-pw1\.62\.1-/);
  });
  it("requires every refreshed signed metadata field to match the pin", () => {
    for (const pin of manifest.packages) expect(() => verifyAptMetadata(pin, metadata(pin), policy(pin))).not.toThrow();
    const pin = manifest.packages[0];
    for (const update of [{ filename: "pool/other.deb" }, { bytes: pin.bytes + 1 }, { sha256: "a".repeat(64) }, { architecture: "arm64" }]) {
      expect(() => verifyAptMetadata(pin, metadata({ ...pin, ...update }), policy(pin))).toThrow(/metadata differs/);
    }
  });
  it("bypasses newer candidates rather than forcing the reviewed old version", () => {
    const pin = manifest.packages[0];
    expect(() => verifyAptMetadata(pin, metadata(pin), policy({ ...pin, version: `${pin.version}+security1` }))).toThrow(/candidate version drift/);
    expect(() => verifyAptMetadata(pin, metadata(pin), `${pin.name}:\n  Candidate: (none)\n`)).toThrow(/candidate version drift/);
  });
  it("requires consistent metadata when multiple authenticated records exist", () => {
    const pin = manifest.packages[0];
    expect(() => verifyAptMetadata(pin, `${metadata(pin)}\n${metadata(pin)}`, policy(pin))).not.toThrow();
    expect(() => verifyAptMetadata(pin, `${metadata(pin)}\n${metadata({ ...pin, sha256: "a".repeat(64) })}`, policy(pin))).toThrow(/metadata differs/);
  });
  it("records original public resolver bytes and outcome before success or refusal", () => {
    const stdout = Buffer.from(uris()), stderr = Buffer.from("public APT warning\n");
    const successful = { stdout, stderr, status: 0, signal: null, errorCode: null };
    const captured: Parameters<typeof aptResolverOutput>[0][] = [];
    const text = aptResolverOutput(successful, (original) => captured.push(original));
    expect(captured).toEqual([successful]);
    expect(captured[0].stdout).toBe(stdout);
    expect(captured[0].stderr).toBe(stderr);
    expect(aptArchiveNames(manifest, text).size).toBe(9);
    for (const failed of [{ ...successful, status: 100 }, { ...successful, status: null, signal: "SIGTERM" },
      { ...successful, status: null, errorCode: "ETIMEDOUT" }, { ...successful, status: null, errorCode: "ENOENT", stdout: null, stderr: null }]) {
      let recorded = false;
      expect(() => aptResolverOutput(failed, (original) => {
        recorded = true;
        expect(original).toBe(failed);
      })).toThrow("APT archive resolution command failed");
      expect(recorded).toBe(true);
    }
    let incompleteOriginal: Buffer | undefined;
    const incomplete = { ...successful, stdout: Buffer.from(uris().split("\n").slice(1).join("\n")) };
    expect(() => aptArchiveNames(manifest, aptResolverOutput(incomplete, (original) => { incompleteOriginal = original.stdout!; })))
      .toThrow("APT did not resolve all nine pinned font archives");
    expect(incompleteOriginal).toBe(incomplete.stdout);
    expect(() => aptResolverOutput(successful, () => { throw new Error("original recording unavailable"); }))
      .toThrow("original recording unavailable");
  });
  it("admits the literal hosted mirror resolver rows with all nine fonts and unchanged dependencies", () => {
    // Original diagnostic run 37885106841/a1, job 113673241670; public resolver stdout.
    const captured = `'mirror+file:/etc/apt/apt-mirrors.txt/pool/universe/f/fonts-ipafont/fonts-ipafont-gothic_00303-21ubuntu1_all.deb' fonts-ipafont-gothic_00303-21ubuntu1_all.deb 3513360 MD5Sum:e55a9bae06be908db5c9bd471b011caf
'mirror+file:/etc/apt/apt-mirrors.txt/pool/universe/f/fonts-ipafont/fonts-ipafont-mincho_00303-21ubuntu1_all.deb' fonts-ipafont-mincho_00303-21ubuntu1_all.deb 4723808 MD5Sum:2abaf43a330644ab620d882c66ea4c93
'mirror+file:/etc/apt/apt-mirrors.txt/pool/main/f/fonts-freefont/fonts-freefont-ttf_20211204%2bsvn4273-2_all.deb' fonts-freefont-ttf_20211204+svn4273-2_all.deb 5640794 MD5Sum:958074efbb58c46ead23be615e1c3502
'mirror+file:/etc/apt/apt-mirrors.txt/pool/universe/f/fonts-tlwg/fonts-tlwg-loma-otf_0.7.3-1_all.deb' fonts-tlwg-loma-otf_1%3a0.7.3-1_all.deb 106786 MD5Sum:89b3ba8a40532ddf97a49c6d402f7054
'mirror+file:/etc/apt/apt-mirrors.txt/pool/main/f/fonts-tlwg/fonts-tlwg-loma_0.7.3-1_all.deb' fonts-tlwg-loma_1%3a0.7.3-1_all.deb 4102 MD5Sum:dfc40ffcd01f43749c311fe33613fa23
'mirror+file:/etc/apt/apt-mirrors.txt/pool/universe/u/unifont/fonts-unifont_15.1.01-1build1_all.deb' fonts-unifont_1%3a15.1.01-1build1_all.deb 2993066 MD5Sum:74f019fdce045563f769a97c507b8108
'mirror+file:/etc/apt/apt-mirrors.txt/pool/universe/f/fonts-wqy-zenhei/fonts-wqy-zenhei_0.9.45-8_all.deb' fonts-wqy-zenhei_0.9.45-8_all.deb 7471624 MD5Sum:63fcb8701d2a908e8e00842dbb317037
'mirror+file:/etc/apt/apt-mirrors.txt/pool/main/x/xfonts-encodings/xfonts-encodings_1.0.5-0ubuntu2_all.deb' xfonts-encodings_1%3a1.0.5-0ubuntu2_all.deb 578092 MD5Sum:b7e27ff04dca332645f9acfcc8492237
'mirror+file:/etc/apt/apt-mirrors.txt/pool/main/x/xfonts-utils/xfonts-utils_7.7%2b6build3_amd64.deb' xfonts-utils_1%3a7.7+6build3_amd64.deb 94438 MD5Sum:13b0675cc33bcd650f3e169c049cf670
'mirror+file:/etc/apt/apt-mirrors.txt/pool/universe/x/xfonts-cyrillic/xfonts-cyrillic_1.0.5%2bnmu1_all.deb' xfonts-cyrillic_1%3a1.0.5+nmu1_all.deb 384312 MD5Sum:0638903c3bc4fad8019615e21d0e5b76
'mirror+file:/etc/apt/apt-mirrors.txt/pool/main/x/xfonts-scalable/xfonts-scalable_1.0.3-1.3_all.deb' xfonts-scalable_1%3a1.0.3-1.3_all.deb 304118 MD5Sum:20641f16466ef2a37741e11bdcbfaad4`;
    const names = aptArchiveNames(manifest, captured);
    expect(names.size).toBe(9);
    for (const pin of manifest.packages) {
      expect(decodeURIComponent(names.get(pin.name)!)).toBe(`${pin.name}_${pin.version}_${pin.architecture}.deb`);
    }
    expect(names.has("fonts-ipafont-mincho")).toBe(false);
    expect(names.has("fonts-tlwg-loma")).toBe(false);
  });
  it("keeps every approved direct HTTP(S) host and decodes its URI filename once", () => {
    for (const protocol of ["http", "https"]) {
      for (const host of ["archive.ubuntu.com", "azure.archive.ubuntu.com", "security.ubuntu.com"]) {
        const direct = uris().replaceAll("http://azure.archive.ubuntu.com", `${protocol}://${host}`)
          .replace("fonts-freefont-ttf_20211204+svn4273-2_all.deb'", "fonts-freefont-ttf_20211204%2bsvn4273-2_all.deb'");
        expect(aptArchiveNames(manifest, direct).size).toBe(9);
      }
    }
  });
  it("refuses altered mirror authority, unsafe encodings and incomplete or duplicate pinned rows", () => {
    const mirror = uris().replaceAll("http://azure.archive.ubuntu.com/ubuntu/", "mirror+file:/etc/apt/apt-mirrors.txt/");
    for (const invalid of [
      mirror.replace("/etc/apt/apt-mirrors.txt/", "/etc/apt/other-mirrors.txt/"),
      mirror.replace("mirror+file:/etc/", "mirror+file://attacker.invalid/etc/"),
      mirror.replace("mirror+file:/etc/", "mirror+file:///etc/"),
      mirror.replace("apt-mirrors.txt/pool/", "apt-mirrors.txt/../apt-mirrors.txt/pool/"),
      mirror.replace("apt-mirrors.txt/pool/", "apt-mirrors.txt/%2e%2e/apt-mirrors.txt/pool/"),
      mirror.replace("20211204+svn4273", "20211204%svn4273"),
      mirror.replace("20211204+svn4273", "20211204%252bsvn4273"),
      mirror.replace("20211204+svn4273", "20211204%2fsvn4273"),
      mirror.replace("20211204+svn4273", "20211204%5csvn4273"),
      mirror.replace("20211204+svn4273", "20211204%00svn4273"),
      mirror.replace("apt-mirrors.txt/pool/", "apt-mirrors.txt/pool%2f"),
      mirror.replace("_all.deb'", "_all.deb?route=other'"),
      mirror.replace("_all.deb'", "_all.deb#other'"),
      mirror.replace("5640794 MD5Sum", "5640795 MD5Sum"),
      mirror.split("\n").slice(1).join("\n"),
      `${mirror}\n${mirror.split("\n")[0]}`,
    ]) expect(() => aptArchiveNames(manifest, invalid)).toThrow();
  });
  it("uses APT's actual epoch-encoded filenames and leaves dependency rows untouched", () => {
    const names = aptArchiveNames(manifest, `${uris()}\n'http://archive.ubuntu.com/ubuntu/pool/main/u/unrelated/unrelated.deb' unrelated.deb 42 MD5Sum:unused`);
    expect(names.size).toBe(9);
    expect(names.get("fonts-unifont")).toBe("fonts-unifont_1%3a15.1.01-1build1_all.deb");
  });
  it("normalizes authenticated APT download filenames without accepting duplicate or corrupt archives", () => {
    const { directory, pins } = fixture();
    const pin = pins.packages[2];
    const canonical = path.join(directory, path.basename(pin.filename));
    const encoded = path.join(directory, `${pin.name}_${pin.version.replace(":", "%3a")}_${pin.architecture}.deb`);
    renameSync(canonical, encoded);
    expect(() => normalizeAptDownloads(directory, pins)).not.toThrow();
    writeFileSync(encoded, readFileSync(canonical));
    expect(() => normalizeAptDownloads(directory, pins)).toThrow(/ambiguous/);
    rmSync(encoded); writeFileSync(canonical, Buffer.alloc(pin.bytes));
    expect(() => normalizeAptDownloads(directory, pins)).toThrow(/digest mismatch/);
  });
  it("refuses incomplete, duplicate, foreign-host and path-escaping APT routes", () => {
    for (const text of [uris().split("\n").slice(1).join("\n"), `${uris()}\n${uris().split("\n")[0]}`, uris().replace("azure.archive.ubuntu.com", "attacker.invalid"), uris().replace("fonts-freefont-ttf_20211204+svn4273-2_all.deb 5640794", "../font.deb 5640794")]) {
      expect(() => aptArchiveNames(manifest, text)).toThrow();
    }
  });
});

describe("bounded publisher signed refresh", () => {
  const unit = `inherit-font-apt-${"a".repeat(32)}.service`;
  const runner = ["ubuntu24", "20261004.327.1", "true", "github-hosted"];
  const absent = "LoadState=not-found\nActiveState=inactive\nSubState=dead\n";
  const owned = `Description=${unit}\nTransient=yes\nUser=root\nGroup=root\nSlice=system.slice\n`;
  const receipt = { decision: "PASS", freshSignedMetadata: true, fullPlaywrightInstallStillRequired: true, originalDirectory: "/var/tmp/inherit-ci-apt-synthetic" };

  it("owns one root service and caps its work below the unchanged command/shared deadlines", () => {
    const service = publicationAptService("/home/runner/source", unit, 210_000, runner);
    expect(service.workSeconds).toBe(155);
    expect(service.timeoutMs).toBe(180_000);
    for (const argument of ["--wait", "--pipe", "--collect", "--expand-environment=no", "--service-type=exec",
      "--property=KillMode=control-group", "--property=TimeoutStopSec=5s", "--property=SendSIGKILL=yes",
      "--property=Restart=no", "--property=User=root", "--property=Group=root", "--property=Delegate=no"])
      expect(service.args).toContain(argument);
    expect(service.args.slice(-6)).toEqual(["/usr/bin/python3", "/home/runner/source/scripts/ci_apt_mirror_priority.py", ...runner]);
    expect(service.args).not.toContain("--scope");
    expect(service.args).not.toContain("--remain-after-exit");
  });
  it("reserves start, five-second root-group settlement and the closed catch path at budget boundaries", () => {
    for (const remaining of [0, 25_000, 210_001, Number.NaN, Number.POSITIVE_INFINITY, 100_000.5])
      expect(() => publicationAptService("/source", unit, remaining, runner)).toThrow(/budget/);
    const near = publicationAptService("/source", unit, 26_000, runner);
    expect(near.workSeconds).toBe(1);
    expect(near.timeoutMs).toBe(11_000);
    expect(near.workSeconds * 1_000 + 10_000 + 15_000).toBe(26_000);
  });
  it("refuses noncanonical or expandable paths, foreign unit names and non-hosted public arguments", () => {
    for (const root of ["relative", "/source/../other", "/source/$HOME", "/source/%n", "/source\nother"])
      expect(() => publicationAptService(root, unit, 210_000, runner)).toThrow(/arguments/);
    for (const name of ["ssh.service", unit.replace("a", "A"), `${unit};other`])
      expect(() => publicationAptService("/source", name, 210_000, runner)).toThrow(/arguments/);
    for (const values of [["ubuntu22", ...runner.slice(1)], [runner[0], "unknown", ...runner.slice(2)],
      [...runner.slice(0, 2), "false", runner[3]], [...runner.slice(0, 3), "self-hosted"], [...runner, "extra"]])
      expect(() => publicationAptService("/source", unit, 210_000, values)).toThrow(/arguments/);
  });
  it("admits only the observed documented supervisor family and retains its complete public version line", () => {
    expect(admitAptSupervisorVersion("systemd 255 (255.4-1ubuntu8.15)\n+PAM\n")).toBe("systemd 255 (255.4-1ubuntu8.15)");
    for (const text of ["systemd 254", "systemd 256", "systemd 255forged", "unknown", `systemd 255\n${"x".repeat(16_384)}`])
      expect(() => admitAptSupervisorVersion(text)).toThrow(/version/);
  });
  it("requires a genuinely absent fresh unit before creation and no cgroup after deactivation", () => {
    expect(() => admitClosedAptUnit(absent, true, true)).not.toThrow();
    expect(() => admitClosedAptUnit(absent.replace("not-found", "loaded"), true)).not.toThrow();
    expect(() => admitClosedAptUnit(absent.replace("not-found", "loaded"), true, true)).toThrow(/closed/);
    for (const text of [absent.replace("inactive", "active"), absent.replace("dead", "running"), `${absent}ActiveState=inactive\n`, absent.replace("SubState=dead\n", "")])
      expect(() => admitClosedAptUnit(text, true)).toThrow();
    expect(() => admitClosedAptUnit(absent, false)).toThrow(/closed/);
  });
  it("permits failure cleanup only for the exact fresh transient root unit", () => {
    expect(() => admitOwnedAptUnit(owned, unit)).not.toThrow();
    for (const text of [owned.replace(unit, "ssh.service"), owned.replace("yes", "no"), owned.replace("User=root", "User=runner"),
      owned.replace("Group=root", "Group=runner"), owned.replace("system.slice", "user.slice"), `${owned}Transient=yes\n`])
      expect(() => admitOwnedAptUnit(text, unit)).toThrow();
  });
  it("requires the exact successful signed-update terminal receipt before archive publication", () => {
    expect(() => admitFreshAptRefresh(`original update log\n${JSON.stringify(receipt)}\n`)).not.toThrow();
    for (const value of [{ ...receipt, decision: "HOLD" }, { ...receipt, freshSignedMetadata: false },
      { ...receipt, fullPlaywrightInstallStillRequired: false }, { ...receipt, originalDirectory: "/etc/apt" },
      { ...receipt, unreviewed: true }, { decision: "PASS" }, null])
      expect(() => admitFreshAptRefresh(JSON.stringify(value))).toThrow();
    expect(() => admitFreshAptRefresh(`${JSON.stringify(receipt)}\nlater non-receipt output`)).toThrow();
    expect(() => admitFreshAptRefresh(JSON.stringify(receipt).replace('"decision":"PASS"', '"decision":"HOLD","decision":"PASS"'))).toThrow();
  });
  it("refuses omitted, substituted or default refresh ownership at the source boundary", () => {
    const cli = readFileSync(new URL("./ci-browser-font-cache.run.mts", import.meta.url), "utf8");
    const assertOwnedRefresh = (text: string) => {
      const source = ts.createSourceFile("font-cache.run.mts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const calls: ts.CallExpression[] = [];
      let declaration: ts.ArrowFunction | undefined;
      const visit = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "authenticate"
          && node.initializer && ts.isArrowFunction(node.initializer)) declaration = node.initializer;
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "authenticate") calls.push(node);
        ts.forEachChild(node, visit);
      };
      visit(source);
      if (!declaration || declaration.parameters.length !== 1 || declaration.parameters[0].initializer
        || declaration.parameters[0].questionToken || calls.length !== 2) throw new Error("Refresh ownership is not explicit");
      const warm = text.indexOf('command === "warm"'), populate = text.indexOf('command === "populate"');
      if (warm < 0 || populate <= warm || calls[0].getStart(source) <= warm || calls[0].getStart(source) >= populate
        || calls[1].getStart(source) <= populate) throw new Error("Both active refresh branches must be covered");
      for (const call of calls) if (call.arguments.length !== 1 || !ts.isIdentifier(call.arguments[0])
        || call.arguments[0].text !== "publicationRefresh") throw new Error("Unowned refresh selection");
    };
    expect(() => assertOwnedRefresh(cli)).not.toThrow();
    for (const target of ['command === "warm"', 'command === "populate"']) {
      const at = cli.indexOf(target), call = cli.indexOf("authenticate(publicationRefresh)", at);
      expect(call).toBeGreaterThan(at);
      for (const substitute of ["authenticate()", "authenticate(() => '')"]) {
        const changed = cli.slice(0, call) + cli.slice(call).replace("authenticate(publicationRefresh)", substitute);
        expect(() => assertOwnedRefresh(changed)).toThrow();
      }
    }
    expect(() => assertOwnedRefresh(cli.replace("refresh: () => string", "refresh = () => ''"))).toThrow();
  });
  it("requires actual owned refresh before consumer seeding and publisher admission", () => {
    const cli = readFileSync(new URL("./ci-browser-font-cache.run.mts", import.meta.url), "utf8");
    const warm = cli.slice(cli.indexOf('command === "warm"'), cli.indexOf('command === "populate"'));
    const populate = cli.slice(cli.indexOf('command === "populate"'));
    expect(warm).toContain("authenticate(publicationRefresh);");
    expect(warm).not.toContain("authenticate();");
    expect(warm.indexOf("authenticate(publicationRefresh);")).toBeLessThan(warm.indexOf("verifyCache(cache, manifest)"));
    expect(populate).toContain("authenticate(publicationRefresh);");
    expect(populate.indexOf("authenticate(publicationRefresh);")).toBeLessThan(populate.indexOf('output("save-ready", "true")'));
  });
});
