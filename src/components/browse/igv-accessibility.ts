/** Names and keyboard access for the installed genome widget. */
export function labelIgvControls(container: HTMLElement, labels: Record<string, string>) {
  try {
    const roots: ParentNode[] = [container];
    const collect = (root: ParentNode) => {
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot) { roots.push(element.shadowRoot); collect(element.shadowRoot); }
      }
    };
    if (container.shadowRoot) { roots.push(container.shadowRoot); collect(container.shadowRoot); }
    collect(container);
    const find = (selector: string): Element | null => {
      for (const root of roots) {
        const found = root.querySelector(selector);
        if (found) return found;
      }
      return null;
    };
    const findAll = (selector: string): Element[] =>
      roots.flatMap((root) => [...root.querySelectorAll(selector)]);
    const label = (el: Element | null, name: string, asButton = false) => {
      if (!el) return;
      if (!el.hasAttribute("aria-label")) el.setAttribute("aria-label", name);
      if (asButton && !el.hasAttribute("role")) {
        el.setAttribute("role", "button");
      }
      if (asButton && el instanceof HTMLElement && !el.hasAttribute("data-keyboard-button")) {
        el.tabIndex = 0;
        el.setAttribute("data-keyboard-button", "true");
        el.addEventListener("keydown", event => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          if (event.key === "Enter") el.click();
        });
        el.addEventListener("keyup", event => {
          if (event.key !== " ") return;
          event.preventDefault();
          el.click();
        });
      }
    };

    // Chromosome picker: a bare 26-option <select> with no name. Hidden by
    // the config below, but named in case a config change shows it again.
    label(
      find(".igv-chromosome-select-widget-container select"),
      labels.chromosome,
    );

    // Locus search box (placeholder-only otherwise) and its icon "button".
    label(find("input.igv-search-input"), labels.locusSearch);
    label(find(".igv-search-icon-container"), labels.locusSubmit, true);

    // Zoom widget: [zoom-out div] [slider] [zoom-in div], per ZoomWidget's
    // construction order in the igv dist.
    const zoom = find(".igv-zoom-widget");
    if (zoom) {
      label(zoom.querySelector("input[type='range']"), labels.zoomSlider);
      label(zoom.firstElementChild, labels.zoomOut, true);
      label(zoom.lastElementChild, labels.zoomIn, true);
    }

    // Navbar toggle buttons (cursor guide, center line, track labels, …)
    // are divs carrying only a title tooltip; promote it to a real name.
    for (const btn of findAll(".igv-navbar-text-button, .igv-navbar-icon-button")) {
      const title = btn.getAttribute("title");
      if (title) label(btn, title, true);
    }

    // The igv logo is decorative.
    find(".igv-logo")?.setAttribute("aria-hidden", "true");

    // The page's control-size rule cannot cross a shadow boundary. Apply the
    // same inherited token inside the widget, without changing display flags.
    for (const root of roots) {
      if (!(root instanceof ShadowRoot) || root.querySelector("style[data-inherit-controls]")) continue;
      const style = document.createElement("style");
      style.setAttribute("data-inherit-controls", "true");
      style.textContent = `
        .igv-navbar, .igv-navbar-left-container, .igv-navbar-right-container,
        .igv-navbar-genomic-location, .igv-locus-size-group, .igv-search-container {
          height: auto; min-height: var(--size-control, 44px); align-items: center;
        }
        .igv-windowsize-panel-container {
          white-space: nowrap; flex-shrink: 0; color: #444; background: #f3f3f3;
        }
        input.igv-search-input, .igv-zoom-widget input, [data-keyboard-button] {
          box-sizing: border-box; min-width: var(--size-control, 44px);
          min-height: var(--size-control, 44px);
        }
        [data-keyboard-button] { cursor: pointer; }
        [data-keyboard-button]:has(svg) { padding: 12px; }
        [data-keyboard-button] svg { width: 20px; height: 20px; }
        [data-keyboard-button]:focus-visible, input:focus-visible {
          outline: 2px solid var(--forest, #2e5c45); outline-offset: 2px;
        }
      `;
      root.appendChild(style);
    }
  } catch {
    // Labeling is progressive enhancement over igv internals — never fatal.
  }
}
