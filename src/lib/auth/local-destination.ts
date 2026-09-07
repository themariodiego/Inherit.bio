const FALLBACK = "/overview";
const BASE = "https://auth-destination.invalid";

function unsafeCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 || character === "\\";
  });
}

/** A local absolute path, preserved verbatim for both router.push and redirects. */
export function localAuthDestination(value: string | null | undefined): string {
  if (!value || unsafeCharacters(value)) return FALLBACK;
  // Only the pathname can introduce an authority. Query/fragment values may
  // legitimately contain encoded URLs; do not reinterpret them as destinations.
  let path = value.split(/[?#]/, 1)[0];
  for (let depth = 0; depth < 5; depth += 1) {
    if (!path.startsWith("/") || path.startsWith("//") || unsafeCharacters(path)) {
      return FALLBACK;
    }
    try {
      const resolved = new URL(path, BASE);
      // Also refuse a double slash exposed by dot-segment normalization.
      if (resolved.origin !== BASE || resolved.pathname.startsWith("//")) return FALLBACK;
      const decoded = decodeURIComponent(path);
      if (decoded === path) return value;
      path = decoded;
    } catch {
      return FALLBACK;
    }
  }
  // Excessively nested encodings are ambiguous, not a reason to skip validation.
  return FALLBACK;
}
