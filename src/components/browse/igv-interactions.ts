interface IgvTrackView {
  gear?: HTMLElement;
  dragHandle: HTMLElement;
  track: { name?: string; type: string; height: number };
  setTrackHeight(height: number, force: boolean): void;
}

/** Keyboard and dialog behavior for the installed widget's dynamic controls.
 * Existing library callbacks still perform every track change. Native modal
 * wrappers provide focus containment, Escape and a viewport-bound top layer. */
export function enhanceIgvInteractions(container: HTMLElement, labels: Record<string, string>, browser: {
  trackViews: IgvTrackView[];
  startTrackDrag(view: IgvTrackView): void;
  updateTrackDrag(view: IgvTrackView): void;
  endTrackDrag(): void;
}): () => void {
  const root = container.shadowRoot ?? container;
  const abort = new AbortController();
  const bound = new WeakSet<HTMLElement>();
  const menus = new Map<HTMLElement, boolean>();
  const triggers = new Map<HTMLElement, HTMLElement>();
  const dialogs = new Map<HTMLElement, HTMLDialogElement>();
  let opener: HTMLElement | null = null;
  let lastAction = labels.trackSettings;
  let stopped = false;
  const attr = (element: Element, key: string, value: string) => {
    if (element.getAttribute(key) !== value) element.setAttribute(key, value);
  };
  const focusOpener = () => {
    (opener?.isConnected ? opener : root.querySelector<HTMLElement>("input.igv-search-input"))?.focus();
  };
  const activate = (element: HTMLElement, role = "button", name?: string) => {
    attr(element, "role", role);
    attr(element, "data-igv-action", "true");
    if (name) attr(element, "aria-label", name);
    if (bound.has(element)) return;
    bound.add(element);
    element.tabIndex = role.startsWith("menuitem") ? -1 : 0;
    let pressed: string | null = null;
    element.addEventListener("keydown", event => {
      if (event.target !== element || !["Enter", " "].includes(event.key)) return;
      pressed = event.key;
      event.preventDefault(); event.stopPropagation();
    }, { signal: abort.signal });
    element.addEventListener("keyup", event => {
      if (event.target !== element || pressed !== event.key) return;
      pressed = null;
      // Open on release: the library submits its newly focused dialog input
      // on Enter keyup. Opening on keydown would immediately submit it again.
      event.preventDefault(); event.stopPropagation(); element.click();
    }, { signal: abort.signal });
    element.addEventListener("blur", () => { pressed = null; }, { signal: abort.signal });
  };
  const menuItems = (menu: HTMLElement) => [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
  const closeMenu = (menu: HTMLElement) => { menu.style.display = "none"; focusOpener(); };
  const sourceDialogs = ".igv-ui-generic-dialog-container, .igv-ui-colorpicker-container";

  const style = document.createElement("style");
  style.dataset.inheritInteractions = "true";
  style.textContent = `
    .igv-gear-menu-column { width: var(--size-control, 44px); flex-shrink: 0; }
    .igv-track-drag-column { width: var(--size-control, 44px); flex-shrink: 0; }
    .igv-track-drag-handle[role=slider] { min-width: 44px; min-height: 44px; }
    .igv-track-drag-handle-color { background-color: #666 !important; }
    .igv-gear-menu-column > div > [data-igv-action] { margin: 0; padding: 12px; }
    [data-igv-action], dialog[data-igv-modal] input, dialog[data-igv-modal] button {
      box-sizing: border-box; min-width: var(--size-control, 44px); min-height: var(--size-control, 44px);
    }
    [data-igv-action] { cursor: pointer; }
    [data-igv-action] > svg { width: 20px; height: 20px; }
    [data-igv-action]:focus-visible, .igv-track-drag-handle:focus-visible, dialog[data-igv-modal] :focus-visible {
      outline: 2px solid #2e5c45; outline-offset: 2px;
    }
    .igv-menu-popup[role=menu] { position: fixed; right: auto; max-width: calc(100vw - 16px); max-height: calc(100vh - 32px); overflow-y: auto; color: #222; background: white; }
    .igv-menu-popup [role^=menuitem] { padding: 8px; white-space: normal; }
    .igv-menu-popup-header { min-height: 44px; }
    .igv-menu-popup-check-container { align-items: center; }
    dialog[data-igv-modal] {
      color-scheme: light; color: #222; background: white; border: 1px solid #666; border-radius: 8px;
      padding: 16px; margin: auto; box-sizing: border-box; max-width: calc(100vw - 24px);
      max-height: calc(100dvh - 24px); overflow: auto; font: 14px sans-serif;
    }
    dialog[data-igv-modal]::backdrop { background: rgb(0 0 0 / 35%); }
    dialog[data-igv-modal] > div {
      position: static !important; transform: none !important; margin: 0 !important;
      width: 260px !important; max-width: 100%; border: 0 !important; box-shadow: none;
    }
    dialog[data-igv-modal] > div > div:first-child { min-height: 44px; height: auto; }
    dialog[data-igv-modal] .igv-ui-generic-dialog-one-liner { white-space: normal; height: auto; }
    dialog[data-igv-modal] .igv-ui-generic-dialog-input { width: 100%; height: auto; margin: 8px 0; }
    dialog[data-igv-modal] input { width: 100%; color: #222; background: white; border: 1px solid #666; }
    dialog[data-igv-modal] .igv-ui-generic-dialog-ok-cancel { height: auto; gap: 8px; margin: 8px 0; }
    dialog[data-igv-modal] .igv-ui-generic-dialog-ok-cancel > div[data-igv-action] { background: #2e5c45; color: white; padding: 12px; }
    dialog[data-igv-modal] .igv-ui-colorpicker-container > div:nth-child(2),
    dialog[data-igv-modal] .igv-ui-colorpicker-container > div:nth-child(4) {
      display: flex; flex-wrap: wrap; gap: 4px; height: auto; padding: 2px; width: 100%; box-sizing: border-box;
    }
    dialog[data-igv-modal] .igv-ui-color-swatch { margin: 0; border: 1px solid #444; }
    dialog[data-igv-modal] .igv-ui-colorpicker-container > div:nth-child(3) {
      position: relative; width: 100%; height: auto; min-height: 44px; color: #222; background: #eee;
    }
    dialog[data-igv-modal] .igv-ui-colorpicker-container > div:nth-child(3) > div { position: static !important; width: 100% !important; height: auto !important; }
    dialog[data-igv-modal] .picker_wrapper { position: static; margin: 0; width: 100%; box-sizing: border-box; }
    dialog[data-igv-modal] .picker_arrow { display: none; }
    dialog[data-igv-modal] .picker_hue { min-height: 44px; }
    dialog[data-igv-modal] .picker_done button { color: white; background: #2e5c45; }
  `;
  root.appendChild(style);

  function update() {
    if (stopped) return;
    for (const view of browser.trackViews) {
      if (view.gear && view.track.height < 44) view.setTrackHeight(44, true);
      if (view.gear) attr(view.gear, "aria-label", `${labels.trackSettings}: ${view.track.name || labels.referenceTrack}`);
      const handle = view.dragHandle;
      if (!handle.classList.contains("igv-track-drag-handle")) continue;
      const movable = browser.trackViews.filter(item => item.dragHandle.classList.contains("igv-track-drag-handle"));
      attr(handle, "role", "slider"); attr(handle, "aria-orientation", "vertical");
      attr(handle, "aria-label", `${labels.trackOrder}: ${view.track.name || labels.referenceTrack}`);
      attr(handle, "aria-valuemin", "1"); attr(handle, "aria-valuemax", String(movable.length));
      attr(handle, "aria-valuenow", String(movable.indexOf(view) + 1)); handle.tabIndex = 0;
      if (!bound.has(handle)) {
        bound.add(handle);
        handle.addEventListener("keydown", event => {
          const tracks = browser.trackViews.filter(item => item.dragHandle.classList.contains("igv-track-drag-handle"));
          const at = tracks.indexOf(view);
          const next = event.key === "Home" ? 0 : event.key === "End" ? tracks.length - 1
            : ["ArrowUp", "ArrowLeft"].includes(event.key) ? Math.max(0, at - 1)
              : ["ArrowDown", "ArrowRight"].includes(event.key) ? Math.min(tracks.length - 1, at + 1) : -1;
          if (next < 0) return;
          event.preventDefault(); event.stopPropagation();
          if (next !== at) { browser.startTrackDrag(view); browser.updateTrackDrag(tracks[next]); browser.endTrackDrag(); handle.focus(); }
        }, { signal: abort.signal });
      }
    }
    for (const gear of root.querySelectorAll<HTMLElement>(".igv-gear-menu-column > div > div")) {
      const popup = gear.querySelector<HTMLElement>(":scope > .igv-menu-popup");
      if (popup && !triggers.has(popup)) { triggers.set(popup, gear); root.appendChild(popup); }
      if (![...triggers.values()].includes(gear)) continue;
      activate(gear, "button");
      attr(gear, "aria-haspopup", "menu");
      if (!gear.hasAttribute("data-igv-opener")) {
        attr(gear, "data-igv-opener", "true");
        gear.addEventListener("click", () => { opener = gear; }, { signal: abort.signal });
        gear.addEventListener("keydown", event => {
          if (event.target === gear && event.key === "ArrowDown") {
            event.preventDefault(); event.stopPropagation(); gear.click();
          }
        }, { signal: abort.signal });
      }
    }
    for (const [menu, gear] of triggers) {
      if (!gear.isConnected) {
        if (menus.get(menu)) focusOpener();
        menu.remove(); menus.delete(menu); triggers.delete(menu); continue;
      }
      const wasOpen = menus.get(menu);
      const open = menu.style.display !== "none";
      attr(menu, "role", "menu"); attr(menu, "aria-label", labels.trackSettings);
      attr(menu, "data-igv-interaction", open ? "open" : "closed");
      attr(gear, "aria-expanded", String(open));
      const close = menu.querySelector<HTMLElement>(":scope > .igv-menu-popup-header > div");
      if (close) activate(close, "menuitem", labels.closeMenu);
      for (const item of menu.querySelectorAll<HTMLElement>(":scope > div:last-child > div")) {
        const check = item.classList.contains("igv-menu-popup-check-container");
        const independent = browser.trackViews.find(view => view.gear === gear)?.track.type === "sequence";
        activate(item, check ? independent ? "menuitemcheckbox" : "menuitemradio" : "menuitem");
        if (check) attr(item, "aria-checked", String(item.querySelector("svg path")?.getAttribute("fill") !== "transparent"));
      }
      if (wasOpen === undefined) {
        menu.addEventListener("click", event => {
          const target = (event.target as Element).closest<HTMLElement>('[role^="menuitem"]');
          if (target) lastAction = target.textContent?.trim() || labels.trackSettings;
        }, { capture: true, signal: abort.signal });
        menu.addEventListener("keydown", event => {
          const items = menuItems(menu), active = root instanceof ShadowRoot ? root.activeElement : document.activeElement;
          const at = items.findIndex(item => item === active);
          const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
            : event.key === "ArrowDown" ? (at + 1) % items.length
              : event.key === "ArrowUp" ? (at + items.length - 1) % items.length : -1;
          if (next >= 0) { event.preventDefault(); event.stopPropagation(); items[next]?.focus(); }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(menu); }
          if (event.key === "Tab") { event.stopPropagation(); closeMenu(menu); }
        }, { signal: abort.signal });
      }
      menus.set(menu, open);
      if (open) {
        const bounds = menu.getBoundingClientRect(), anchor = gear.getBoundingClientRect();
        const left = `${Math.max(8, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 8))}px`;
        const top = `${Math.max(8, Math.min(anchor.bottom, window.innerHeight - bounds.height - 8))}px`;
        if (menu.style.left !== left) menu.style.left = left;
        if (menu.style.top !== top) menu.style.top = top;
      }
      if (open && !wasOpen) {
        opener = gear;
        const first = menu.querySelector<HTMLElement>(":scope > div:last-child > [role^=menuitem]") ?? close;
        if (first) { first.tabIndex = 0; first.focus(); }
      } else if (!open && wasOpen && ![...root.querySelectorAll<HTMLElement>(sourceDialogs)].some(dialog => dialog.style.display !== "none")) {
        focusOpener();
      }
    }
    for (const source of root.querySelectorAll<HTMLElement>(sourceDialogs)) {
      let dialog = dialogs.get(source);
      const input = source.querySelector<HTMLInputElement>(".igv-ui-generic-dialog-input input");
      const title = source.querySelector<HTMLElement>(".igv-ui-generic-dialog-one-liner");
      const close = source.querySelector<HTMLElement>(":scope > div:first-child > div");
      if (!dialog) {
        dialog = document.createElement("dialog"); dialog.dataset.igvModal = "true";
        source.before(dialog); dialog.appendChild(source); dialogs.set(source, dialog);
        dialog.addEventListener("cancel", event => { event.preventDefault(); close?.click(); }, { signal: abort.signal });
        dialog.addEventListener("keydown", event => {
          if (event.key === "Escape") {
            event.preventDefault(); event.stopPropagation(); close?.click(); return;
          }
          if (event.key !== "Tab") return;
          const controls = [...source.querySelectorAll<HTMLElement>('input, button, [tabindex="0"]')]
            .filter(element => !element.matches(":disabled") && element.getClientRects().length > 0);
          const active = root instanceof ShadowRoot ? root.activeElement : document.activeElement;
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && active === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && active === last) { event.preventDefault(); first?.focus(); }
        }, { capture: true, signal: abort.signal });
      }
      if (close) activate(close, "button", labels.closeDialog);
      if (input && title) attr(input, "aria-label", title.textContent?.trim() || labels.trackSettings);
      if (input && title?.textContent === "Track Height") {
        input.type = "number"; input.min = "44";
        if (!input.hasAttribute("data-igv-height")) {
          attr(input, "data-igv-height", "true");
          input.addEventListener("keyup", event => {
            if (event.key === "Enter" && !input.reportValidity()) {
              event.preventDefault(); event.stopImmediatePropagation();
            }
          }, { capture: true, signal: abort.signal });
          source.querySelector<HTMLElement>(".igv-ui-generic-dialog-ok-cancel > div")?.addEventListener("click", event => {
            if (!input.reportValidity()) { event.preventDefault(); event.stopImmediatePropagation(); }
          }, { capture: true, signal: abort.signal });
        }
      } else if (input) { input.type = "text"; input.removeAttribute("min"); }
      for (const button of source.querySelectorAll<HTMLElement>(".igv-ui-generic-dialog-ok-cancel > div")) activate(button);
      for (const swatch of source.querySelectorAll<HTMLElement>(".igv-ui-color-swatch")) {
        activate(swatch, "button", `${labels.color} ${swatch.style.backgroundColor}`);
      }
      if (source.matches(".igv-ui-colorpicker-container")) {
        const more = source.children[2] as HTMLElement;
        activate(more, "button", labels.moreColors);
        const pickers = [...more.querySelectorAll<HTMLElement>(".picker_wrapper")];
        if (pickers.length === 0 && more.dataset.igvPickerOpen === "true") {
          more.tabIndex = 0; attr(more, "data-igv-picker-open", "false"); more.focus();
        }
        for (const picker of pickers) {
          attr(more, "data-igv-picker-open", "true");
          attr(more, "role", "group"); more.tabIndex = -1;
          // The library already wires a text editor to the exact same color
          // callbacks. Expose it as the keyboard alternative to its gradients.
          picker.classList.remove("no_editor");
          const editor = picker.querySelector<HTMLInputElement>(".picker_editor input");
          if (editor) attr(editor, "aria-label", labels.colorValue);
          if (!picker.hasAttribute("data-igv-editor")) {
            attr(picker, "data-igv-editor", "true"); editor?.focus();
          }
        }
      }
      const open = source.style.display !== "none";
      attr(dialog, "data-igv-interaction", open ? "open" : "closed");
      attr(dialog, "aria-label", title?.textContent?.trim() || lastAction);
      if (open && !dialog.open) { dialog.showModal(); (input ?? close)?.focus(); }
      else if (!open && dialog.open) { dialog.close(); focusOpener(); }
    }
  }
  const observer = new MutationObserver(update);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
  window.addEventListener("resize", update, { signal: abort.signal });
  root.addEventListener("scroll", update, { capture: true, signal: abort.signal });
  update();
  return () => {
    stopped = true; observer.disconnect(); abort.abort(); style.remove();
    for (const [source, dialog] of dialogs) {
      if (dialog.open) dialog.close();
      for (const input of source.querySelectorAll("[data-igv-height]")) input.removeAttribute("data-igv-height");
      dialog.before(source); dialog.remove();
    }
    for (const gear of root.querySelectorAll("[data-igv-opener]")) gear.removeAttribute("data-igv-opener");
    for (const [menu, gear] of triggers) { if (gear.isConnected) gear.appendChild(menu); else menu.remove(); }
  };
}
