/**
 * Fetch a Dockerfile's digest-pinned Docker Official Images base before an
 * unchanged `docker build`.
 *
 * Anonymous pulls from public.ecr.aws can fail with `429 Too Many Requests:
 * Data limit exceeded` on some shared hosted-runner addresses. A pull by digest
 * is content-addressed, so the identical image index from Google's
 * mirror.gcr.io copy of Docker Hub's official images is the same verified
 * bytes. BuildKit then resolves the pinned FROM from local content without a
 * registry request. The Dockerfile and its pin stay unchanged.
 */
export interface PinnedBase {
  readonly repository: string;
  readonly tag: string;
  readonly digest: string;
  readonly primary: string;
  readonly mirror: string;
}

const PINNED_FROM = /^FROM public\.ecr\.aws\/docker\/library\/([a-z0-9][a-z0-9._-]*):([A-Za-z0-9._-]+)@sha256:([0-9a-f]{64})$/;

/** The single pinned base of a Dockerfile, or a refusal. */
export function pinnedBase(dockerfile: string): PinnedBase {
  const from = dockerfile.split("\n").map(line => line.trim()).filter(line => /^FROM\s/i.test(line));
  if (from.length !== 1) throw new Error("ci_pinned_base:single_from_required");
  const match = PINNED_FROM.exec(from[0]);
  if (!match) throw new Error("ci_pinned_base:official_digest_pin_required");
  const [, repository, tag, hex] = match;
  const digest = `sha256:${hex}`;
  return { repository, tag, digest, primary: `public.ecr.aws/docker/library/${repository}:${tag}@${digest}`,
    mirror: `mirror.gcr.io/library/${repository}@${digest}` };
}

/** Pull the exact digest from the pinned registry, then from the mirror. */
export function prefetchPinnedBase(base: PinnedBase, pull: (reference: string) => boolean): "primary" | "mirror" {
  if (pull(base.primary)) return "primary";
  if (pull(base.mirror)) return "mirror";
  throw new Error("ci_pinned_base:unavailable");
}
