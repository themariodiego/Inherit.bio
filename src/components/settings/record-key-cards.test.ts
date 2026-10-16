import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { RecordKeyCards } from "./record-key-cards";
const control = { cohortId: "50000000-0000-4000-8000-000000000001", cardCount: 2,
  claimUrl: "https://synthetic.example.invalid/future-person/claim", nonce: "synthetic-print-proof" };
it("renders an explicit own-card action, with no raw key, form proof or automatically consumed right in HTML", () => {
  const html = renderToStaticMarkup(createElement(RecordKeyCards, { control }));
  expect(html).toContain("Show my cards"); expect(html).toContain("2 cards to collect");
  expect(html).toContain("Analysis does not need to start first.");
  expect(html).not.toContain(control.nonce); expect(html).not.toContain(control.claimUrl);
  expect(html).not.toContain('data-slot="record-key-value"'); expect(html).not.toContain('href=');
});
it("describes a single transfer card without assuming the whole cohort is reissued", () => {
  const html = renderToStaticMarkup(createElement(RecordKeyCards, { control: { ...control, cardCount: 1 } }));
  expect(html).toContain("1 card to collect"); expect(html).not.toContain("1 cards");
});
