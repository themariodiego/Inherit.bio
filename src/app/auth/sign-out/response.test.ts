import { describe, expect, it } from "vitest";
import { TIER2_EMBRYO_COOKIE_NAME } from "@/lib/embryos/tier2";
import { TIER2_COOKIE_NAME } from "@/lib/family/tier2";
import { SESSION_SCOPED_COOKIES, signOutResponse } from "./response";

describe("sign-out", () => {
  it("deletes the Family and the Embryo gate cookies and redirects home", () => {
    expect(SESSION_SCOPED_COOKIES).toEqual(["inherit_family_gate", "inherit_embryo_gate"]);
    const response = signOutResponse("https://example.test");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://example.test/");
    const cleared = response.cookies.getAll().map((cookie) => [cookie.name, cookie.value, cookie.maxAge ?? cookie.expires]);
    expect(cleared.map(([name]) => name)).toEqual([TIER2_COOKIE_NAME, TIER2_EMBRYO_COOKIE_NAME]);
    for (const [, value, expiry] of cleared) {
      expect(value).toBe("");
      expect(expiry === 0 || (expiry instanceof Date && expiry.getTime() === 0)).toBe(true);
    }
  });
});
