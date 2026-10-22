#!/bin/sh
# The docker command wrangler runs when it builds the preparation container
# image (WRANGLER_DOCKER_BIN, read by wrangler 4.134.0). Every command except
# `build` passes through to docker unchanged.
#
# wrangler builds with `build --load -t <tag> --platform linux/amd64
# --provenance=false -f - <context>` and sends the Dockerfile on stdin. Anonymous
# public.ecr.aws pulls can fail with "429 Too Many Requests: Data limit
# exceeded" (Deploy Cloudflare run 39796150327). So before the build, the shim
# pulls the base by its exact digest, first from public.ecr.aws, then from
# mirror.gcr.io. It then hands BuildKit that local image through one named
# build context mapped from the exact FROM reference, as
# scripts/ci-prepared-worker-build.sh does for CI. The Dockerfile and its pin
# are unchanged.
set -eu

if [ "${1-}" != build ]; then
  exec docker "$@"
fi
shift

dockerfile=$(cat)
if [ "$(printf '%s\n' "$dockerfile" | grep -c '^FROM ')" != 1 ]; then
  echo "ci_pinned_base:single_from_required" >&2
  exit 1
fi
from=$(printf '%s\n' "$dockerfile" | sed -n 's#^FROM \(public\.ecr\.aws/docker/library/[a-z0-9][a-z0-9._-]*:[A-Za-z0-9._-][A-Za-z0-9._-]*@sha256:[0-9a-f]\{64\}\)$#\1#p')
if [ -z "$from" ]; then
  echo "ci_pinned_base:official_digest_pin_required" >&2
  exit 1
fi
name=${from#public.ecr.aws/docker/library/}
name=${name%%:*}
digest=${from##*@}
mirror="mirror.gcr.io/library/$name@$digest"

# Pull progress goes to stderr: wrangler reads this command's stdout.
if docker pull "$from" >&2; then
  pulled=$from
elif docker pull "$mirror" >&2; then
  pulled=$mirror
else
  echo "ci_pinned_base:unavailable" >&2
  exit 1
fi
echo "Pinned base $digest is local (pulled as $pulled)." >&2
printf '%s\n' "$dockerfile" | docker build --build-context "$from=docker-image://$pulled" "$@"
