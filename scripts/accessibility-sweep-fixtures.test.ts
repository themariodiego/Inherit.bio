import { expect, it, vi } from "vitest";

vi.mock("../e2e/helpers", () => ({ signIn: vi.fn() }));

import { CHECKED_ELSEWHERE, DOCUMENTS, PUBLIC_ROUTES, VISIT, createAccessibilitySweep, registeredPages } from "../e2e/accessibility-sweeps";

it("names an accessibility audit for every kept page without stale coverage entries", () => {
  const pages = registeredPages().map(route => route.path);
  const named = [...PUBLIC_ROUTES, ...Object.keys(DOCUMENTS), ...Object.keys(VISIT), ...Object.keys(CHECKED_ELSEWHERE)];
  expect(pages.filter(page => !named.includes(page))).toEqual([]);
  expect(named.filter(page => !pages.includes(page))).toEqual([]);
});

it("gives each complete measurement a distinct account and authentication closure", () => {
  const sweeps = Array.from({ length: 4 }, () => createAccessibilitySweep());
  expect(new Set(sweeps.map(sweep => sweep.G113B_ACCOUNT.email)).size).toBe(4);
  expect(new Set(sweeps.map(sweep => sweep.sweepPages)).size).toBe(4);
  for (const sweep of sweeps) {
    expect(sweep.G113B_ACCOUNT.email).toMatch(/^a11y-g113b-[0-9a-f-]{36}@e2e\.local$/);
    expect(sweep.G113B_ACCOUNT.password).toBe("e2e-a11y-g113b-pw");
  }
  const original = sweeps[1].G113B_ACCOUNT.email;
  sweeps[0].G113B_ACCOUNT.email = "separate@e2e.local";
  expect(sweeps[1].G113B_ACCOUNT.email).toBe(original);
});
