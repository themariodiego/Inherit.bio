import { removeOwnCopilotSettings, saveOwnCopilotSettings } from "@/lib/copilot/own-settings";
import { withAccountCsrf } from "@/lib/security/session-csrf";

// The register's bodies and llm-settings-v1 answers (G8.5, 23 October 2026).
// Saving never grants canonical Copilot permission; settings, key and
// revocation commit together, and the DELETE consumes the page's nonce.
// Both carry the settings page's one-time X-Inherit-CSRF token.
export const POST = withAccountCsrf("api.llm-settings", saveOwnCopilotSettings);
export const DELETE = withAccountCsrf("api.llm-settings", removeOwnCopilotSettings);
