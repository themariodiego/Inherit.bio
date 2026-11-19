# Production read-backs

`2026-10-16-readonly-*.json` were read on 16 October 2026 through the Supabase connector, read-only, before any batch ran. They hold the pre-check result and the fingerprint summary, which `check-readback.py ... 1 pre` reports EQUAL. Release runs add their own `run-<UTC date>/` directories here.
