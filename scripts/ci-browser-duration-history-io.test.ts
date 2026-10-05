import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, linkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { describe, expect, it } from "vitest";
import { decodeHistoricalZip, reserveOfflineOutput } from "./ci-browser-duration-history-io";

function archive(names = ["ci-browser-manifest.json"]): Buffer {
  const zip = new AdmZip(); names.forEach(name => zip.addFile(name, Buffer.from('{"schemaVersion":1}'))); return zip.toBuffer();
}
describe("bounded stock offline ZIP reader", () => {
  it("reads one approved JSON member without extraction", () => {
    expect(decodeHistoricalZip(archive(), "ci-browser-manifest.json")).toEqual({ schemaVersion: 1 });
  });
  it.each(["foreign-member", "extra-member", "zero-size", "large-size", "encrypted", "unsupported-method", "corrupt-crc"])("refuses unsafe ZIP %s", mode => {
    const bytes = archive(mode === "foreign-member" ? ["foreign.json"] : mode === "extra-member" ? ["ci-browser-manifest.json", "extra.json"] : undefined);
    const offset = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    if (mode === "zero-size") bytes.writeUInt32LE(0, offset + 24);
    if (mode === "large-size") bytes.writeUInt32LE(32_000_001, offset + 24);
    if (mode === "encrypted") bytes.writeUInt16LE(1, offset + 8);
    if (mode === "unsupported-method") bytes.writeUInt16LE(99, offset + 10);
    if (mode === "corrupt-crc") bytes.writeUInt32LE(0, offset + 16);
    expect(() => decodeHistoricalZip(bytes, "ci-browser-manifest.json")).toThrow();
  });
  it("refuses corrupt payload CRC with matching ZIP header checksums", () => {
    const bytes = archive();
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const local = bytes.readUInt32LE(central + 42);
    const corrupt = (bytes.readUInt32LE(central + 16) ^ 1) >>> 0;
    bytes.writeUInt32LE(corrupt, central + 16);
    bytes.writeUInt32LE(corrupt, local + 14);
    expect(() => decodeHistoricalZip(bytes, "ci-browser-manifest.json")).toThrow();
  });
  it.each(["central", "local"])("refuses a data-descriptor flag set only in the %s header", header => {
    const bytes = archive();
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const local = bytes.readUInt32LE(central + 42);
    const flags = header === "central" ? central + 8 : local + 6;
    bytes.writeUInt16LE(bytes.readUInt16LE(flags) | 8, flags);
    expect(() => decodeHistoricalZip(bytes, "ci-browser-manifest.json")).toThrow();
  });
});
describe("exclusive source-safe offline output", () => {
  it("reserves a fresh private directory beside protected inputs", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "inherit-history-output-test-"));
    try {
      const input = path.join(root, "saved"), output = path.join(root, "proposal"); mkdirSync(input);
      expect(reserveOfflineOutput(output, [input])).toBe(output);
      expect(() => reserveOfflineOutput(output, [input])).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("rejects symlink parent and hardlink output aliases without changing inputs", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "inherit-history-alias-test-"));
    try {
      const input = path.join(root, "saved"), alias = path.join(root, "alias"), file = path.join(input, "profile.json"); mkdirSync(input);
      writeFileSync(file, "unchanged", { flag: "wx" }); symlinkSync(input, alias);
      expect(() => reserveOfflineOutput(path.join(alias, "proposal"), [input])).toThrow();
      const hardlink = path.join(root, "hardlink"); linkSync(file, hardlink);
      expect(() => reserveOfflineOutput(hardlink, [file])).toThrow();
      expect(readFileSync(file, "utf8")).toBe("unchanged");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
