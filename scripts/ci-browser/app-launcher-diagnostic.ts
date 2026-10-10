/** Fixed startup facts only. Never accept an error message, request or value. */
export const APP_LAUNCHER_DIAGNOSTIC_PREFIX = "INHERIT_APP_LAUNCHER_DIAGNOSTIC:";
export const appLauncherStages = ["runtime-proof", "environment", "mail-relay", "inside-launcher",
  "app-configuration", "artifact-gateway", "database-proxy", "fixture", "next-app"] as const;
export type AppLauncherStage = typeof appLauncherStages[number];
export type AppLauncherDiagnostic = {
  mode: "host" | "inside" | "mail"; port: number | null; stage: AppLauncherStage;
  outcome: "starting" | "ready" | "refused" | "child-error" | "child-exit";
  exitCode: number | null; signal: string | null;
};
const signals = ["SIGABRT", "SIGBUS", "SIGFPE", "SIGHUP", "SIGILL", "SIGINT", "SIGKILL", "SIGPIPE",
  "SIGQUIT", "SIGSEGV", "SIGTERM", "SIGTRAP", "SIGUSR1", "SIGUSR2"];
const keys = ["mode", "port", "stage", "outcome", "exitCode", "signal"];
export function closedAppSignal(input: unknown): string | null {
  return typeof input === "string" && signals.includes(input) ? input : null;
}
export function appLauncherDiagnosticLine(input: unknown): string | null {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Object.keys(descriptors).length !== keys.length || keys.some(key => !descriptors[key] || !Object.hasOwn(descriptors[key], "value"))) return null;
    const value = Object.fromEntries(keys.map(key => [key, descriptors[key].value])) as AppLauncherDiagnostic;
    if (!["host", "inside", "mail"].includes(value.mode)
      || (value.mode === "mail" ? value.port !== null : ![3100, 3101, 3102, 3103, 3104, 3105].includes(value.port!))
      || !appLauncherStages.includes(value.stage)
      || !["starting", "ready", "refused", "child-error", "child-exit"].includes(value.outcome)
      || !(value.exitCode === null || Number.isInteger(value.exitCode) && value.exitCode >= 0 && value.exitCode <= 255)
      || !(value.signal === null || signals.includes(value.signal))) return null;
    return APP_LAUNCHER_DIAGNOSTIC_PREFIX + JSON.stringify(value);
  } catch { return null; }
}
