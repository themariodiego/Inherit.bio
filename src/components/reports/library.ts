// Shared, server-safe helpers for the report library surfaces. Category
// order is the nine-category taxonomy in @/lib/genome/taxonomy
// (CATEGORY_TAXONOMY); nothing here restates it.

/**
 * Test-fixture templates (the research pipeline E2E publishes
 * `auto-e2e-*` slugs) must never appear in user-facing library surfaces,
 * regardless of environment. They stay published so the publish flow —
 * changelog, digest, direct links — keeps working.
 */
export function isFixtureSlug(slug: string): boolean {
  return slug.startsWith("auto-e2e-");
}
