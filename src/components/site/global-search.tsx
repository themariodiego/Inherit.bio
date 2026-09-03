"use client";

/**
 * <GlobalSearch> — the one global search (brief §2 §1.3): a header button
 * labelled "Search" with the visible shortcut hint, opening a native modal
 * <dialog> (labelled by its title) with a labelled search input. ⌘K/Ctrl+K
 * opens it from any app page; Escape closes it and focus returns to where it
 * was, or to the button. Results come from /api/search, debounced and with
 * stale requests aborted, rendered as one list per group under a <p> label
 * (never a heading: Overview caps headings at four). Arrow keys move focus
 * between result links, Enter follows one. The chip on a subject-derived row
 * is plain text beside the label. Search returns destinations only.
 */
import { Search as SearchIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { SEARCH } from "@/copy/search";
import type { SearchGroup } from "@/lib/search/match";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 150;

interface Results {
  /** The trimmed query these groups answer. */
  query: string;
  groups: SearchGroup[];
}

const subscribeNever = () => () => {};

/** The platform's shortcut hint; the server renders the non-Mac form and the client corrects it once. */
function useShortcutHint(): string {
  return useSyncExternalStore(
    subscribeNever,
    () => (/Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? SEARCH.shortcut.mac : SEARCH.shortcut.other),
    () => SEARCH.shortcut.other,
  );
}

export function GlobalSearch() {
  const router = useRouter();
  const titleId = useId();
  const inputId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  /** Where focus was when the dialog opened, so closing can hand it back. */
  const openerRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Results | null>(null);
  const shortcutHint = useShortcutHint();

  const open = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) {
      const active = document.activeElement;
      openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
      dialog.showModal();
    }
    inputRef.current?.focus();
  }, []);

  const close = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
  }, []);

  // The dialog's own close (Escape, the Close button, a followed link):
  // clear the query and hand focus back to the opener, or to the button.
  const onClosed = useCallback(() => {
    setQuery("");
    setResults(null);
    const opener = openerRef.current;
    openerRef.current = null;
    (opener?.isConnected ? opener : buttonRef.current)?.focus();
  }, []);

  // ⌘K / Ctrl+K from anywhere on the page.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        open();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Debounced fetch; a newer keystroke aborts the request in flight.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === "") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        if (!response.ok) throw new Error(`search answered ${response.status}`);
        const body = (await response.json()) as { groups?: SearchGroup[] };
        setResults({ query: trimmed, groups: Array.isArray(body.groups) ? body.groups : [] });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResults({ query: trimmed, groups: [] });
      }
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const trimmedQuery = query.trim();
  const groups = trimmedQuery === "" ? [] : (results?.groups ?? []);
  const answered = trimmedQuery !== "" && results?.query === trimmedQuery;
  const noResults = answered && groups.length === 0;
  const firstHref = groups[0]?.results[0]?.href;

  function resultLinks(): HTMLAnchorElement[] {
    return Array.from(listRef.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? []);
  }

  function onDialogKeyDown(event: ReactKeyboardEvent<HTMLDialogElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const links = resultLinks();
    if (links.length === 0) return;
    event.preventDefault();
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (event.key === "ArrowDown") {
      links[index < 0 ? 0 : Math.min(index + 1, links.length - 1)].focus();
    } else if (index <= 0) {
      inputRef.current?.focus();
    } else {
      links[index - 1].focus();
    }
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && firstHref) {
      event.preventDefault();
      close();
      router.push(firstHref);
    }
  }

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        aria-haspopup="dialog"
        aria-keyshortcuts={SEARCH.ariaKeyShortcuts}
        data-slot="global-search-button"
        className="h-11 min-w-11 justify-start gap-2 px-3 text-ink-muted hover:text-ink sm:min-w-52"
        onClick={open}
      >
        <SearchIcon aria-hidden="true" />
        <span>{SEARCH.button}</span>
        <kbd
          aria-hidden="true"
          className="ml-auto hidden rounded-md border border-line bg-tint px-1.5 py-0.5 font-sans text-sm text-ink-muted sm:inline"
        >
          {shortcutHint}
        </kbd>
      </Button>

      <dialog
        ref={dialogRef}
        aria-modal="true"
        aria-labelledby={titleId}
        data-slot="global-search"
        onClose={onClosed}
        onKeyDown={onDialogKeyDown}
        className={cn(
          "m-auto mt-[10vh] w-[min(40rem,calc(100vw-2rem))] rounded-2xl border border-line bg-card p-0 text-ink shadow-lg",
          "backdrop:bg-ink/40",
        )}
      >
        <div className="flex flex-col gap-4 p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <p id={titleId} className="text-base font-medium text-ink">
              {SEARCH.title}
            </p>
            <Button type="button" variant="ghost" className="h-11 px-3" onClick={close}>
              {SEARCH.closeButton}
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor={inputId} className="text-sm text-ink-muted">
              {SEARCH.inputLabel}
            </label>
            <input
              ref={inputRef}
              id={inputId}
              type="search"
              autoComplete="off"
              spellCheck={false}
              placeholder={SEARCH.placeholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
              className="h-11 w-full rounded-xl border border-line bg-paper px-3 text-base text-ink outline-none placeholder:text-ink-muted focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>

          <div ref={listRef} className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
            {trimmedQuery === "" ? <p className="text-sm text-ink-muted">{SEARCH.empty}</p> : null}
            {groups.map((group) => {
              const labelId = `${titleId}-${group.id}`;
              return (
                <div key={group.id} role="group" aria-labelledby={labelId} data-search-group={group.id}>
                  <p id={labelId} data-slot="search-group-label" className="eyebrow mb-1 px-3">
                    {group.label}
                  </p>
                  <ul className="flex flex-col">
                    {group.results.map((result) => (
                      <li key={result.href}>
                        <Link
                          href={result.href}
                          onClick={close}
                          className="flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm text-ink outline-none hover:bg-tint focus-visible:bg-tint focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          <span className="min-w-0 truncate">{result.label}</span>
                          {result.chip ? (
                            <span
                              data-slot="search-chip"
                              className="ml-auto shrink-0 rounded-full border border-line px-2 py-0.5 text-sm text-ink-muted"
                            >
                              {result.chip}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            <p role="status" aria-live="polite" className={cn("text-sm text-ink-muted", !noResults && "sr-only")}>
              {noResults ? SEARCH.noResults : ""}
            </p>
          </div>
        </div>
      </dialog>
    </>
  );
}
