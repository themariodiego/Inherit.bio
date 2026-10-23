import { removeOwnCopilotSettings, saveOwnCopilotSettings } from "@/lib/copilot/own-settings";

// The register's bodies and llm-settings-v1 answers (G8.5, 23 October 2026).
// Saving never grants canonical Copilot permission; settings, key and
// revocation commit together, and the DELETE consumes the page's nonce.
export const POST = saveOwnCopilotSettings;
export const DELETE = removeOwnCopilotSettings;
