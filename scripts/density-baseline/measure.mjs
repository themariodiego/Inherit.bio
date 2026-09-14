/**
 * The two halves of a density measurement that must never differ between the
 * baseline capture and the post-change one: how a page is brought to rest
 * before it is read, and what is read off it.
 *
 * Extracted 2026-09-14, unchanged. `capture.mjs` measured the baseline's 22
 * paths and nothing measured their successors, so the post-change side needed
 * a second driver — and a second COPY of this code would have made the two
 * halves of a comparison incomparable by drift, which is the one failure this
 * whole document exists to prevent. The baseline screenshots are verified by
 * hash, so any change here would be caught; nothing changed here.
 */

export async function ready(page) {
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

/**
 * `selectors` is a parameter rather than module state, which is the ONLY
 * difference from the form that measured the baseline: it was read from the
 * contract document in the caller's scope. Both callers pass
 * `contract.measurementSelectors` from the same file.
 */
export async function measure(page, selectors) {
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

    // THE PROSE MEASURE IS RECORDED TWICE, and the second one is a diagnostic
    // rather than a replacement. `proseMeasures` is the basis this contract has
    // always used - every rendered `p` OR `li`, anywhere in the document - and
    // it stays exactly as it was so every number already recorded against it
    // remains comparable. `paragraphProseMeasures` is the brief's own wording:
    // line 197 says "prose `<p>`", line 491 says "No prose `<p>` in `(app)`",
    // and line 569 explains the 45ch floor by arithmetic on the CONTENT COLUMN.
    // A three-character list item is not body prose and cannot clear a
    // 45-character floor, which is why the wider basis misses on 21 of 22
    // routes on BOTH halves of the comparison (D-115). Which basis the contract
    // should use is an operator decision; measuring both is what makes it one.
    const proseMeasures = [];
    const paragraphProseMeasures = [];
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
        const measure = element.getBoundingClientRect().width / zeroAdvance;
        proseMeasures.push(measure);
        if (element.tagName === "P" && primaryRoot.contains(element)) {
          paragraphProseMeasures.push(measure);
        }
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
      paragraphProseElementCount: paragraphProseMeasures.length,
      maxParagraphProseMeasureCh: paragraphProseMeasures.length
        ? Math.round(Math.max(...paragraphProseMeasures) * 1000) / 1000
        : null,
      minParagraphProseMeasureCh: paragraphProseMeasures.length
        ? Math.round(Math.min(...paragraphProseMeasures) * 1000) / 1000
        : null,
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
