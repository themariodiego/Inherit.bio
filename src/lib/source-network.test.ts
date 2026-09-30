import { describe, expect, it } from "vitest";
import { sourceNetwork } from "./source-network";

const headers = (entries: Record<string, string>) => new Headers(entries);

describe("sourceNetwork", () => {
  it.each([
    [{ "x-real-ip": "192.0.2.10" }, "ipv4:192.0.2.10"],
    [{ "x-forwarded-for": "198.51.100.7, 10.0.0.1" }, "ipv4:198.51.100.7"],
    [{ "x-forwarded-for": "203.0.113.5:4431" }, "ipv4:203.0.113.5"],
    [{ "x-forwarded-for": "::ffff:127.0.0.1" }, "ipv4:127.0.0.1"],
    [{ "x-forwarded-for": "::1" }, "ipv6:0:0:0:0::/64"],
    [{ "x-real-ip": "2001:db8:85a3:8d3:1319:8a2e:370:7348" }, "ipv6:2001:db8:85a3:8d3::/64"],
    [{ "x-real-ip": "[2001:DB8::1]:443" }, "ipv6:2001:db8:0:0::/64"],
    [{ "x-real-ip": "fe80::1%eth0" }, "ipv6:fe80:0:0:0::/64"],
  ])("normalizes %j to %s", (entries, network) => {
    expect(sourceNetwork(headers(entries))).toBe(network);
  });

  it("counts every address inside one IPv6 /64 as one network", () => {
    expect(sourceNetwork(headers({ "x-real-ip": "2001:db8:1:2::a" })))
      .toBe(sourceNetwork(headers({ "x-real-ip": "2001:db8:1:2:ffff:ffff:ffff:ffff" })));
    expect(sourceNetwork(headers({ "x-real-ip": "2001:db8:1:2::a" })))
      .not.toBe(sourceNetwork(headers({ "x-real-ip": "2001:db8:1:3::a" })));
  });

  it("prefers the platform's x-real-ip over a forwarded chain", () => {
    expect(sourceNetwork(headers({ "x-real-ip": "192.0.2.1", "x-forwarded-for": "198.51.100.1" })))
      .toBe("ipv4:192.0.2.1");
  });

  it.each([
    [{}],
    [{ "x-forwarded-for": "" }],
    [{ "x-forwarded-for": "not-an-address" }],
    [{ "x-real-ip": "999.1.1.1" }],
    [{ "x-real-ip": "1::2::3" }],
    [{ "x-real-ip": `${"1".repeat(200)}` }],
  ])("reads %j as the one shared unknown network", (entries) => {
    expect(sourceNetwork(headers(entries))).toBe("unknown");
  });
});
