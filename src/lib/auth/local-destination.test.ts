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
    null, undefined, "", "overview", "https://external.test/path",
    "javascript:alert(1)", "//external.test", "///external.test",
    "/\\external.test", "\\\\external.test", "/safe\\path",
    "/%2fexternal.test", "/%2F%2Fexternal.test", "/%5cexternal.test",
    "/%252fexternal.test", "/%255cexternal.test", "%2f%2fexternal.test",
    "/safe/..//external.test", "/safe/%2e%2e//external.test",
    "/\n/external.test", "/\t/external.test", "/\rexternal.test",
    "/%00external.test", "/%0aexternal.test", "/%7fexternal.test",
    "/safe?x=\nvalue", "/safe#\\value", "/bad%", "/bad%E0%A4",
    "/%25252525252fexternal.test",
  ])("refuses unsafe or ambiguous destination %s", (value) => {
    expect(localAuthDestination(value)).toBe("/overview");
  });
});
