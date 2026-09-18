/**
 * G5.7's first half, shared by the static gate and the browser suite: the
 * payment-processor origins no route may submit to and no response may carry.
 * One source of truth, so the gate that reads the tree and the assertion that
 * reads every rendered page cannot drift apart on what counts as a processor.
 */
export const PAYMENT_ORIGIN_SOURCE =
  String.raw`\b(?:js|api|checkout|connect)?\.?(?:stripe|paypal|paddle|lemonsqueezy|braintreegateway|adyen|razorpay|klarna|squareup|mollie|worldpay)\.com\b`;

/**
 * A fresh, stateless matcher each time: a shared global regex would carry
 * `lastIndex` between callers. The optional host prefix lets the pattern
 * swallow a leading dot (`.PayPal.com` out of `www.PayPal.com`); the origin
 * is reported without it.
 */
export function paymentOrigin(text: string): string | null {
  const match = new RegExp(PAYMENT_ORIGIN_SOURCE, "i").exec(text)?.[0];
  return match ? match.replace(/^\./, "") : null;
}
