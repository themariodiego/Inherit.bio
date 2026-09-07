# Canonical Copilot browser fixtures

The original three browser specs retain 68 cases, including all 64 unchanged entries in `copilot-output-cases.json`. They prepare actual restricted-Storage sources and explicitly generate chosen polygenic reports. They never insert purpose grants or fabricated completed analyses.

The synthetic model must run inside the separately verified app network namespace. Its hostname is `model.copilot.test`, its HTTPS ports are fixed at 8123/8125/8126, and the actual application classifier/resolver/pinning/consent checks remain enabled. The daemon forwards each exact `/v1/chat/completions` POST only to its same-process loopback fixture. It never fetches any other destination. Host tests use a host-loopback-published control port and set `CANONICAL_COPILOT_CONTROL_URL=http://127.0.0.1:<published-port>`. Missing setup fails; there is no loopback-as-cloud fallback or conditional skip.

After root integrates the runtime and establishes the documented container firewall, synthetic /32 loopback route, container-only hostname and ephemeral trusted certificate:

```sh
# Inside the isolated container, as the unprivileged application user:
node node_modules/tsx/dist/cli.mjs e2e/fixtures/canonical-copilot-daemon.run.mts
# Host browser invocation remains under the actual-provider runner selected by root.
# Pass CANONICAL_COPILOT_CONTROL_URL in that runner's environment.
```

Private keys stay in `/tls/fixture` tmpfs; only the app process uses `NODE_EXTRA_CA_CERTS`. The control daemon itself does not configure networking, establish trust, bootstrap Storage or start the app. A successful fixture check is not an application browser pass or a complete CI gate.

Standalone fixture verification (no app/DB/browser/external model):

```sh
node node_modules/tsx/dist/cli.mjs e2e/fixtures/canonical-copilot-daemon.check.mts
```

This creates and removes its own temporary synthetic certificate, tests real loopback HTTPS forwarding, both explicit barriers, exact tool arguments, character-split Unicode and rejected unexpected requests. The two barriers mean (1) before returning a tool-call response, or (2) after receiving the tool-result request and before returning the final answer. Neither claims to pause inside application code between tool execution and its next provider request.

## Intentional canonical contract migration

- Provider configuration and permission are separate real Settings actions. The named model, data classes, raw-file exclusion and withdrawal are asserted there. No composer is available without permission. The old popup-on-first-send is a legacy UI contract.
- Canonical responses use closed `chat-completion-v1` JSON; internal tool/reasoning parts cannot appear in the browser. Actual model tool receipts replace the old visible tool-progress label assertions. The cited positive calls `get_report` and verifies the exact prepared source, captured title/citations/template fingerprint and observed genotype. It does not label current catalog data as historical evidence.
- All 64 whole-output answers/refusal IDs remain exact, including numerical/citation restrictions. Each test requires two actual model requests, the real genotype result, only the closed completion envelope and exactly the persisted user/assistant text pair. The native response is observed without reissuing POSTs or rewriting browser headers.
- Input refusals retain their registered refusal-header/SSE compatibility path, exact visible refusal strings, zero model-call deltas and no additional stored turns. Allowed subsequent history contains exactly the authorized questions. Output refusals use canonical JSON and persist only the complete fixed refusal.
- The new composer disables Send when empty; completion assertions require its text to clear, no busy state, and an enabled composer. The next actual prompt must make Send usable.
- The prior model-hostname loophole, legacy consent-table cleanup and fabricated ingestion setup are removed. Fresh UUID synthetic accounts isolate the fixtures. Standard discovery is preserved; transport prerequisites remain required in CI.

The setup-copy case now asserts reusable explicit permission, renewal after model/provider/key changes, and the configured same-host network boundary. Removed per-question consent, fixed-price and unconditional privacy assertions correspond to corrected production copy, not reduced security expectations.
