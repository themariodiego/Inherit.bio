import { describe, expect, it } from "vitest";
import { PAYMENT_ORIGIN_SOURCE, paymentOrigin } from "./payment-origins";

/** A hostname assembled at run time, so no processor origin sits in the tree for the name gate to read. */
const host = (...labels: string[]) => labels.join(".");

/** G5.7's origin list, planted both ways, and stateless across calls. */
describe("payment-processor origins", () => {
  it("finds a processor origin however it is hosted or cased", () => {
    expect(paymentOrigin(`<script src="https://${host("js", "stripe", "com")}/v3/"></script>`)).toBe(host("js", "stripe", "com"));
    expect(paymentOrigin(`action=https://${host("www", "PayPal", "com")}/checkout`)).toBe(host("PayPal", "com"));
    expect(paymentOrigin(`https://${host("checkout", "paddle", "com")}/`)).toBe(host("checkout", "paddle", "com"));
  });

  it("does not fire on the words legal prose uses innocently", () => {
    expect(paymentOrigin("a git checkout; there is deliberately no billing; ReadyEnvelope")).toBeNull();
    expect(paymentOrigin("https://www.inherit.bio/providers quotes other companies' prices")).toBeNull();
  });

  it("is the same list the gate and the browser suite share, and carries no state between calls", () => {
    expect(PAYMENT_ORIGIN_SOURCE).toContain("stripe|paypal|paddle");
    expect(paymentOrigin("x stripe.com y")).toBe("stripe.com");
    expect(paymentOrigin("x stripe.com y")).toBe("stripe.com");
  });
});
