# Private TEST case archive worker

The config is closed and the source is unrun. No actual bucket or namespace is
bound. `src/private-transport.ts` is the deployed-path source successor of V4's
private transport. `src/requester-statement-r2-gateway.ts` owns the per-allocation
coordinator. The config has no public route and disables observability.

See `docs/requester-statement-archive-service.md` at the repository root. A real
configuration must prove the exact private TEST resources and current provider
contract. Do not reuse a prepared/embryo production worker or bucket. This packet
does not create resources, install secrets, run Wrangler or activate production.
