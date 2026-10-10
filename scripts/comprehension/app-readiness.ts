import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { APP_LAUNCHER_DIAGNOSTIC_PREFIX, appLauncherDiagnosticLine, closedAppSignal, type AppLauncherDiagnostic } from "../ci-browser/app-launcher-diagnostic";

export class OwnedAppReadinessFailure extends Error {
  readonly observation: {
    port: 3100 | 3105; reason: "child-exited" | "deadline";
    exitCode: number | null; signal: string | null; responseStatus: number | null;
    launcher: AppLauncherDiagnostic[];
  };
  constructor(child: Pick<ChildProcess, "exitCode" | "signalCode">, port: 3100 | 3105,
    reason: "child-exited" | "deadline", responseStatus: number | null, launcher: readonly AppLauncherDiagnostic[]) {
    super("Owned app did not become ready");
    assert([3100, 3105].includes(port) && ["child-exited", "deadline"].includes(reason), "Closed readiness port and reason required");
    const exitCode = child.exitCode === null || Number.isInteger(child.exitCode) && child.exitCode >= 0 && child.exitCode <= 255
      ? child.exitCode : null;
    assert(responseStatus === null || Number.isInteger(responseStatus) && responseStatus >= 200 && responseStatus <= 599);
    const safe = launcher.slice(0, 32).flatMap(item => {
      const line = appLauncherDiagnosticLine(item);
      return line === null ? [] : [JSON.parse(line.slice(APP_LAUNCHER_DIAGNOSTIC_PREFIX.length)) as AppLauncherDiagnostic];
    });
    this.observation = { port, reason, exitCode, signal: closedAppSignal(child.signalCode), responseStatus, launcher: safe };
  }
}

/** The original 60-second limit and exact 200 requirement stay fixed. */
export async function waitForOwnedApp(child: ChildProcess, port: 3100 | 3105, signal: AbortSignal,
  launcher: readonly AppLauncherDiagnostic[]) {
  const deadline = Date.now() + 60_000;
  let responseStatus: number | null = null;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new OwnedAppReadinessFailure(child, port, "child-exited", responseStatus, launcher);
    }
    try {
      const result = await fetch(`http://localhost:${port}/`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]), redirect: "manual",
      });
      responseStatus = result.status;
      if (responseStatus === 200) return;
    } catch { signal.throwIfAborted(); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new OwnedAppReadinessFailure(child, port, "deadline", responseStatus, launcher);
}
