import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertOwnedContainer, ownedInternalScannerAddress, assertRealVerdict, boundedCommand, eicarBytes, netBytes, signatureAllocatedBytes, signatureAllocationCommand,
  clamdDiagnosticCommands, parseClamdWaitStatus, PROOF_LABEL, sha256, syntheticPdf } from "./claim-scanner-real-proof";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });
const id = "a".repeat(64), nonce = "proof-nonce";
const owned = () => ({ Id: id, Config: { Labels: { [PROOF_LABEL]: nonce } }, HostConfig: {
  Memory: 4 * 1024 ** 3, MemorySwap: 4 * 1024 ** 3, ReadonlyRootfs: true,
  PortBindings: { "3310/tcp": [{ HostIp: "127.0.0.1", HostPort: "45310" }] },
} });
const network = `inherit-scanner-${nonce}`, networkId = "b".repeat(64), endpointId = "c".repeat(64);
const sealed = (host = "172.18.0.2", prefix = 16) => ({
  container: { ...owned(), Name: `/inherit-real-scanner-${nonce}`,
    State: { Running: true, Paused: false, Restarting: false, OOMKilled: false, Dead: false },
    NetworkSettings: { Ports: {}, Networks: { [network]: { NetworkID: networkId, EndpointID: endpointId,
      IPAddress: host, IPPrefixLen: prefix, Gateway: "", IPv6Gateway: "", GlobalIPv6Address: "" } } } },
  network: { Id: networkId, Name: network, Driver: "bridge", Scope: "local", Internal: true, EnableIPv6: false,
    Labels: { [PROOF_LABEL]: nonce }, Options: {}, Containers: { [id]: { Name: `inherit-real-scanner-${nonce}`,
      EndpointID: endpointId, IPv4Address: `${host}/${prefix}`, IPv6Address: "" } } },
});
const bytes = syntheticPdf(), now = Date.UTC(2026, 9, 5, 12);
const valid = () => ({ verdict: "OK" as const, sha256: sha256(bytes),
  signatures: { engine: "ClamAV 1.5.4", version: 1, publishedAt: new Date(now) } });

describe("real scanner proof boundary controls (not a real scanner verdict)", () => {
  it("builds a valid cross-reference table for an empty synthetic one-page PDF", () => {
    const source = bytes.toString("ascii"), start = /startxref\n(\d+)\n%%EOF/u.exec(source);
    expect(source).toContain("/Type /Page /Parent 2 0 R /MediaBox [0 0 72 72]");
    expect(source.slice(Number(start?.[1]))).toMatch(/^xref\n0 5\n/u);
    const entries = [...source.matchAll(/(\d{10}) 00000 n /gu)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(4);
    entries.forEach((offset, index) => expect(source.slice(offset)).toMatch(new RegExp(`^${index + 1} 0 obj\\n`)));
  });
  it("uses the complete standard EICAR file without a private file", () => {
    expect(eicarBytes()).toHaveLength(68);
    expect(sha256(eicarBytes())).toBe("275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f");
  });
  it("admits the exact owned private container boundary", () => expect(() => assertOwnedContainer(owned(), id, nonce)).not.toThrow());
  it.each(["identity", "label", "memory", "swap", "readonly", "public", "extra-port"])("refuses planted %s drift before a container mutation", (kind) => {
    const value = owned();
    if (kind === "identity") value.Id = "b".repeat(64);
    if (kind === "label") value.Config.Labels[PROOF_LABEL] = "another-proof";
    if (kind === "memory") value.HostConfig.Memory = 512 * 1024 ** 2;
    if (kind === "swap") value.HostConfig.MemorySwap = -1;
    if (kind === "readonly") value.HostConfig.ReadonlyRootfs = false;
    if (kind === "public") value.HostConfig.PortBindings["3310/tcp"][0].HostIp = "0.0.0.0";
    if (kind === "extra-port") Object.assign(value.HostConfig.PortBindings, { "7357/tcp": [] });
    expect(() => assertOwnedContainer(value, id, nonce)).toThrow();
  });
  it.each([["10.23.0.2", 24], ["172.18.0.2", 16], ["192.168.45.2", 24]] as const)(
    "binds only the current owned internal IPv4 %s to the real TCP port", (host, prefix) => {
      const value = sealed(host, prefix);
      expect(ownedInternalScannerAddress(value.container, value.network, id, nonce, network, networkId))
        .toEqual({ kind: "tcp", host, port: 3310 });
      expect(value.container.NetworkSettings.Ports).toEqual({});
    });
  it.each([
    "container-id", "container-nonce", "container-name", "not-running", "network-id", "container-network-id",
    "network-name", "network-nonce", "driver", "scope", "not-internal", "ipv6-network", "network-option",
    "extra-network", "extra-member", "member-name", "endpoint-id", "IP-disagreement", "public-IP", "noncanonical-IP",
    "invalid-prefix", "gateway", "IPv6-endpoint", "published-port", "missing-ports", "missing-networks", "missing-members", "malformed-network",
  ])("refuses %s drift instead of scanning an arbitrary endpoint", (kind) => {
    const value = sealed(), endpoint = value.container.NetworkSettings.Networks[network]!, member = value.network.Containers[id]!;
    if (kind === "container-id") value.container.Id = "d".repeat(64);
    if (kind === "container-nonce") value.container.Config.Labels[PROOF_LABEL] = "foreign-proof";
    if (kind === "container-name") value.container.Name = "/foreign-scanner";
    if (kind === "not-running") value.container.State.Running = false;
    if (kind === "network-id") value.network.Id = "d".repeat(64);
    if (kind === "container-network-id") endpoint.NetworkID = "d".repeat(64);
    if (kind === "network-name") value.network.Name = "foreign-network";
    if (kind === "network-nonce") value.network.Labels[PROOF_LABEL] = "foreign-proof";
    if (kind === "driver") value.network.Driver = "overlay";
    if (kind === "scope") value.network.Scope = "swarm";
    if (kind === "not-internal") value.network.Internal = false;
    if (kind === "ipv6-network") value.network.EnableIPv6 = true;
    if (kind === "network-option") Object.assign(value.network.Options, { "com.docker.network.bridge.gateway_mode_ipv4": "isolated" });
    if (kind === "extra-network") Object.assign(value.container.NetworkSettings.Networks, { bridge: {} });
    if (kind === "extra-member") Object.assign(value.network.Containers, { ["d".repeat(64)]: member });
    if (kind === "member-name") member.Name = "foreign-scanner";
    if (kind === "endpoint-id") member.EndpointID = "d".repeat(64);
    if (kind === "IP-disagreement") member.IPv4Address = "172.18.0.3/16";
    if (kind === "public-IP") { endpoint.IPAddress = "203.0.113.2"; member.IPv4Address = "203.0.113.2/16"; }
    if (kind === "noncanonical-IP") { endpoint.IPAddress = "172.018.0.2"; member.IPv4Address = "172.018.0.2/16"; }
    if (kind === "invalid-prefix") { endpoint.IPPrefixLen = 33; member.IPv4Address = "172.18.0.2/33"; }
    if (kind === "gateway") endpoint.Gateway = "172.18.0.1";
    if (kind === "IPv6-endpoint") endpoint.GlobalIPv6Address = "fd00::2";
    if (kind === "published-port") Object.assign(value.container.NetworkSettings.Ports, { "3310/tcp": [{ HostIp: "0.0.0.0", HostPort: "45310" }] });
    if (kind === "missing-ports") Reflect.deleteProperty(value.container.NetworkSettings, "Ports");
    if (kind === "missing-networks") Reflect.deleteProperty(value.container.NetworkSettings, "Networks");
    if (kind === "missing-members") Reflect.deleteProperty(value.network, "Containers");
    expect(() => ownedInternalScannerAddress(value.container, kind === "malformed-network" ? [] : value.network,
      id, nonce, network, networkId)).toThrow();
  });
  it("admits only a byte-bound current real-engine verdict", () => expect(() => assertRealVerdict(valid(), "OK", bytes, now)).not.toThrow());
  it.each(["hash", "engine", "stale", "future", "extra-key"])("refuses planted %s verdict evidence", (kind) => {
    const value = valid();
    if (kind === "hash") value.sha256 = "0".repeat(64);
    if (kind === "engine") value.signatures.engine = "test-double";
    if (kind === "stale") value.signatures.publishedAt = new Date(now - 86_400_001);
    if (kind === "future") value.signatures.publishedAt = new Date(now + 300_001);
    if (kind === "extra-key") Object.assign(value, { signatureName: "should-not-be-kept" });
    expect(() => assertRealVerdict(value, "OK", bytes, now)).toThrow();
  });
  it("refuses an OK result for a requested infection outcome", () => expect(() => assertRealVerdict(valid(), "FOUND", bytes, now)).toThrow());
  it("reads decimal Docker network counters and refuses unknown units", () => {
    expect(netBytes("1.5 MB")).toBe(1_500_000);
    expect(netBytes("1 MiB")).toBe(1_048_576);
    expect(() => netBytes("unknown")).toThrow();
    expect(() => netBytes("-1 B")).toThrow();
  });
  it("observes private signature metadata only as the exact scanner user and owned id", () => {
    expect(signatureAllocationCommand(id)).toEqual(["exec", "--user", "clamav:clamav", id,
      "/usr/bin/find", "-P", "/signatures", "-printf", "%y\t%n\t%b\t%s\t%P\\0"]);
    expect(signatureAllocationCommand(id).every(value => !value.includes("\0"))).toBe(true);
    for (const invalid of ["", "scanner", `${id};other`, id.toUpperCase()])
      expect(() => signatureAllocationCommand(invalid)).toThrow("owned_id_refused");
  });
  it("counts allocated blocks inside private directories without reading contents", () => {
    expect(signatureAllocatedBytes("d\t3\t8\t4096\t\0d\t2\t8\t4096\ttmp.owned\0f\t1\t16\t7000\ttmp.owned/daily.cvd\0"))
      .toBe(32 * 512);
    expect(signatureAllocatedBytes(`d\t2\t0\t0\t\0f\t1\t${2 ** 21}\t1\tmain.cvd\0`)).toBe(1024 ** 3);
    expect(() => signatureAllocatedBytes(`d\t2\t0\t0\t\0f\t1\t${2 ** 21 + 1}\t1\tmain.cvd\0`))
      .toThrow("signature_budget_exceeded");
  });
  it.each([
    "l\t1\t1\t10\tlink\0", "p\t1\t0\t0\tfifo\0", "f\t2\t1\t1\tmulti\0",
    "f\t1\t-1\t1\tnegative\0", "f\t1\t1.5\t1\tdecimal\0", "f\t1\t9007199254740992\t1\tunsafe\0",
    "f\t1\t1\t1\t../escape\0", "f\t1\t1\t1\t/absolute\0", "f\t1\t1\t1\tx//y\0",
    "f\t1\t1\t1\tduplicate\0f\t1\t1\t1\tduplicate\0", "f\t1\t1\t1\tunterminated",
  ])("refuses unsafe signature metadata %s", (record) => {
    expect(() => signatureAllocatedBytes(`d\t2\t0\t0\t\0${record}`)).toThrow();
  });
  it("keeps daemon diagnostics inside the same owned tmpfs as the scanner user", () => {
    const commands = clamdDiagnosticCommands(id);
    const ownedExec = ["exec", "--user", "clamav:clamav", id, "/bin/sh", "-c"];
    expect(commands.prepare.slice(0, -1)).toEqual(ownedExec);
    expect(commands.snapshot.slice(0, -1)).toEqual(ownedExec);
    expect(commands.start.slice(0, -1)).toEqual(["exec", "-d", ...ownedExec.slice(1)]);
    for (const invalid of ["", "scanner", `${id};other`, id.toUpperCase()])
      expect(() => clamdDiagnosticCommands(invalid)).toThrow("owned_id_refused");
  });
  it("preserves a startup wait result without inventing an exit for a running daemon", () => {
    expect(parseClamdWaitStatus("daemon-wait-status:unobserved\nloading\n")).toBeNull();
    expect(parseClamdWaitStatus("daemon-wait-status:1\noriginal failure\n")).toBe(1);
    expect(parseClamdWaitStatus("daemon-wait-status:0\n")).toBe(0);
    expect(parseClamdWaitStatus("daemon-wait-status:137\noriginal stderr is separate\n")).toBe(137);
    for (const invalid of ["", "daemon-wait-status:-1\n", "daemon-wait-status:256\n", "daemon-wait-status:01\n",
      "daemon-wait-status:1", "untrusted-prefix\ndaemon-wait-status:0\n"])
      expect(() => parseClamdWaitStatus(invalid)).toThrow("daemon_status_observation_refused");
  });
  it("retains the first failed command and complete raw streams before refusing it", async () => {
    const output = await mkdtemp(path.join(tmpdir(), "scanner-proof-command-")); temporary.push(output);
    await expect(boundedCommand(output, 1, [process.execPath, "-e", "process.stdout.write('original');process.stderr.write('failure');process.exitCode=7"], 2)).rejects.toThrow("command_1_failed");
    const original = JSON.parse(await readFile(`${output}/command-1.original-result.json`, "utf8"));
    expect(original).toMatchObject({ exit: 7, timedOut: false, groupAbsent: true, readbackPending: true });
    expect(await readFile(original.stdout, "utf8")).toBe("original");
    expect(await readFile(original.stderr, "utf8")).toBe("failure");
    const readback = JSON.parse(await readFile(`${output}/command-1.raw-readback.json`, "utf8"));
    expect(readback[original.stdout]).toMatchObject({ bytes: 8 });
  });
});
