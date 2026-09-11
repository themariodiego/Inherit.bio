import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { applicationOrigin, UNSET_APP_URL_MESSAGE } from "./app-origin";

describe("the origin outbound mail links are built from", () => {
  it("uses the configured value, trimmed and without a trailing slash", () => {
    expect(applicationOrigin({ NEXT_PUBLIC_APP_URL: "https://example.test" })).toBe("https://example.test");
    expect(applicationOrigin({ NEXT_PUBLIC_APP_URL: "  https://example.test/  " })).toBe("https://example.test");
    expect(applicationOrigin({ NEXT_PUBLIC_APP_URL: "https://example.test///" })).toBe("https://example.test");
  });

  it("keeps the hosted fallback on the platform that sets VERCEL", () => {
    expect(applicationOrigin({ VERCEL: "1" })).toBe("https://www.inherit.bio");
    expect(applicationOrigin({ VERCEL_ENV: "production" })).toBe("https://www.inherit.bio");
    // Empty and whitespace are unset, not a configured empty origin.
    expect(applicationOrigin({ VERCEL: "1", NEXT_PUBLIC_APP_URL: "" })).toBe("https://www.inherit.bio");
    expect(applicationOrigin({ VERCEL: "1", NEXT_PUBLIC_APP_URL: "   " })).toBe("https://www.inherit.bio");
  });

  it("refuses to build a link anywhere else, naming what an unset value would leak", () => {
    expect(() => applicationOrigin({})).toThrow(UNSET_APP_URL_MESSAGE);
    expect(() => applicationOrigin({ NEXT_PUBLIC_SITE_URL: "https://self.hosted.test" })).toThrow(UNSET_APP_URL_MESSAGE);
    // The message has to say what is at stake, or an operator reads it as noise.
    expect(UNSET_APP_URL_MESSAGE).toContain("rights tokens");
    expect(UNSET_APP_URL_MESSAGE).toContain("docs/self-hosting.md");
  });

  it("agrees with the register, which is the authority for the canonical origin", () => {
    const register = JSON.parse(
      readFileSync(path.join(process.cwd(), "docs/route-register.json"), "utf8"),
    ) as { canonicalOrigin: string };
    expect(applicationOrigin({ VERCEL: "1" })).toBe(register.canonicalOrigin);
  });
});
