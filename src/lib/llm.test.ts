import { describe, expect, it } from "vitest";
import { isLocalBaseUrl, ssrfReasonForBaseUrl } from "./llm";

describe("isLocalBaseUrl", () => {
  it("detects local endpoints", () => {
    expect(isLocalBaseUrl("http://localhost:11434/v1")).toBe(true);
    expect(isLocalBaseUrl("http://127.0.0.1:1234/v1")).toBe(true);
    expect(isLocalBaseUrl("http://192.168.1.10:11434/v1")).toBe(true);
    expect(isLocalBaseUrl("http://ollama.local/v1")).toBe(true);
  });
  it("treats cloud endpoints as non-local", () => {
    expect(isLocalBaseUrl("https://api.openai.com/v1")).toBe(false);
    expect(isLocalBaseUrl("https://example.com/v1")).toBe(false);
  });
});

describe("ssrfReasonForBaseUrl", () => {
  it("always blocks cloud-metadata / link-local, even when private is allowed", () => {
    expect(ssrfReasonForBaseUrl("http://169.254.169.254/latest/meta-data", true)).toMatch(
      /link-local/,
    );
    expect(ssrfReasonForBaseUrl("http://169.254.169.254/", false)).toMatch(
      /link-local/,
    );
  });
  it("blocks loopback and private ranges when private is not allowed", () => {
    for (const url of [
      "http://localhost:11434/v1",
      "http://127.0.0.1:1234/v1",
      "http://10.0.0.5/v1",
      "http://192.168.0.1/v1",
      "http://172.16.5.5/v1",
      "http://ollama.internal/v1",
    ]) {
      expect(ssrfReasonForBaseUrl(url, false), url).not.toBeNull();
    }
  });
  it("allows loopback/private when the deployment opts in (self-host local model)", () => {
    expect(ssrfReasonForBaseUrl("http://localhost:11434/v1", true)).toBeNull();
    expect(ssrfReasonForBaseUrl("http://192.168.1.10:11434/v1", true)).toBeNull();
  });
  it("allows ordinary public endpoints", () => {
    expect(ssrfReasonForBaseUrl("https://api.openai.com/v1", false)).toBeNull();
  });
  it("refuses a malformed URL", () => {
    expect(ssrfReasonForBaseUrl("not a url", false)).toMatch(/malformed/);
  });
});
