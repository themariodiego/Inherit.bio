// Shared, server-safe helpers for the report library surfaces (the /reports
// list page and the dashboard tiles).

/**
 * Explicit display order for report categories. Approachable categories lead;
 * sensitive ones are intentionally LAST, in this order: mental health,
 * addiction, cancer risk, neurodegenerative. A category not listed here falls
 * between the approachable block and the sensitive tail.
 */
export const CATEGORY_ORDER: string[] = [
  // Approachable first.
  "basic-traits",
  "lifestyle-wellness",
  "aesthetic-cosmetic",
  "heart-cardiovascular",
  "metabolic-obesity",
  "gastrointestinal",
  "environmental-sensitivity",
  "autoimmune",
  "longevity",
  "brain-health",
  "reproductive-family",
  // Sensitive last — keep this order.
  "mental-health",
  "addiction",
  "cancer-risk",
  "neurodegenerative",
];

const SENSITIVE_TAIL_START = CATEGORY_ORDER.indexOf("mental-health");

/**
 * Sort rank for a category. Unknown categories rank between the known
 * approachable block and the sensitive tail.
 */
export function categoryRank(category: string): number {
  const i = CATEGORY_ORDER.indexOf(category);
  return i === -1 ? SENSITIVE_TAIL_START - 0.5 : i;
}

/**
 * Test-fixture templates (the research pipeline E2E publishes
 * `auto-e2e-*` slugs) must never appear in user-facing library surfaces,
 * regardless of environment. They stay published so the publish flow —
 * changelog, digest, direct links — keeps working.
 */
export function isFixtureSlug(slug: string): boolean {
  return slug.startsWith("auto-e2e-");
}
