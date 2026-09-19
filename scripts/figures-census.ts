import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * G8.3's completeness half: which built pages can put a figure on a surface.
 *
 * The two-seed gate (`e2e/figures-two-seed.spec.ts`) differences the surfaces
 * it is told about. What it cannot know is whether it was told about every
 * surface, and a route that renders a figure nobody differenced is exactly
 * the anti-pattern the gate exists for — a designed layout whose number was
 * never proved to come from the person's own rows. So the set of surfaces is
 * measured here rather than listed: a page can render a figure only through
 * the two components that emit `data-figure-kind`, and a page reaches those
 * components through imports. Every `page.tsx` under `src/app` is walked
 * through its import graph, and the pages that reach a figure source are the
 * population `docs/figures-register.json`'s `census` section must account for,
 * in both directions.
 *
 * Static on purpose. A browser census would see one state per route — the
 * state the sweep happens to build — while a page's figures usually live in
 * states a sweep never reaches. The import graph is state-independent: if no
 * path leads from the page to a figure component, no state of that page can
 * render one.
 */
export const FIGURE_SOURCES = [
  "src/components/figures/figure.tsx",
  "src/components/figures/relative-figure.tsx",
] as const;

export interface BuiltPage {
  /** The register's route path: groups erased, dynamic segments kept as `[x]`. */
  route: string;
  /** Root-relative posix path of the page file. */
  file: string;
}

const PAGE_FILE = /^page\.(tsx|ts|jsx|js)$/;
/** `from "x"`, `import("x")` and a bare `import "x"`; comments and strings are not parsed, and need not be. */
const SPECIFIER = /\bfrom\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s+["']([^"']+)["']/g;
const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function posix(file: string): string {
  return file.split(path.sep).join("/");
}

/** Every page file under `app`, with the route it serves. */
export function builtPages(root: string, app = "src/app"): BuiltPage[] {
  const found: BuiltPage[] = [];
  const walk = (directory: string, segments: string[]) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        // Route groups are erased from the URL; parallel slots and private
        // folders never produce one.
        if (entry.name.startsWith("@") || entry.name.startsWith("_")) continue;
        const grouped = entry.name.startsWith("(") && entry.name.endsWith(")");
        walk(full, grouped ? segments : [...segments, entry.name]);
        continue;
      }
      if (PAGE_FILE.test(entry.name)) {
        found.push({ route: `/${segments.join("/")}`.replace(/^\/$/, "/"), file: posix(path.relative(root, full)) });
      }
    }
  };
  walk(path.join(root, app), []);
  return found;
}

/** The module specifiers a source file names, in order of appearance. */
export function importSpecifiers(source: string): string[] {
  return [...source.matchAll(SPECIFIER)].map(match => match[1] ?? match[2] ?? match[3]!).filter(Boolean);
}

/**
 * Resolve one specifier from one file to a root-relative source path, or null
 * for a package, a type-only alias this repository does not use, or a path
 * that resolves to nothing on disk.
 */
export function resolveImport(root: string, from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = path.join(root, "src", specifier.slice(2));
  else if (specifier.startsWith("./") || specifier.startsWith("../")) base = path.resolve(root, path.dirname(from), specifier);
  else return null;
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = base + suffix;
    try {
      if (statSync(candidate).isFile()) return posix(path.relative(root, candidate));
    } catch {
      // Not this candidate.
    }
  }
  return null;
}

/**
 * Does `file` reach any of `targets` through imports? Depth-first with a
 * shared visited set, so a cycle terminates and a graph is walked once per
 * page rather than once per edge.
 */
export function reachesAny(root: string, file: string, targets: ReadonlySet<string>,
  edges: Map<string, string[]> = new Map()): boolean {
  const seen = new Set<string>();
  const stack = [file];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    let dependencies = edges.get(current);
    if (!dependencies) {
      let source = "";
      try { source = readFileSync(path.join(root, current), "utf8"); } catch { source = ""; }
      dependencies = importSpecifiers(source)
        .map(specifier => resolveImport(root, current, specifier))
        .filter((resolved): resolved is string => resolved !== null);
      edges.set(current, dependencies);
    }
    for (const dependency of dependencies) {
      if (targets.has(dependency)) return true;
      if (!seen.has(dependency)) stack.push(dependency);
    }
  }
  return false;
}

/** The built pages that can put a figure on a surface. */
export function figureCapablePages(root: string, app = "src/app",
  sources: readonly string[] = FIGURE_SOURCES): BuiltPage[] {
  const targets = new Set(sources);
  const edges = new Map<string, string[]>();
  return builtPages(root, app).filter(page => reachesAny(root, page.file, targets, edges));
}

/** Does a concrete surface (`/genome/me/data/browser?q=rs762551`) belong to a route (`/genome/[subject]/data/browser`)? */
export function surfaceMatchesRoute(surface: string, route: string): boolean {
  const pathname = surface.split("?")[0]!;
  const pattern = new RegExp(`^${route.split("/").map(segment =>
    /^\[.+\]$/.test(segment) ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("/")}$`);
  return pattern.test(pathname);
}
