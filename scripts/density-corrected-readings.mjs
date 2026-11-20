/**
 * The corrected density readings (owner decision "2026-10-22 — Density rule
 * corrections (G2.5)", docs/protocol/decisions.md) and the text-only floor
 * capture variant.
 *
 * THIS IS NOT A MEASUREMENT MODULE. The frozen `measure.mjs` and the frozen
 * pixel body in `compute.mjs` (and its exact copy `density-current-pixels.mjs`)
 * still produce every number the contract records. This module reads three
 * further facts from the same live page, which `scripts/density-current.ts`
 * uses only under the corrected rules:
 *
 *  - the 45ch floor over prose paragraphs only: every rendered `p`, except a
 *    paragraph that sets on one line and carries a link (D-115). List items
 *    are not paragraphs. The width basis is the frozen one: the element's box
 *    divided by the advance of "0" in its own font;
 *  - adjacent top-level section gaps in visual order: the frozen section
 *    selection, sorted by rendered top, with sections whose vertical extents
 *    overlap (side-by-side panes) merged into one row;
 *  - the characters actually visible above the fold: each character counts
 *    only if its own glyph box meets the first viewport, so a long
 *    pre-formatted node counts the part a reader sees, not its whole length.
 *
 * The text-only floor is the same page with every border, fill, shadow,
 * outline, underline, icon and image made transparent and every glyph left
 * where it is: no property that moves or resizes a box is touched. It is
 * captured on the same load as the product screenshot, then removed again.
 */

export const TEXT_ONLY_FLOOR_CSS = [
  "*,*::before,*::after{border-color:transparent!important;box-shadow:none!important;outline-color:transparent!important;text-decoration-color:transparent!important;background-color:transparent!important;background-image:none!important}",
  "svg,img,picture,canvas,video,iframe,hr{visibility:hidden!important}",
  "html,body{background-color:#f7f8f1!important}",
].join("");

const nextFrames = (page) =>
  page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

/**
 * Screenshot the text-only floor of the page as it stands, then restore it.
 * The caller computes its pixels with the frozen pixel body and the same
 * exclusion rectangles as the product capture.
 */
export async function captureTextOnlyFloor(page) {
  const style = await page.addStyleTag({ content: TEXT_ONLY_FLOOR_CSS });
  try {
    await nextFrames(page);
    return await page.screenshot({ type: "png", fullPage: false, animations: "disabled", caret: "hide" });
  } finally {
    await style.evaluate((element) => element.remove());
    await nextFrames(page);
  }
}

/** Read the three corrected facts. `selectors` is the contract's own set. */
export async function readCorrectedDensity(page, selectors) {
  return page.evaluate((selectors) => {
    const viewportWidth = innerWidth;
    const viewportHeight = innerHeight;
    const intersects = (rect) =>
      rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 &&
      rect.left < viewportWidth && rect.top < viewportHeight;
    const rendered = (element, firstViewportOnly = true) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" &&
        Number(style.opacity || 1) !== 0 && rect.width > 0 && rect.height > 0 &&
        (!firstViewportOnly || intersects(rect));
    };
    const textNodeRects = (node) => {
      if (node.nodeType !== Node.TEXT_NODE || !(node.textContent || "").trim()) return [];
      const range = document.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()].filter(intersects);
    };
    const directTextNodes = (element) =>
      [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE && textNodeRects(node).length);
    const zeroAdvance = (style) => {
      const probe = document.createElement("span");
      probe.textContent = "0000000000";
      Object.assign(probe.style, {
        position: "fixed", left: "-10000px", top: "0", visibility: "hidden", whiteSpace: "pre",
        fontFamily: style.fontFamily, fontSize: style.fontSize, fontStyle: style.fontStyle,
        fontWeight: style.fontWeight, fontStretch: style.fontStretch, letterSpacing: style.letterSpacing,
      });
      document.body.append(probe);
      const advance = probe.getBoundingClientRect().width / 10;
      probe.remove();
      return advance;
    };
    // Rows of vertically overlapping rectangles, in rendered top order.
    const rows = (rects) => {
      const sorted = [...rects].sort((a, b) => a.top - b.top || a.bottom - b.bottom);
      const merged = [];
      for (const rect of sorted) {
        const last = merged.at(-1);
        if (last && rect.top < last.bottom) last.bottom = Math.max(last.bottom, rect.bottom);
        else merged.push({ top: rect.top, bottom: rect.bottom });
      }
      return merged;
    };

    // 1. Prose paragraphs for the 45ch floor.
    const proseMeasures = [];
    let excludedOneLineLinkParagraphCount = 0;
    for (const element of document.querySelectorAll("p")) {
      if (!rendered(element, false)) continue;
      const range = document.createRange();
      range.selectNodeContents(element);
      const lines = rows([...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0)).length;
      range.detach?.();
      if (lines <= 1 && element.querySelector("a[href]")) {
        excludedOneLineLinkParagraphCount += 1;
        continue;
      }
      const advance = zeroAdvance(getComputedStyle(element));
      if (advance > 0) proseMeasures.push(element.getBoundingClientRect().width / advance);
    }

    // 2. Top-level sections in visual order (the frozen selection rule).
    const primaryRoot = document.querySelector(selectors.primaryContent) ||
      document.querySelector("main,[role=main]") || document.body;
    const explicitSections = [...primaryRoot.querySelectorAll(selectors.topLevelSection)];
    const semanticSections = [...primaryRoot.querySelectorAll("section")].filter((section) => {
      const ancestor = section.parentElement?.closest("section");
      return !ancestor || !primaryRoot.contains(ancestor);
    });
    const sectionRows = rows((explicitSections.length ? explicitSections : semanticSections)
      .filter((section) => rendered(section, false))
      .map((section) => section.getBoundingClientRect()));
    const gaps = [];
    for (let index = 1; index < sectionRows.length; index += 1) {
      gaps.push(sectionRows[index].top - sectionRows[index - 1].bottom);
    }

    // 3. Characters visible above the fold, character by character.
    let aboveFoldTextCharacterCount = 0;
    const visible = [...document.querySelectorAll("*")].filter((element) => rendered(element));
    for (const element of visible) {
      for (const node of directTextNodes(element)) {
        const text = node.textContent || "";
        let kept = "";
        const range = document.createRange();
        for (let index = 0; index < text.length; index += 1) {
          range.setStart(node, index);
          range.setEnd(node, index + 1);
          if ([...range.getClientRects()].some(intersects)) kept += text[index];
          else kept += " ";
        }
        range.detach?.();
        aboveFoldTextCharacterCount += kept.replace(/\s+/g, " ").trim().length;
      }
    }

    return {
      proseParagraphCount: proseMeasures.length,
      excludedOneLineLinkParagraphCount,
      minProseParagraphMeasureCh: proseMeasures.length
        ? Math.round(Math.min(...proseMeasures) * 1000) / 1000 : null,
      topLevelSectionRowCount: sectionRows.length,
      minimumVisualSectionGapPx: gaps.length ? Math.round(Math.min(...gaps) * 100) / 100 : null,
      aboveFoldTextCharacterCount,
    };
  }, selectors);
}
