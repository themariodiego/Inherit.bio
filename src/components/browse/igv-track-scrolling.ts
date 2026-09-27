/** Replace the small pointer-only thumb with a native range control. The
 * library remains responsible for moving and repainting its track contents. */
export function enhanceIgvTrackScrolling(container: HTMLElement, labels: Record<string, string>, browser: {
  trackViews: {
    gear?: HTMLElement;
    innerScroll?: HTMLElement;
    outerScroll: HTMLElement;
    track: { name?: string };
    viewports: { viewportElement: HTMLElement; getContentTop(): number }[];
    maxViewportContentHeight(): number;
    scrollByPixels(delta: number): void;
  }[];
}): () => void {
  const root = container.shadowRoot ?? container;
  const abort = new AbortController();
  const ranges = new Map<HTMLElement, HTMLInputElement>();
  const ids = new Map<HTMLElement, string>();
  let nextId = 0;
  const style = document.createElement("style");
  style.textContent = `
    .igv-scrollbar-column:has([data-igv-scroll]:not([hidden])) { width: 44px; flex-shrink: 0; }
    .igv-scrollbar-column > div { width: 100%; }
    [data-igv-native-scroll] { display: none !important; }
    input[data-igv-scroll] {
      appearance: auto; writing-mode: vertical-lr; direction: ltr; margin: 0;
      box-sizing: border-box; width: 44px; min-width: 44px; min-height: 44px;
      color-scheme: light; accent-color: #2e5c45; background: white;
    }
    input[data-igv-scroll][hidden] { display: none; }
    input[data-igv-scroll]:focus-visible { outline: 2px solid #2e5c45; outline-offset: -2px; }
  `;
  root.appendChild(style);
  function update() {
    // React can detach the host before passive-effect cleanup runs. Rebuilding
    // controls in that detached tree would keep queuing mutation microtasks
    // and prevent the cleanup task (or the next page) from running.
    if (abort.signal.aborted || !container.isConnected) return;
    for (const [thumb, range] of ranges) {
      if (!thumb.isConnected) { range.remove(); ranges.delete(thumb); }
    }
    for (const view of browser.trackViews) {
      const thumb = view.innerScroll, viewport = view.viewports[0];
      if (!thumb || !viewport) continue;
      let range = ranges.get(thumb);
      if (!range) {
        range = document.createElement("input"); range.type = "range";
        range.dataset.igvScroll = "true"; range.min = "0"; range.step = "1";
        range.setAttribute("aria-orientation", "vertical");
        ranges.set(thumb, range); thumb.dataset.igvNativeScroll = "true";
        view.outerScroll.appendChild(range);
        const control = range;
        control.addEventListener("input", () => {
          view.scrollByPixels(Number(control.value) - view.viewports[0].getContentTop());
        }, { signal: abort.signal });
      }
      range.setAttribute("aria-label", `${labels.scrollTrack}: ${view.track.name || labels.referenceTrack}`);
      range.setAttribute("aria-controls", view.viewports.map(({ viewportElement }) => {
        if (!viewportElement.id) {
          let id: string;
          do { id = `inherit-track-scroll-${nextId++}`; } while (root.querySelector(`#${id}`));
          viewportElement.id = id; ids.set(viewportElement, id);
        }
        return viewportElement.id;
      }).join(" "));
      const height = viewport.viewportElement.clientHeight;
      const max = Math.max(0, view.maxViewportContentHeight() - height);
      range.max = String(max); range.value = String(viewport.getContentTop());
      const focused = (root instanceof ShadowRoot ? root.activeElement : document.activeElement) === range;
      range.hidden = max === 0;
      const size = `${Math.max(44, height)}px`;
      if (range.style.height !== size) range.style.height = size;
      if (range.hidden && focused) {
        (view.gear ?? root.querySelector<HTMLElement>("input.igv-search-input"))?.focus();
      }
    }
  }
  const observer = new MutationObserver(update);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
  window.addEventListener("resize", update, { signal: abort.signal });
  update();
  return () => {
    observer.disconnect(); abort.abort(); style.remove();
    for (const [thumb, range] of ranges) { delete thumb.dataset.igvNativeScroll; range.remove(); }
    for (const [viewport, id] of ids) { if (viewport.id === id) viewport.removeAttribute("id"); }
  };
}
