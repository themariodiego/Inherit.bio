import { describe, expect, it } from "vitest";
import { localAuthDestination } from "./local-destination";

describe("local authentication destinations", () => {
  it.each([
    "/", "/overview", "/files/upload?subject=self#upload",
    "/genome/me/reports/caffeine?source=123#result",
    "/search?q=https%3A%2F%2Fexample.test%2F&filter=a%26b#part%202",
    "/files/my%20file", "/caf%C3%A9", "/files/a%2Fb",
  ])("preserves the local destination %s verbatim", (value) => {
    expect(localAuthDestination(value)).toBe(value);
  });

  it.each([
    null, undefined, "", "overview", "https://external.example.test/path",
    "javascript:alert(1)", "//external.example.test", "///external.example.test",
    "/\\external.example.test", "\\\\external.example.test", "/safe\\path",
    "/%2fexternal.example.test", "/%2F%2Fexternal.example.test", "/%5cexternal.example.test",
    "/%252fexternal.example.test", "/%255cexternal.example.test", "%2f%2fexternal.example.test",
    "/safe/..//external.example.test", "/safe/%2e%2e//external.example.test",
    "/\n/external.example.test", "/\t/external.example.test", "/\rexternal.example.test",
    "/%00external.example.test", "/%0aexternal.example.test", "/%7fexternal.example.test",
    "/safe?x=\nvalue", "/safe#\\value", "/bad%", "/bad%E0%A4",
    "/%25252525252fexternal.example.test",
  ])("refuses unsafe or ambiguous destination %s", (value) => {
    expect(localAuthDestination(value)).toBe("/overview");
  });
});
