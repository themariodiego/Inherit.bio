/** Explicit operator invocation, not a CI identity override. No provider key
 * enters an argument, file, global environment or infrastructure child. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { establishOwnedLinuxRuntime, ownedLinuxEnvironment, readPrivateOperatorPipe, releaseOwnedLinuxRuntime } from "../owned-linux-runtime";
import { freshT6ConfigSchema } from "./fresh-t6-config";
import { runFreshComprehension } from "./run-fresh-t6.mjs";

export const privateOperatorFrameSchema = z.object({ configuration: freshT6ConfigSchema,
  credential: z.string().min(1).max(8192).regex(/^[!-~]+$/).optional() }).strict().superRefine((value, context) => {
  const provider = value.configuration.run.provider;
  if (value.configuration.run.settings.maxAttempts !== 1)
    context.addIssue({ code: "custom", message: "Owned exclusive runtime does not automatically retry inference" });
  if (provider.kind === "local-deterministic-stub" ? value.credential !== undefined
    : !value.credential || provider.apiKeyVariable !== "COMPREHENSION_MODEL_API_KEY")
    context.addIssue({ code: "custom", message: "Exact private operator credential scope required" });
});

/** Ephemeral local app configuration; never a provider credential or CI identity. */
export function ownedLinuxAppBootstrap(): Record<string, string> {
  const generated = Object.fromEntries(([ ["BYOK_ENCRYPTION_KEY", "base64"], ["JOBS_SECRET", "hex"],
    ["CRON_SECRET", "hex"] ] as const).map(([name, encoding]) => [name, randomBytes(32).toString(encoding)]));
  return { ...generated, INHERIT_DISPOSABLE_LOCAL_E2E: "true",
    NEXT_PUBLIC_SITE_URL: "http://localhost:3100", NEXT_PUBLIC_APP_URL: "http://localhost:3100",
    INHERIT_TEST_JURISDICTION: "1", EMAIL_FROM: "Inherit <inherit@e2e.local>", RESEND_API_KEY: "re_e2e_mock",
    RESEND_BASE_URL: "http://127.0.0.1:8124" };
}

async function main() {
  const args = process.argv.slice(2);
  assert(args.length >= 2 && args[0] === "--owner" && args.every((item, index) => index < 2 || item === "--prepare"),
    "Use the exact public owner request and optional --prepare");
  const owner = JSON.parse(Buffer.from(args[1], "base64url").toString("utf8"));
  const capability = establishOwnedLinuxRuntime(owner);
  // Only this nonce crosses the ready channel. The authenticated owner waits
  // for it before feeding private data to this anonymous stdin pipe.
  process.stderr.write(`OWNED_LINUX_READY:${capability.proof.nonce}\n`);
  try {
    const input = privateOperatorFrameSchema.parse(await readPrivateOperatorPipe());
    Object.assign(process.env, ownedLinuxEnvironment(capability), ownedLinuxAppBootstrap());
    const provider = input.configuration.run.provider;
    const privateEnvironment = { PATH: process.env.PATH, LANG: "C.UTF-8",
      ...(provider.kind === "openai-compatible-chat" ? { [provider.apiKeyVariable]: input.credential! } : {}) };
    await runFreshComprehension(input.configuration, { operator: capability, prepare: args.includes("--prepare"),
      inferenceEnvironment: privateEnvironment });
    // Actual daemon absence, exact daemon/socket/lease identities, not a caller
    // success flag. Uncertain native cleanup retains the protected lease.
    releaseOwnedLinuxRuntime(capability);
  } catch {
    // Keep ownership if a run or any cleanup was uncertain. Private parsing
    // diagnostics, configuration, credentials and model identity stay hidden.
    throw new Error("Owned Linux comprehension stopped; inspect the private journal and public ownership receipt");
  }
}
if (process.argv[1]?.endsWith("/run-owned-linux.mts")) {
  main().catch(() => { console.error("Owned Linux comprehension refused; no private values printed"); process.exitCode = 1; });
}
