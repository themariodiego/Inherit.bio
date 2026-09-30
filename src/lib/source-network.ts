import "server-only";

import { isIP } from "node:net";

/**
 * The source network a quota counts (securityRateLimitContract.keyDerivation:
 * normalized only in bounded request memory, then keyed, never stored).
 *
 * This module reads the client address for one reason, the per-network
 * limits the owner allowed on 28 September 2026 (invitation attempts and the
 * register's other per-network limits). The value goes straight into a keyed
 * digest (`networkBucketDigests` in `src/lib/rate-limit-keys.ts`), the bucket
 * is purged within 24 hours, and it is never used to infer a jurisdiction.
 * `scripts/jurisdiction-inference.test.ts` allows exactly the one call in
 * `sourceNetwork` below; any other read, here or elsewhere, fails it, and so
 * does any other module importing this one.
 *
 * An IPv4 client is its one address. An IPv6 client is its /64, the block one
 * subscriber is normally given, so stepping through addresses inside it does
 * not reset a quota. An IPv4-mapped IPv6 address is the IPv4 address.
 *
 * The address comes from the hosting platform, not from the client: on Vercel
 * both client-address headers are written by the edge and a client's own
 * value is overwritten, and `next start` fills the forwarded chain from the
 * socket. A self-hosted reverse proxy must do the same (docs/self-hosting.md).
 * Anything unreadable is the one shared network `unknown`, which can only make
 * a quota stricter.
 */
export function sourceNetwork(headers: Headers): string {
  return normalizedSourceNetwork(headers.get("x-real-ip"), headers.get("x-forwarded-for"));
}

/** The network of the platform's own address, else of the first forwarded hop. */
export function normalizedSourceNetwork(platformAddress: string | null, forwardedChain: string | null): string {
  const raw = platformAddress ?? forwardedChain?.split(",")[0] ?? "";
  const address = bareAddress(raw.trim().slice(0, 100));
  const family = isIP(address);
  if (family === 4) return `ipv4:${address}`;
  if (family === 6) {
    const hextets = ipv6Hextets(address);
    if (!hextets) return "unknown";
    if (hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff) {
      return `ipv4:${[hextets[6]! >> 8, hextets[6]! & 0xff, hextets[7]! >> 8, hextets[7]! & 0xff].join(".")}`;
    }
    return `ipv6:${hextets.slice(0, 4).map((h) => h.toString(16)).join(":")}::/64`;
  }
  return "unknown";
}

/** Drop a `[v6]:port` wrapper, a `v4:port` suffix and a `%zone`. */
function bareAddress(value: string): string {
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value);
  let address = bracketed ? bracketed[1]! : value;
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(address)) address = address.slice(0, address.lastIndexOf(":"));
  const zone = address.indexOf("%");
  return zone >= 0 ? address.slice(0, zone) : address;
}

/** The eight 16-bit groups of an address `isIP` already accepted as IPv6. */
function ipv6Hextets(address: string): number[] | null {
  const halves = address.toLowerCase().split("::");
  if (halves.length > 2) return null;
  const groups = (part: string | undefined): string[] => (part ? part.split(":") : []);
  const expand = (items: string[]): number[] | null => {
    const out: number[] = [];
    for (const item of items) {
      if (item.includes(".")) {
        const octets = item.split(".").map(Number);
        out.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
      } else if (/^[0-9a-f]{1,4}$/.test(item)) {
        out.push(parseInt(item, 16));
      } else {
        return null;
      }
    }
    return out;
  };
  const head = expand(groups(halves[0]));
  const tail = expand(groups(halves[1]));
  if (!head || !tail) return null;
  const gap = 8 - head.length - tail.length;
  if (halves.length === 2 ? gap < 0 : gap !== 0) return null;
  return [...head, ...Array<number>(gap).fill(0), ...tail];
}
