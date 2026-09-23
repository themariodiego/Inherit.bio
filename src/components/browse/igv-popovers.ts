interface TrackViewport {
  viewportElement: HTMLElement;
  trackLabelElement?: HTMLElement;
}

/** Keep the installed viewer's callbacks while making its transient surfaces
 * operable without a pointer. Native dialogs contain focus and Escape. */
export function enhanceIgvPopovers(container: HTMLElement, labels: Record<string, string>, browser: {
  trackViews: { gear?: HTMLElement; track: { name?: string }; viewports: TrackViewport[] }[];
  menuPopup: { popover: HTMLElement; hide(): void };
}): () => void {
  const root = container.shadowRoot ?? container;
  const abort = new AbortController();
  const bound = new WeakSet<HTMLElement>();
  const originalAttributes = new Map<Element, Map<string, string | null>>();
  const dialogs = new Map<HTMLElement, { dialog: HTMLDialogElement; opener: HTMLElement | null }>();
  const menu = browser.menuPopup.popover;
  let opener: HTMLElement | null = null;
  let menuWasOpen = false;
  let stopped = false;
  const set = (element: Element, key: string, value: string) => {
    if (element.getAttribute(key) === value) return;
    let saved = originalAttributes.get(element);
    if (!saved) { saved = new Map(); originalAttributes.set(element, saved); }
    if (!saved.has(key)) saved.set(key, element.getAttribute(key));
    element.setAttribute(key, value);
  };
  const focus = (element: HTMLElement | null) =>
    (element?.isConnected ? element : root.querySelector<HTMLElement>("input.igv-search-input"))?.focus();
  const activate = (element: HTMLElement, role: string, name?: string) => {
    set(element, "role", role); set(element, "data-igv-popup-action", "true");
    if (name) set(element, "aria-label", name);
    if (bound.has(element)) return;
    bound.add(element); set(element, "tabindex", role === "menuitem" ? "-1" : "0");
    let pressed: string | null = null;
    element.addEventListener("keydown", event => {
      if (event.target !== element || !["Enter", " "].includes(event.key)) return;
      pressed = event.key; event.preventDefault(); event.stopPropagation();
    }, { signal: abort.signal });
    element.addEventListener("keyup", event => {
      if (event.target !== element || pressed !== event.key) return;
      pressed = null; event.preventDefault(); event.stopPropagation(); element.click();
    }, { signal: abort.signal });
    element.addEventListener("blur", () => { pressed = null; }, { signal: abort.signal });
  };
  const style = document.createElement("style");
  style.dataset.inheritPopovers = "true";
  style.textContent = `
    [data-igv-popup-action] { min-width:44px; min-height:44px; box-sizing:border-box; cursor:pointer; }
    .igv-track-label[data-igv-popup-action] { display:flex; align-items:center; top:0; color:#222; background:white; }
    [data-igv-popup-action]:focus-visible, [data-igv-track-context]:focus-visible, dialog[data-igv-popup] :focus-visible { outline:2px solid #2e5c45; outline-offset:2px; }
    .igv-menu-popup[data-igv-context-menu] { position:fixed; color:#222; background:white; max-width:calc(100vw - 16px); max-height:calc(100dvh - 16px); overflow:auto; }
    .igv-menu-popup[data-igv-context-menu] [role=menuitem] { padding:8px; white-space:normal; }
    dialog[data-igv-popup] { color-scheme:light; color:#222; background:white; border:1px solid #666; border-radius:8px; padding:12px; margin:auto; max-width:calc(100vw - 24px); max-height:calc(100dvh - 24px); overflow:auto; box-sizing:border-box; font:14px sans-serif; }
    dialog[data-igv-popup]::backdrop { background:rgb(0 0 0 / 35%); }
    dialog[data-igv-popup] > div { position:static !important; transform:none !important; width:auto !important; min-width:0; max-width:100%; margin:0; border:0; box-shadow:none; }
    dialog[data-igv-popup] > div > div:first-child { min-height:44px; height:auto; }
    dialog[data-igv-popup] [data-igv-popup-action] { display:flex; align-items:center; justify-content:center; }
    dialog[data-igv-popup] [data-igv-popup-action] svg { width:20px; height:20px; }
    dialog[data-igv-popup] .igv-ui-alert-dialog-container > div:last-child > div { color:white; background:#2e5c45; padding:12px; }
    dialog[data-igv-popup] a { display:inline-flex; align-items:center; min-height:44px; }
  `;
  root.appendChild(style);
  const remember = (event: Event) => {
    const target = event.target as Element;
    opener = target.closest<HTMLElement>(".igv-track-label, [data-igv-track-context]") ?? opener;
  };
  root.addEventListener("pointerdown", remember, { capture: true, signal: abort.signal });
  root.addEventListener("contextmenu", remember, { capture: true, signal: abort.signal });
  const closeMenu = () => { browser.menuPopup.hide(); focus(opener); };
  menu.addEventListener("keydown", event => {
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const active = root instanceof ShadowRoot ? root.activeElement : document.activeElement;
    const at = items.indexOf(active as HTMLElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
      : event.key === "ArrowDown" ? (at + 1) % items.length
        : event.key === "ArrowUp" ? (at + items.length - 1) % items.length : -1;
    if (next >= 0) { event.preventDefault(); event.stopPropagation(); items[next]?.focus(); }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMenu(); }
    if (event.key === "Tab") { event.stopPropagation(); closeMenu(); }
  }, { signal: abort.signal });

  function update() {
    if (stopped) return;
    for (const view of browser.trackViews) {
      if (!view.gear) continue;
      for (const viewport of view.viewports) {
        const target = viewport.viewportElement;
        set(target, "role", "group"); set(target, "aria-label", `${labels.trackActions}: ${view.track.name || labels.referenceTrack}`);
        set(target, "aria-description", labels.trackActionsHint);
        if (!target.hasAttribute("data-igv-track-context")) {
          set(target, "data-igv-track-context", "true"); set(target, "tabindex", "0");
          target.addEventListener("keydown", event => {
            if (event.target !== target || !(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) return;
            event.preventDefault(); event.stopPropagation(); opener = target;
            const box = target.getBoundingClientRect();
            target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, composed: true, cancelable: true,
              clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }));
          }, { signal: abort.signal });
        }
        const label = viewport.trackLabelElement;
        if (label) {
          activate(label, "button", `${labels.trackDetails}: ${view.track.name || labels.referenceTrack}`);
          if (!label.hasAttribute("data-igv-details-trigger")) {
            set(label, "data-igv-details-trigger", "true");
            label.addEventListener("click", () => { opener = label; }, { capture: true, signal: abort.signal });
          }
        }
      }
    }
    set(menu, "role", "menu"); set(menu, "aria-label", labels.trackActions);
    set(menu, "data-igv-context-menu", "true");
    const open = menu.style.display !== "none";
    set(menu, "data-igv-interaction", open ? "open" : "closed");
    const close = menu.querySelector<HTMLElement>(".igv-menu-popup-header > div");
    if (close) activate(close, "menuitem", labels.closeMenu);
    for (const item of menu.querySelectorAll<HTMLElement>(":scope > div:last-child > .context-menu")) {
      if (item.textContent?.trim()) activate(item, "menuitem");
    }
    if (open) {
      const bounds = menu.getBoundingClientRect();
      const left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - bounds.width - 8))}px`;
      const top = `${Math.max(8, Math.min(bounds.top, window.innerHeight - bounds.height - 8))}px`;
      if (menu.style.left !== left) menu.style.left = left;
      if (menu.style.top !== top) menu.style.top = top;
      if (!menuWasOpen) {
        const first = menu.querySelector<HTMLElement>(".context-menu[role=menuitem]") ?? close;
        if (first) { set(first, "tabindex", "0"); first.focus(); }
      }
    } else if (menuWasOpen) focus(opener);
    menuWasOpen = open;

    for (const source of root.querySelectorAll<HTMLElement>(".igv-track-label-popover, .igv-ui-popover, .igv-ui-alert-dialog-container")) {
      if (dialogs.has(source) || source.style.display === "none") continue;
      const title = source.querySelector<HTMLElement>(".igv-track-label-popover__title")?.textContent?.trim();
      const alert = source.matches(".igv-ui-alert-dialog-container");
      const close = source.querySelector<HTMLElement>(alert ? ":scope > div:last-child > div"
        : ".igv-track-label-popover__close, :scope > div:first-child > div:last-child");
      if (!close) continue;
      activate(close, "button", alert ? undefined : labels.closeDialog);
      const dialog = document.createElement("dialog");
      dialog.dataset.igvPopup = "true"; dialog.dataset.igvInteraction = "open";
      dialog.setAttribute("aria-label", title || (alert ? labels.trackMessage : labels.positionDetails));
      source.before(dialog); dialog.appendChild(source);
      dialogs.set(source, { dialog, opener });
      dialog.addEventListener("cancel", event => { event.preventDefault(); close.click(); }, { signal: abort.signal });
      dialog.addEventListener("keydown", event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close.click(); }
        if (event.key !== "Tab") return;
        const controls = [...dialog.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex="0"]')]
          .filter(element => !element.matches(":disabled") && element.getClientRects().length > 0);
        const active = root instanceof ShadowRoot ? root.activeElement : document.activeElement;
        if (event.shiftKey && active === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && active === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
      }, { capture: true, signal: abort.signal });
      dialog.showModal(); close.focus();
    }
    for (const [source, state] of dialogs) {
      if (!source.isConnected || source.style.display === "none") {
        state.dialog.close(); focus(state.opener);
        if (source.isConnected) state.dialog.before(source);
        state.dialog.remove(); dialogs.delete(source);
      }
    }
  }
  const observer = new MutationObserver(update);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
  window.addEventListener("resize", update, { signal: abort.signal });
  update();
  return () => {
    stopped = true; observer.disconnect(); abort.abort(); style.remove();
    browser.menuPopup.hide();
    for (const [source, { dialog }] of dialogs) {
      if (dialog.open) dialog.close();
      if (source.isConnected) dialog.before(source);
      dialog.remove();
    }
    for (const [element, attributes] of originalAttributes) {
      for (const [key, value] of attributes) {
        if (value === null) element.removeAttribute(key); else element.setAttribute(key, value);
      }
    }
  };
}
