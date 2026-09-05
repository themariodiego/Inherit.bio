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
  "Score-panel coverage and why a validated score is unavailable",
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

/**
 * SSRF guard for the BYOK OpenAI-compatible base URL. The chat route fetches
 * this URL server-side, so on a hosted deployment a user could aim it at the
 * server's own network (cloud metadata, internal services). We ALWAYS block
 * link-local (incl. 169.254.169.254 cloud metadata), and block loopback/
 * private ranges unless the deployment opts in via ALLOW_PRIVATE_LLM_ENDPOINTS
 * — which is exactly the self-host / local-LLM case (ADR-0004), where the
 * server IS the user's machine and reaching localhost is intended.
 *
 * Returns null if allowed, or a reason string if the URL must be refused.
 */
export function ssrfReasonForBaseUrl(
  baseUrl: string,
  allowPrivate: boolean,
): string | null {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return "malformed base URL";
  }
  // Link-local (IPv4 169.254/16 and IPv6 fe80::/10) and the cloud-metadata IP
  // are refused unconditionally — never a legitimate LLM endpoint.
  if (/^169\.254\./.test(host) || /^fe80:/i.test(host)) {
    return "link-local address (possible cloud-metadata SSRF)";
  }
  if (allowPrivate) return null;

  const isLoopback =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".localhost");
  const isPrivateV4 =
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  const isPrivateV6 = /^(fc|fd)/i.test(host);
  const isInternalName = host.endsWith(".local") || host.endsWith(".internal");
  if (isLoopback || isPrivateV4 || isPrivateV6 || isInternalName) {
    return "private/loopback address blocked on this deployment (set ALLOW_PRIVATE_LLM_ENDPOINTS=true when self-hosting a local model)";
  }
  return null;
}
