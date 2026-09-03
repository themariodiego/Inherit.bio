/**
 * Global search copy (brief §2 §1.3): the header button, the dialog, the four
 * group labels in their mandated order, the empty and no-results sentences
 * and the shortcut hint. Plain words only; the short labels are checked
 * against data/plain-vocabulary.json by `pnpm gate:readability`.
 *
 * The group ids are src/lib/search/match.ts GROUP_ORDER; the labels here are
 * the only place the four strings are spelled. There is no Help group.
 */
import type { SearchGroupId } from "@/lib/search/match";
import { route, type RouteId } from "@/lib/primary-routes";

export const SEARCH = {
  /** The header button's accessible name. */
  button: "Search",
  /** The dialog's title; the dialog is labelled by it. */
  title: "Search Inherit",
  inputLabel: "Find a person, a report or a page",
  placeholder: "Type to search",
  closeButton: "Close",
  /** Shown before anything has been typed. */
  empty: "Results show here as you type.",
  /** Shown in the live region when a query matches nothing. */
  noResults: "No results for this search. Try another word.",
  /** The visible shortcut hint beside the button, by platform. */
  shortcut: { mac: "⌘K", other: "Ctrl K" },
  /** ARIA form of the same shortcut, for the button's aria-keyshortcuts. */
  ariaKeyShortcuts: "Meta+K Control+K",
} as const;

/** The four group labels, exactly as the brief spells them, keyed by GROUP_ORDER id. */
export const SEARCH_GROUP_LABELS: Readonly<Record<SearchGroupId, string>> = {
  people: "People and embryos",
  reports: "Reports",
  ancestry: "Ancestry regions",
  settings: "Settings",
};

export interface SettingsSearchPage {
  id: Extract<RouteId, `settings.${string}`>;
  /** The page's h1, so a result reads like its destination. */
  label: string;
  href: string;
  /** Matched but never shown: the group word and the settings index card title. */
  terms: readonly string[];
}

/** The settings pages the register lists, in register order. */
export const SETTINGS_SEARCH_PAGES: readonly SettingsSearchPage[] = [
  { id: "settings.index", label: "Settings", href: route("settings.index"), terms: ["Settings"] },
  { id: "settings.data", label: "Your data", href: route("settings.data"), terms: ["Settings", "Data"] },
  {
    id: "settings.copilot",
    label: "Copilot model",
    href: route("settings.copilot"),
    terms: ["Settings", "Copilot"],
  },
  {
    id: "settings.people",
    label: "People and relationships",
    href: route("settings.people"),
    terms: ["Settings", "People"],
  },
  {
    id: "settings.consents",
    label: "Consents",
    href: route("settings.consents"),
    terms: ["Settings", "Consents"],
  },
];
