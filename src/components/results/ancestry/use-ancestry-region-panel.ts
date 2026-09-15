"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Shared interaction only: each version still supplies its own rows and figures. */
export function useAncestryRegionPanel(visibleCodes: readonly string[]) {
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const openCode = selectedCode && visibleCodes.includes(selectedCode) ? selectedCode : null;
  const [activation, setActivation] = useState(0);
  const pathRefs = useRef(new Map<string, SVGPathElement>());
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const suppressOpen = useRef(false);
  const activationViewport = useRef<{ x: number; y: number } | null>(null);

  const pathRef = useCallback((code: string, element: SVGPathElement | null) => {
    if (element) pathRefs.current.set(code, element);
    else pathRefs.current.delete(code);
  }, []);

  const close = useCallback((returnFocus: boolean) => {
    setSelectedCode(null);
    if (!returnFocus || !openCode) return;
    const path = pathRefs.current.get(openCode);
    if (!path) return;
    suppressOpen.current = true;
    const viewport = activationViewport.current;
    // Close may be below the map. Return to the viewport where the person
    // activated the region, rather than recentering an irregular SVG path.
    path.focus({ preventScroll: viewport !== null });
    if (viewport) window.scrollTo({ left: viewport.x, top: viewport.y, behavior: "instant" });
    suppressOpen.current = false;
    activationViewport.current = null;
  }, [openCode]);

  const onHover = useCallback((code: string) => {
    if (suppressOpen.current) return;
    if (code !== openCode) activationViewport.current = null;
    setSelectedCode(code);
  }, [openCode]);

  const onActivate = useCallback((code: string) => {
    activationViewport.current = { x: window.scrollX, y: window.scrollY };
    setSelectedCode(code);
    setActivation(count => count + 1);
  }, []);

  useEffect(() => {
    if (activation > 0) closeRef.current?.focus();
  }, [activation]);

  useEffect(() => {
    if (!openCode) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(true);
    }
    function onClick(event: MouseEvent) {
      if (!(event.target instanceof Element) || panelRef.current?.contains(event.target)
        || event.target.closest('[data-slot="ancestry-map"] path[data-region]')) return;
      // Click follows the browser's pointer-focus step. Plain content can
      // focus AppShell's main (-1); it is still a request to dismiss, while
      // a chosen control must keep its own focus and activation.
      const control = event.target.closest('a[href],button,input,select,textarea,summary,label,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="switch"],[tabindex]:not([tabindex="-1"])');
      close(!control);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("click", onClick);
    };
  }, [openCode, close]);

  return { openCode, pathRef, panelRef, closeRef, onHover, onActivate, close };
}
