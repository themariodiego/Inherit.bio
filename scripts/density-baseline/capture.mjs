import { createRequire } from "node:module";
import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const require = createRequire(path.join(repositoryRoot, "package.json"));
const { chromium } = require("@playwright/test");

const origin = process.env.DENSITY_ORIGIN || "http://127.0.0.1:3100";
const outputDirectory =
  process.env.DENSITY_SCREENSHOT_DIRECTORY ||
  "/private/tmp/inherit-density-baseline/screenshots";
const manifestPath =
  process.env.DENSITY_CAPTURE_MANIFEST ||
  "/private/tmp/inherit-density-baseline/capture-manifest.json";
const browserExecutable =
  process.env.DENSITY_BROWSER_EXECUTABLE ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const contractPath =
  process.env.DENSITY_CONTRACT_DOCUMENT ||
  path.join(repositoryRoot, "docs/density-baseline.json");
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const selectors = contract.measurementSelectors;
if (
  !selectors?.requiredAccuracy ||
  !selectors?.primaryClaim ||
  !selectors?.primaryContent ||
  !selectors?.topLevelSection ||
  !selectors?.pixelExclusions
) {
  throw new Error(`Incomplete density selectors: ${contractPath}`);
}

const fileKeyForRoute = (route) => {
  if (route === "/") return "home";
  return route.replace(/^\//, "").replaceAll("/", "-");
};
const baselineCases = contract.routes.map((route) => [
  route.measurementPath,
  fileKeyForRoute(route.measurementPath),
  route.surface,
]);
const publicCases = baselineCases
  .filter(([, , surface]) => surface !== "authenticated")
  .map(([route, fileKey]) => [route, fileKey]);
const authenticatedCases = baselineCases
  .filter(([, , surface]) => surface === "authenticated")
  .map(([route, fileKey]) => [route, fileKey]);

const viewports = [
  { id: "390x844", width: 390, height: 844 },
  { id: "1280x800", width: 1280, height: 800 },
];

async function ready(page) {
  await page.waitForLoadState("load");
  await page.waitForTimeout(500);
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}",
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
}

async function measure(page) {
  return page.evaluate((selectors) => {
    const viewportWidth = innerWidth;
    const viewportHeight = innerHeight;
    const accuracySelector = selectors.requiredAccuracy;
    const primaryClaimSelector = selectors.primaryClaim;
    const explicitPrimarySelector = selectors.primaryContent;
    const pixelExclusionSelector = selectors.pixelExclusions;

    const intersects = (rect) =>
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < viewportWidth &&
      rect.top < viewportHeight;
    const rendered = (element, firstViewportOnly = true) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || 1) !== 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        (!firstViewportOnly || intersects(rect))
      );
    };
    const textNodeRects = (node) => {
      if (node.nodeType !== Node.TEXT_NODE || !(node.textContent || "").trim()) {
        return [];
      }
      const range = document.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()].filter(intersects);
    };
    const directTextNodes = (element) =>
      [...element.childNodes].filter(
        (node) => node.nodeType === Node.TEXT_NODE && textNodeRects(node).length,
      );
    const hasNonzeroBorder = (style) =>
      [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
      ].some((value) => Number.parseFloat(value) > 0);
    const hasFilledBackground = (style) =>
      !["rgba(0, 0, 0, 0)", "transparent"].includes(style.backgroundColor) ||
      (style.backgroundImage && style.backgroundImage !== "none");

    const visible = [...document.querySelectorAll("*")].filter((element) =>
      rendered(element),
    );
    const focusables = [
      ...document.querySelectorAll(
        'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"]),summary,[contenteditable="true"]',
      ),
    ].filter(
      (element) =>
        rendered(element) &&
        !element.matches(':disabled,[aria-disabled="true"]'),
    );
    const interactives = [
      ...document.querySelectorAll(
        'a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[contenteditable="true"]',
      ),
    ].filter((element) => rendered(element));
    const budgetedInteractives = interactives.filter(
      (element) =>
        !element.matches('a[href="#main"]') &&
        !element.closest("nav,[data-copilot-entry]"),
    );

    let visibleTextCharacters = 0;
    for (const element of visible) {
      for (const node of directTextNodes(element)) {
        visibleTextCharacters += (node.textContent || "")
          .replace(/\s+/g, " ")
          .trim().length;
      }
    }

    let rawDecoratedElements = 0;
    let budgetedDecoratedElements = 0;
    let requiredAccuracyTextElementExclusions = 0;
    for (const element of visible) {
      const style = getComputedStyle(element);
      const textNodes = directTextNodes(element);
      const hasRawText = textNodes.length > 0;
      const hasBudgetedText = textNodes.some(
        (node) => !node.parentElement?.closest(accuracySelector),
      );
      const hasVisualDecoration =
        hasNonzeroBorder(style) || hasFilledBackground(style);
      if (hasRawText || hasVisualDecoration) rawDecoratedElements += 1;
      if (hasBudgetedText || hasVisualDecoration) budgetedDecoratedElements += 1;
      if (hasRawText && !hasBudgetedText && !hasVisualDecoration) {
        requiredAccuracyTextElementExclusions += 1;
      }
    }

    const primaryRoot =
      document.querySelector(explicitPrimarySelector) ||
      document.querySelector("main,[role=main]") ||
      document.body;
    const explicitPrimary = primaryRoot.matches?.(explicitPrimarySelector);
    const excludedPrimaryAncestors =
      "nav,footer,[data-copilot-entry],[aria-hidden=true]";
    const primaryAnchorLefts = [];
    if (explicitPrimary && rendered(primaryRoot)) {
      const rect = primaryRoot.getBoundingClientRect();
      const style = getComputedStyle(primaryRoot);
      primaryAnchorLefts.push(rect.left + Number.parseFloat(style.paddingLeft || 0));
    } else {
      for (const element of [primaryRoot, ...primaryRoot.querySelectorAll("*")]) {
        if (!rendered(element) || element.closest(excludedPrimaryAncestors)) continue;
        for (const node of directTextNodes(element)) {
          for (const rect of textNodeRects(node)) primaryAnchorLefts.push(rect.left);
        }
        if (
          element.matches(
            "input,select,textarea,button,img,svg,canvas,table,figure,[data-card]",
          )
        ) {
          primaryAnchorLefts.push(element.getBoundingClientRect().left);
        }
      }
    }
    const finitePrimaryLefts = primaryAnchorLefts.filter(
      (value) => Number.isFinite(value) && value >= 0 && value < viewportWidth,
    );
    const primaryContentLeftPaddingPx = finitePrimaryLefts.length
      ? Math.round(Math.min(...finitePrimaryLefts) * 100) / 100
      : null;

    const proseMeasures = [];
    for (const element of document.querySelectorAll("p,li")) {
      if (!rendered(element, false)) continue;
      const style = getComputedStyle(element);
      const probe = document.createElement("span");
      probe.textContent = "0000000000";
      Object.assign(probe.style, {
        position: "fixed",
        left: "-10000px",
        top: "0",
        visibility: "hidden",
        whiteSpace: "pre",
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontStyle: style.fontStyle,
        fontWeight: style.fontWeight,
        fontStretch: style.fontStretch,
        letterSpacing: style.letterSpacing,
      });
      document.body.append(probe);
      const zeroAdvance = probe.getBoundingClientRect().width / 10;
      probe.remove();
      if (zeroAdvance > 0) {
        proseMeasures.push(element.getBoundingClientRect().width / zeroAdvance);
      }
    }

    const explicitSections = [
      ...primaryRoot.querySelectorAll(selectors.topLevelSection),
    ];
    const semanticSections = [...primaryRoot.querySelectorAll("section")].filter(
      (section) => {
        const ancestor = section.parentElement?.closest("section");
        return !ancestor || !primaryRoot.contains(ancestor);
      },
    );
    const topLevelSections = (explicitSections.length
      ? explicitSections
      : semanticSections
    ).filter((section) => rendered(section, false));
    const sectionGaps = [];
    for (let index = 1; index < topLevelSections.length; index += 1) {
      const previous = topLevelSections[index - 1].getBoundingClientRect();
      const current = topLevelSections[index].getBoundingClientRect();
      sectionGaps.push(current.top - previous.bottom);
    }

    const primaryClaim = document.querySelector(primaryClaimSelector);
    let primaryClaimTextElementCount = null;
    let primaryClaimFigureCount = null;
    if (primaryClaim && rendered(primaryClaim)) {
      primaryClaimTextElementCount = [
        primaryClaim,
        ...primaryClaim.querySelectorAll("*"),
      ].filter((element) => directTextNodes(element).length).length;
      primaryClaimFigureCount = [
        ...primaryClaim.querySelectorAll(
          "figure,svg,canvas,[data-figure-kind],[role=img]",
        ),
      ].filter((element) => rendered(element)).length;
    }

    const pixelExclusionRects = [
      ...document.querySelectorAll(pixelExclusionSelector),
    ]
      .filter((element) => rendered(element))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          kind: element.getAttribute("data-density-pixel-exclusion"),
          left: Math.round(Math.max(0, rect.left) * 1000) / 1000,
          top: Math.round(Math.max(0, rect.top) * 1000) / 1000,
          right:
            Math.round(Math.min(viewportWidth, rect.right) * 1000) / 1000,
          bottom:
            Math.round(Math.min(viewportHeight, rect.bottom) * 1000) / 1000,
        };
      });

    return {
      budgetedInteractiveElements: budgetedInteractives.length,
      rawDecoratedElements,
      budgetedDecoratedElements,
      requiredAccuracyTextElementExclusions,
      focusableElements: focusables.length,
      interactiveElements: interactives.length,
      visibleTextCharacters,
      proseElementCount: proseMeasures.length,
      maxProseMeasureCh: proseMeasures.length
        ? Math.round(Math.max(...proseMeasures) * 1000) / 1000
        : null,
      minProseMeasureCh: proseMeasures.length
        ? Math.round(Math.min(...proseMeasures) * 1000) / 1000
        : null,
      topLevelSectionCount: topLevelSections.length,
      minimumAdjacentSectionGapPx: sectionGaps.length
        ? Math.round(Math.min(...sectionGaps) * 100) / 100
        : null,
      primaryContentLeftPaddingPx,
      primaryContentMeasurementSource: explicitPrimary
        ? "explicit-marker"
        : "visible-content-fallback",
      primaryContentAnchorCount: finitePrimaryLefts.length,
      primaryClaimTextElementCount,
      primaryClaimFigureCount,
      pixelExclusionRects,
      horizontalScroll: document.documentElement.scrollWidth > viewportWidth,
      horizontalOverflowPx: Math.max(
        0,
        document.documentElement.scrollWidth - viewportWidth,
      ),
      scrollWidth: document.documentElement.scrollWidth,
      ground: getComputedStyle(document.body).backgroundColor,
      statusView:
        document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ||
        document.title,
      resolvedUrl: location.href,
      dpr: devicePixelRatio,
      innerWidth,
      innerHeight,
    };
  }, selectors);
}

async function captureCases(page, cases, manifest) {
  for (const [route, fileKey] of cases) {
    manifest.routes[route] ??= {};
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${origin}${route}`, { waitUntil: "domcontentloaded" });
      await ready(page);
      const dimensions = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        dpr: devicePixelRatio,
      }));
      if (
        dimensions.width !== viewport.width ||
        dimensions.height !== viewport.height ||
        dimensions.dpr !== 1
      ) {
        throw new Error(
          `Invalid viewport for ${route}: ${JSON.stringify(dimensions)}`,
        );
      }
      const screenshotFile = `${fileKey}__${viewport.id}.png`;
      const screenshotPath = path.join(outputDirectory, screenshotFile);
      await page.screenshot({
        path: screenshotPath,
        type: "png",
        fullPage: false,
        animations: "disabled",
        caret: "hide",
      });
      manifest.routes[route][viewport.id] = {
        ...(await measure(page)),
        screenshotFile,
      };
    }
  }
}

await mkdir(outputDirectory, { recursive: true });
await mkdir(path.dirname(manifestPath), { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: browserExecutable,
});
const browserVersion = browser.version();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  colorScheme: "light",
  reducedMotion: "reduce",
  locale: "en-US",
  timezoneId: "UTC",
  serviceWorkers: "block",
});
const page = await context.newPage();
const manifest = {
  schemaVersion: 1,
  captureEnvironment: {
    origin,
    browserName: "Google Chrome",
    browserVersion,
    nodeVersion: process.versions.node,
    locale: "en-US",
    timezone: "UTC",
    theme: "light",
    devicePixelRatio: 1,
    serviceWorkers: "blocked",
  },
  routes: {},
};

try {
  await captureCases(page, publicCases, manifest);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${origin}/auth/sign-in?next=%2Fdashboard`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByLabel("Email").fill("density-fixture@inherit.test");
  await page.getByLabel("Password").fill("synthetic-density-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard", { timeout: 15_000 });
  await ready(page);

  await captureCases(page, authenticatedCases, manifest);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    JSON.stringify({
      manifestPath,
      screenshotDirectory: outputDirectory,
      routeCount: Object.keys(manifest.routes).length,
      measurementCount: Object.values(manifest.routes).reduce(
        (sum, route) => sum + Object.keys(route).length,
        0,
      ),
    }),
  );
} finally {
  await context.close();
  await browser.close();
}
