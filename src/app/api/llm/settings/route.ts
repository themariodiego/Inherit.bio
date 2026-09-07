import { removeOwnCopilotSettings, saveOwnCopilotSettings } from "@/lib/copilot/own-settings";

// The legacy request/response shape remains usable. Saving never grants
// canonical Copilot permission; settings, key and revocation commit together.
export const POST = saveOwnCopilotSettings;
export const DELETE = removeOwnCopilotSettings;
