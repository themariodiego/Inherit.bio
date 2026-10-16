/** Current-route pixel calculation uses the exact frozen computation body.
 * No baseline file is modified. verifyFrozenDensityPixelBody checks the full
 * copied body before use; its source test checks the same whole equality. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const groundRgb = [247, 248, 241];
const nextRequire = createRequire(createRequire(path.join(repositoryRoot, "package.json")).resolve("next/package.json"));
const sharp = nextRequire("sharp");

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function rgbToLab(red, green, blue) {
  const linear = (value) => {
    const normalized = value / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const r = linear(red);
  const g = linear(green);
  const b = linear(blue);
  let x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  let y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  let z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const f = (value) =>
    value > 216 / 24389
      ? Math.cbrt(value)
      : ((24389 / 27) * value + 16) / 116;
  x = f(x);
  y = f(y);
  z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function deltaE00(lab1, lab2) {
  const [lightness1, a1, b1] = lab1;
  const [lightness2, a2, b2] = lab2;
  const chroma1 = Math.hypot(a1, b1);
  const chroma2 = Math.hypot(a2, b2);
  const meanChroma = (chroma1 + chroma2) / 2;
  const meanChroma7 = meanChroma ** 7;
  const g = 0.5 * (1 - Math.sqrt(meanChroma7 / (meanChroma7 + 25 ** 7)));
  const adjustedA1 = (1 + g) * a1;
  const adjustedA2 = (1 + g) * a2;
  const adjustedChroma1 = Math.hypot(adjustedA1, b1);
  const adjustedChroma2 = Math.hypot(adjustedA2, b2);
  const hue = (a, b) => {
    if (a === 0 && b === 0) return 0;
    const degrees = (Math.atan2(b, a) * 180) / Math.PI;
    return degrees < 0 ? degrees + 360 : degrees;
  };
  const hue1 = hue(adjustedA1, b1);
  const hue2 = hue(adjustedA2, b2);
  const deltaLightness = lightness2 - lightness1;
  const deltaChroma = adjustedChroma2 - adjustedChroma1;
  let deltaHue = hue2 - hue1;
  if (adjustedChroma1 * adjustedChroma2 === 0) deltaHue = 0;
  else if (deltaHue > 180) deltaHue -= 360;
  else if (deltaHue < -180) deltaHue += 360;
  const deltaAdjustedHue =
    2 *
    Math.sqrt(adjustedChroma1 * adjustedChroma2) *
    Math.sin((deltaHue / 2) * (Math.PI / 180));
  const meanLightness = (lightness1 + lightness2) / 2;
  const meanAdjustedChroma = (adjustedChroma1 + adjustedChroma2) / 2;
  let meanHue;
  if (adjustedChroma1 * adjustedChroma2 === 0) meanHue = hue1 + hue2;
  else if (Math.abs(hue1 - hue2) <= 180) meanHue = (hue1 + hue2) / 2;
  else if (hue1 + hue2 < 360) meanHue = (hue1 + hue2 + 360) / 2;
  else meanHue = (hue1 + hue2 - 360) / 2;
  const t =
    1 -
    0.17 * Math.cos(((meanHue - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * meanHue * Math.PI) / 180) +
    0.32 * Math.cos(((3 * meanHue + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * meanHue - 63) * Math.PI) / 180);
  const deltaTheta = 30 * Math.exp(-(((meanHue - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(meanAdjustedChroma ** 7 / (meanAdjustedChroma ** 7 + 25 ** 7));
  const sl =
    1 +
    (0.015 * (meanLightness - 50) ** 2) /
      Math.sqrt(20 + (meanLightness - 50) ** 2);
  const sc = 1 + 0.045 * meanAdjustedChroma;
  const sh = 1 + 0.015 * meanAdjustedChroma * t;
  const rt = -Math.sin((2 * deltaTheta * Math.PI) / 180) * rc;
  const l = deltaLightness / sl;
  const c = deltaChroma / sc;
  const h = deltaAdjustedHue / sh;
  return Math.sqrt(l * l + c * c + h * h + rt * c * h);
}

const referenceDelta = deltaE00(
  [50, 2.6772, -79.7751],
  [50, 0, -82.7485],
);
if (Math.abs(referenceDelta - 2.0425) > 0.0001) {
  throw new Error(`CIEDE2000 self-test failed: ${referenceDelta}`);
}

const groundLab = rgbToLab(...groundRgb);
const colourCache = new Map();
function isInk(red, green, blue) {
  const key = (red << 16) | (green << 8) | blue;
  let value = colourCache.get(key);
  if (value === undefined) {
    value = deltaE00(groundLab, rgbToLab(red, green, blue)) >= 8;
    colourCache.set(key, value);
  }
  return value;
}

function pixelExcluded(x, y, exclusionRects) {
  const centreX = x + 0.5;
  const centreY = y + 0.5;
  return exclusionRects.some(
    (rect) =>
      centreX >= rect.left &&
      centreX < rect.right &&
      centreY >= rect.top &&
      centreY < rect.bottom,
  );
}

async function imageMetrics(
  file,
  expectedWidth,
  expectedHeight,
  exclusionRects,
) {
  const encoded = fs.readFileSync(file);
  if (encoded.toString("hex", 0, 8) !== "89504e470d0a1a0a") {
    throw new Error(`${file}: not PNG`);
  }
  const { data, info } = await sharp(encoded)
    .toColourspace("srgb")
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== expectedWidth || info.height !== expectedHeight) {
    throw new Error(
      `${file}: ${info.width}x${info.height}, expected ${expectedWidth}x${expectedHeight}`,
    );
  }
  if (info.channels !== 3) throw new Error(`${file}: ${info.channels} channels`);
  let includedPixelCount = 0;
  let excludedPixelCount = 0;
  let inkPixelCount = 0;
  let exactGroundPixelCount = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = (y * info.width + x) * 3;
      if (pixelExcluded(x, y, exclusionRects)) {
        excludedPixelCount += 1;
        continue;
      }
      includedPixelCount += 1;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      if (isInk(red, green, blue)) inkPixelCount += 1;
      if (red === groundRgb[0] && green === groundRgb[1] && blue === groundRgb[2]) {
        exactGroundPixelCount += 1;
      }
    }
  }
  const inkCoverageRatio = inkPixelCount / includedPixelCount;
  return {
    screenshotSha256: sha256(encoded),
    screenshotWidthPx: info.width,
    screenshotHeightPx: info.height,
    includedPixelCount,
    excludedPixelCount,
    inkPixelCount,
    inkCoverageRatio: Number(inkCoverageRatio.toFixed(6)),
    whiteSpaceRatio: Number((1 - inkCoverageRatio).toFixed(6)),
    exactGroundPixelCount,
    exactGroundRatio: Number(
      (exactGroundPixelCount / includedPixelCount).toFixed(6),
    ),
  };
}

export { imageMetrics };
export function verifyFrozenDensityPixelBody(root, expectedSha256) {
  const original = fs.readFileSync(path.join(root, "scripts/density-baseline/compute.mjs"), "utf8");
  if (sha256(Buffer.from(original)) !== expectedSha256) throw new Error("Frozen density computation changed");
  const own = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
  const start = "function sha256(buffer) {";
  const end = "function routePattern(capturedPath) {";
  const originalBody = original.slice(original.indexOf(start), original.indexOf(end));
  const ownBody = own.slice(own.indexOf(start), own.indexOf("export { imageMetrics };"));
  if (!originalBody || ownBody !== originalBody) throw new Error("Current density pixel body changed");
}
