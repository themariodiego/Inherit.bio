// Copilot provider policy. "Local" endpoints (reachable only from the
// user's own machine/network) are the privacy-preferred path and skip the
// cloud-consent dialog — nothing leaves the user's infrastructure. Anything
// else is a cloud provider and requires a stored, revocable consent grant
// naming the provider before any genome-derived data is sent.

export const ANTHROPIC_MODELS = ["claude-sonnet-5", "claude-opus-5"] as const;
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

/** Data classes sent to the LLM provider during chat, named in the consent dialog. */
export const LLM_DATA_CLASSES = [
  "Individual genotypes you ask about (rsID, genotype)",
  "Variant search results (gene, position, genotype)",
  "Report titles, interpretations and coverage states",
  "Polygenic score results (score, percentile, coverage)",
  "Your chat messages",
] as const;

export function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    const h = u.hostname;
    if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]")
      return true;
    if (/^10\.\d+\.\d+\.\d+$/.test(h)) return true;
    if (/^192\.168\.\d+\.\d+$/.test(h)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h)) return true;
    if (h.endsWith(".local") || h.endsWith(".internal")) return true;
    return false;
  } catch {
    return false;
  }
}

/** Stable key identifying the provider in consent_grants. */
export function providerKeyFor(
  provider: "anthropic" | "openai_compatible",
  baseUrl: string | null,
): string {
  if (provider === "anthropic") return "anthropic";
  try {
    return new URL(baseUrl ?? "").host || "openai_compatible";
  } catch {
    return "openai_compatible";
  }
}

export function providerDisplayName(providerKey: string): string {
  if (providerKey === "anthropic") return "Anthropic (Claude)";
  return providerKey;
}
