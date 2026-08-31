#!/usr/bin/env bash
set -euo pipefail

script_directory="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repository_root="$(CDPATH= cd -- "${script_directory}/../.." && pwd)"
baseline_sha="864736979c92a08ba77e8580d61946eba6864918"
capture_port="${DENSITY_CAPTURE_PORT:-3100}"
next_port="${DENSITY_NEXT_PORT:-3102}"
working_root="${DENSITY_WORKING_ROOT:-$(mktemp -d /private/tmp/inherit-density-baseline.XXXXXX)}"
baseline_checkout="${working_root}/baseline-checkout"
output_root="${DENSITY_OUTPUT_ROOT:-${working_root}/evidence}"
browser_executable="${DENSITY_BROWSER_EXECUTABLE:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
fixed_time="2026-08-31T12:00:00.000Z"

mkdir -p "${baseline_checkout}" "${output_root}/screenshots"
git -C "${repository_root}" cat-file -e "${baseline_sha}^{commit}"
git -C "${repository_root}" archive --format=tar "${baseline_sha}" | tar -xf - -C "${baseline_checkout}"

corepack pnpm --dir "${baseline_checkout}" install --frozen-lockfile

export CI=1
export NODE_ENV=production
export NEXT_TELEMETRY_DISABLED=1
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:${capture_port}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="density-baseline-anon-key"
export SUPABASE_SERVICE_ROLE_KEY="density-baseline-service-role-key"

corepack pnpm --dir "${baseline_checkout}" build

next_log="${working_root}/next.log"
fixture_log="${working_root}/fixture.log"
corepack pnpm --dir "${baseline_checkout}" start -p "${next_port}" >"${next_log}" 2>&1 &
next_pid=$!
INHERIT_STUB_PORT="${capture_port}" \
INHERIT_NEXT_ORIGIN="http://127.0.0.1:${next_port}" \
INHERIT_BASELINE_CHECKOUT="${baseline_checkout}" \
INHERIT_DENSITY_FIXED_TIME="${fixed_time}" \
  node "${script_directory}/supabase-fixture.mjs" >"${fixture_log}" 2>&1 &
fixture_pid=$!

cleanup() {
  kill "${fixture_pid}" "${next_pid}" 2>/dev/null || true
  wait "${fixture_pid}" "${next_pid}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

for _ in {1..120}; do
  if curl --fail --silent --output /dev/null "http://127.0.0.1:${capture_port}/auth/v1/health" && \
     curl --fail --silent --output /dev/null "http://127.0.0.1:${capture_port}/"; then
    break
  fi
  sleep 0.25
done
curl --fail --silent --output /dev/null "http://127.0.0.1:${capture_port}/auth/v1/health"
curl --fail --silent --output /dev/null "http://127.0.0.1:${capture_port}/"

DENSITY_ORIGIN="http://127.0.0.1:${capture_port}" \
DENSITY_BROWSER_EXECUTABLE="${browser_executable}" \
DENSITY_SCREENSHOT_DIRECTORY="${output_root}/screenshots" \
DENSITY_CAPTURE_MANIFEST="${output_root}/capture-manifest.json" \
  node "${script_directory}/capture.mjs"

DENSITY_SCREENSHOT_DIRECTORY="${output_root}/screenshots" \
DENSITY_CAPTURE_MANIFEST="${output_root}/capture-manifest.json" \
DENSITY_COMPUTED_MEASUREMENTS="${output_root}/computed-measurements.json" \
  node "${script_directory}/compute.mjs"

printf '%s\n' "working_root=${working_root}"
printf '%s\n' "baseline_checkout=${baseline_checkout}"
printf '%s\n' "output_root=${output_root}"
printf '%s\n' "next_log=${next_log}"
printf '%s\n' "fixture_log=${fixture_log}"
