#!/bin/sh
# Build the prepared worker image from its digest-pinned base on a public
# runner that has only the stock tools (the workflow installs no Node or pnpm).
#
# This is the shell twin of scripts/ci-pinned-base.ts, and its tests require the
# same result. Anonymous public.ecr.aws pulls can fail with "429 Too Many
# Requests: Data limit exceeded". The base is pulled by its exact digest, first
# from public.ecr.aws, then from mirror.gcr.io. The build then reads that local
# image through one named build context mapped from the exact FROM reference,
# so BuildKit does not ask public.ecr.aws again. The Dockerfile and its pin
# are unchanged.
set -eu

dockerfile=workers/prepared-worker/Dockerfile
if [ "$(grep -c '^FROM ' "$dockerfile")" != 1 ]; then
  echo "ci_pinned_base:single_from_required" >&2
  exit 1
fi
from=$(sed -n 's#^FROM \(public\.ecr\.aws/docker/library/[a-z0-9][a-z0-9._-]*:[A-Za-z0-9._-][A-Za-z0-9._-]*@sha256:[0-9a-f]\{64\}\)$#\1#p' "$dockerfile")
if [ -z "$from" ]; then
  echo "ci_pinned_base:official_digest_pin_required" >&2
  exit 1
fi
name=${from#public.ecr.aws/docker/library/}
name=${name%%:*}
digest=${from##*@}
mirror="mirror.gcr.io/library/$name@$digest"

if docker pull "$from"; then
  pulled=$from
elif docker pull "$mirror"; then
  pulled=$mirror
else
  echo "ci_pinned_base:unavailable" >&2
  exit 1
fi
echo "Pinned base $digest is local (pulled as $pulled)."
docker build --build-context "$from=docker-image://$pulled" --file "$dockerfile" --tag inherit-prepared-worker:ci .
