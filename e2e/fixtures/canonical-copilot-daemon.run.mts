import { startCanonicalCopilotDaemon } from "./canonical-copilot-daemon";
const daemon = await startCanonicalCopilotDaemon({ keyPath: "/tls/fixture/model.key", certificatePath: "/tls/fixture/model.crt" });
console.log("Synthetic Copilot fixture control is ready on port 8130.");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void daemon.stop().then(() => process.exit(0)); });
