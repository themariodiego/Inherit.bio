"use client";

import { useEffect, useState } from "react";

export interface TocEntry {
  id: string;
  heading: string;
}

/**
 * The desktop table of contents: a sticky rail whose entry for the section at
 * the reading line carries `aria-current="location"`. The line is the page's
 * one anchor offset (`html { scroll-padding-top }`), so the section a link
 * scrolls to is the section the rail then marks. An IntersectionObserver with
 * a one-pixel band at that line reports the section under it; the hash wins
 * on a jump, because a short last section may never reach the line.
 */
export function LegalTocRail({ entries }: { entries: TocEntry[] }) {
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    const ids = entries.map((entry) => entry.id);
    const sections = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    if (sections.length === 0) return;

    const line = () =>
      parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 96;

    let observer: IntersectionObserver | null = null;
    const observe = () => {
      observer?.disconnect();
      const top = Math.round(line());
      observer = new IntersectionObserver(
        (records) => {
          for (const record of records) {
            if (record.isIntersecting) setCurrent(record.target.id);
          }
        },
        { rootMargin: `-${top}px 0px -${Math.max(0, window.innerHeight - top - 1)}px 0px` },
      );
      sections.forEach((section) => observer?.observe(section));
    };

    const onHash = () => {
      const id = decodeURIComponent(location.hash.slice(1));
      if (ids.includes(id)) setCurrent(id);
    };
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(observe);
    };

    observe();
    onHash();
    window.addEventListener("hashchange", onHash);
    window.addEventListener("resize", onResize);
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("resize", onResize);
    };
  }, [entries]);

  return (
    <nav aria-label="On this page" className="hidden lg:block">
      <div className="legal-toc">
        <p className="eyebrow">On this page</p>
        <ol>
          {entries.map((entry) => (
            <li key={entry.id}>
              <a
                href={`#${entry.id}`}
                aria-current={current === entry.id ? "location" : undefined}
              >
                {entry.heading}
              </a>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}
