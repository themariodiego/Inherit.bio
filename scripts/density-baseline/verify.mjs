import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const baselineDocumentPath =
  process.env.DENSITY_CONTRACT_DOCUMENT ||
  path.join(repositoryRoot, "docs/density-baseline.json");
const captureManifestPath =
  process.env.DENSITY_CAPTURE_MANIFEST ||
  path.join(
    repositoryRoot,
    "docs/evidence/density-baseline/capture-manifest.json",
  );
const computedMeasurementsPath =
  process.env.DENSITY_COMPUTED_MEASUREMENTS ||
  path.join(
    repositoryRoot,
    "docs/evidence/density-baseline/computed-measurements.json",
  );
const screenshotDirectory =
  process.env.DENSITY_SCREENSHOT_DIRECTORY ||
  path.join(repositoryRoot, "docs/evidence/density-baseline/screenshots");

const baselineDocument = readJson(baselineDocumentPath);
const captureManifest = readJson(captureManifestPath);
const computedMeasurements = readJson(computedMeasurementsPath);
const baselineSha = baselineDocument.baseline.commitSha;
const checks = [];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function fileSha256(file) {
  return sha256(fs.readFileSync(file));
}

function git(...arguments_) {
  return execFileSync("git", ["-C", repositoryRoot, ...arguments_], {
    encoding: "utf8",
  }).trim();
}

function gitBuffer(...arguments_) {
  return execFileSync("git", ["-C", repositoryRoot, ...arguments_]);
}

function check(name, callback) {
  callback();
  checks.push(name);
}

function artifactAbsolutePath(relativePath) {
  const absolute = path.resolve(repositoryRoot, relativePath);
  assert.equal(
    absolute.startsWith(`${repositoryRoot}${path.sep}`),
    true,
    `Artifact escapes repository: ${relativePath}`,
  );
  return absolute;
}

function gitPaths(prefix, suffix) {
  return git("ls-tree", "-r", "--name-only", baselineSha, "--", prefix)
    .split("\n")
    .filter((entry) => entry && entry.endsWith(suffix))
    .sort();
}

function canonicalManifestSha256(paths) {
  const lines = paths.map((relativePath) => {
    const contents = gitBuffer("show", `${baselineSha}:${relativePath}`);
    return `${sha256(contents)}  ${relativePath}\n`;
  });
  return sha256(Buffer.from(lines.join(""), "utf8"));
}

function walk(value, callback, keyPath = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, callback, [...keyPath, index]));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      callback(key, item, [...keyPath, key]);
      walk(item, callback, [...keyPath, key]);
    }
  }
}

check("baseline Git identities", () => {
  assert.match(baselineSha, /^[0-9a-f]{40}$/);
  assert.equal(git("rev-parse", `${baselineSha}^{commit}`), baselineSha);
  assert.equal(
    git("rev-parse", `${baselineSha}^{tree}`),
    baselineDocument.baseline.fullTreeSha,
  );
  assert.equal(
    git("rev-parse", `${baselineSha}:src`),
    baselineDocument.baseline.sourceTreeSha,
  );
  assert.equal(gitPaths("src/app", "/page.tsx").length, 22);
  if (process.env.DENSITY_REQUIRE_CURRENT_SOURCE_IDENTITY === "1") {
    assert.equal(
      git("rev-parse", "HEAD:src"),
      baselineDocument.baseline.sourceTreeSha,
    );
    assert.equal(git("diff", "--name-only", baselineSha, "--", "src"), "");
    assert.equal(git("diff", "--name-only", "--", "src"), "");
  }
});

check("all SHA-256 and Git hashes are full length", () => {
  walk(baselineDocument, (key, value, keyPath) => {
    if (key.endsWith("Sha256") || key === "screenshotSha256") {
      assert.match(
        value,
        /^[0-9a-f]{64}$/,
        `Invalid SHA-256 at ${keyPath.join(".")}`,
      );
    }
  });
  for (const key of ["commitSha", "fullTreeSha", "sourceTreeSha"]) {
    assert.match(baselineDocument.baseline[key], /^[0-9a-f]{40}$/);
  }
});

check("durable artifact hashes", () => {
  for (const artifact of Object.values(baselineDocument.capture.artifacts)) {
    const absolutePath = artifactAbsolutePath(artifact.path);
    assert.equal(fs.existsSync(absolutePath), true, artifact.path);
    assert.equal(fileSha256(absolutePath), artifact.sha256, artifact.path);
  }
  assert.equal(
    fs.statSync(
      artifactAbsolutePath(
        baselineDocument.capture.artifacts.reproductionHarness.path,
      ),
    ).mode & 0o111,
    0o111,
    "reproduce.sh must be executable",
  );
});

check("fixture hashes, canonical manifests, and row counts", () => {
  const genomeBuffer = gitBuffer(
    "show",
    `${baselineSha}:${baselineDocument.fixture.genomeSource.path}`,
  );
  assert.equal(
    sha256(genomeBuffer),
    baselineDocument.fixture.genomeSource.sha256,
  );
  assert.equal(
    genomeBuffer
      .toString("utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#")).length,
    baselineDocument.fixture.genomeSource.variantCount,
  );
  const templatePaths = gitPaths("data/templates", ".json");
  const templateRows = templatePaths.flatMap((relativePath) =>
    JSON.parse(gitBuffer("show", `${baselineSha}:${relativePath}`).toString("utf8")),
  );
  assert.equal(
    canonicalManifestSha256(templatePaths),
    baselineDocument.fixture.templateSource.manifestSha256,
  );
  assert.equal(
    templateRows.filter((row) => row.published !== false).length,
    baselineDocument.fixture.templateSource.publishedTemplateCount,
  );
  const providerBuffer = gitBuffer(
    "show",
    `${baselineSha}:${baselineDocument.fixture.providerSource.path}`,
  );
  assert.equal(
    sha256(providerBuffer),
    baselineDocument.fixture.providerSource.sha256,
  );
  assert.equal(
    JSON.parse(providerBuffer.toString("utf8")).length,
    baselineDocument.fixture.providerSource.rowCount,
  );
  const prsPaths = gitPaths("data/prs", ".json");
  assert.equal(
    canonicalManifestSha256(prsPaths),
    baselineDocument.fixture.prsSource.manifestSha256,
  );
  assert.equal(prsPaths.length, baselineDocument.fixture.prsSource.scoreCount);
});

check("deterministic Supabase fixture", () => {
  const fixturePath = artifactAbsolutePath(
    baselineDocument.capture.artifacts.supabaseFixture.path,
  );
  const baselineCheckout = path.join(
    "/private/tmp",
    `inherit-density-fixture-self-test-${process.pid}`,
  );
  fs.mkdirSync(baselineCheckout, { recursive: true });
  for (const relativePath of [
    "data/templates",
    "data/providers",
    "data/prs",
    "data/samples",
  ]) {
    fs.mkdirSync(path.join(baselineCheckout, relativePath), { recursive: true });
  }
  for (const relativePath of [
    ...gitPaths("data/templates", ".json"),
    ...gitPaths("data/providers", ".json"),
    ...gitPaths("data/prs", ".json"),
    "data/samples/synthetic_23andme.txt",
  ]) {
    fs.writeFileSync(
      path.join(baselineCheckout, relativePath),
      gitBuffer("show", `${baselineSha}:${relativePath}`),
    );
  }
  const run = () =>
    execFileSync(process.execPath, [fixturePath], {
      encoding: "utf8",
      env: {
        ...process.env,
        INHERIT_BASELINE_CHECKOUT: baselineCheckout,
        INHERIT_DENSITY_FIXED_TIME:
          baselineDocument.fixture.deterministicClock,
        INHERIT_FIXTURE_SELF_TEST: "1",
      },
    }).trim();
  assert.equal(run(), run());
});

check("capture manifest and screenshot evidence", () => {
  assert.equal(captureManifest.schemaVersion, 1);
  assert.equal(captureManifest.captureEnvironment.origin, "http://127.0.0.1:3100");
  assert.equal(captureManifest.captureEnvironment.devicePixelRatio, 1);
  assert.equal(captureManifest.captureEnvironment.theme, "light");
  assert.equal(Object.keys(captureManifest.routes).length, 22);
  const screenshotFiles = fs
    .readdirSync(screenshotDirectory)
    .filter((name) => name.endsWith(".png"))
    .sort();
  assert.equal(screenshotFiles.length, 44);
  const expectedFiles = [];
  for (const route of baselineDocument.routes) {
    for (const viewportKey of ["390x844", "1280x800"]) {
      const measurement = route.measurements[viewportKey];
      const absolutePath = artifactAbsolutePath(measurement.screenshotPath);
      expectedFiles.push(path.basename(absolutePath));
      assert.equal(fileSha256(absolutePath), measurement.screenshotSha256);
      assert.equal(measurement.screenshotWidthPx, Number(viewportKey.split("x")[0]));
      assert.equal(measurement.screenshotHeightPx, Number(viewportKey.split("x")[1]));
      assert.equal(
        measurement.includedPixelCount + measurement.excludedPixelCount,
        measurement.screenshotWidthPx * measurement.screenshotHeightPx,
      );
      assert.equal(
        measurement.whiteSpaceRatio,
        Number((1 - measurement.inkCoverageRatio).toFixed(6)),
      );
    }
  }
  assert.deepEqual([...new Set(expectedFiles)].sort(), screenshotFiles);
  assert.equal(
    new Set(
      baselineDocument.routes.flatMap((route) =>
        Object.values(route.measurements).map(
          (measurement) => measurement.screenshotSha256,
        ),
      ),
    ).size,
    44,
  );
});

check("computed measurements reproduce byte-for-byte", () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "inherit-density-verify-"),
  );
  const regeneratedPath = path.join(
    temporaryDirectory,
    "computed-measurements.json",
  );
  execFileSync(
    process.execPath,
    [artifactAbsolutePath(baselineDocument.capture.artifacts.measurementHarness.path)],
    {
      stdio: "pipe",
      env: {
        ...process.env,
        DENSITY_CONTRACT_DOCUMENT: baselineDocumentPath,
        DENSITY_CAPTURE_MANIFEST: captureManifestPath,
        DENSITY_SCREENSHOT_DIRECTORY: screenshotDirectory,
        DENSITY_COMPUTED_MEASUREMENTS: regeneratedPath,
      },
    },
  );
  assert.deepEqual(
    fs.readFileSync(regeneratedPath),
    fs.readFileSync(computedMeasurementsPath),
  );
});

check("baseline document matches computed evidence", () => {
  assert.deepEqual(baselineDocument.thresholds, computedMeasurements.thresholds);
  assert.deepEqual(
    baselineDocument.measurementSelectors,
    computedMeasurements.measurementSelectors,
  );
  assert.deepEqual(baselineDocument.exclusions, computedMeasurements.exclusions);
  assert.deepEqual(baselineDocument.methodology, computedMeasurements.methodology);
  assert.deepEqual(
    baselineDocument.captureValidation,
    computedMeasurements.captureValidation,
  );
  assert.equal(baselineDocument.routes.length, computedMeasurements.routes.length);
  for (const computedRoute of computedMeasurements.routes) {
    const documentedRoute = baselineDocument.routes.find(
      (route) => route.route === computedRoute.route,
    );
    assert.ok(documentedRoute, computedRoute.route);
    for (const key of ["measurementPath", "surface", "state", "measurements"]) {
      assert.deepEqual(documentedRoute[key], computedRoute[key], computedRoute.route);
    }
  }
});

check("X0/X6/G2.5 checkpoint state", () => {
  assert.equal(baselineDocument.baseline.measurementStatus, "measured");
  assert.equal(baselineDocument.baseline.productionDataUsed, false);
  assert.equal(baselineDocument.baseline.cloudMutation, false);
  assert.deepEqual(baselineDocument.captureValidation.anomalies, []);
  assert.equal(baselineDocument.postChange.status, "pending");
  assert.equal(baselineDocument.thresholds.mobile390.horizontalOverflowPxMax, 0);
  assert.equal(
    baselineDocument.routes.every(
      (route) => route.measurements["390x844"].horizontalOverflowPx === 0,
    ),
    true,
  );
});

console.log(
  JSON.stringify(
    {
      status: "PASS",
      checks,
      routes: baselineDocument.routes.length,
      captures: baselineDocument.routes.length * 2,
      baselineSha,
      sourceTreeSha: baselineDocument.baseline.sourceTreeSha,
    },
    null,
    2,
  ),
);
