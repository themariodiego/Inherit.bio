import fs from "node:fs";
import { expect } from "@playwright/test";
import type { CollectedFigure } from "./figure-collector";

/**
 * G8.3's comparison, in one place because two specs run it.
 *
 * A surface is rendered from two synthetic genomes that describe different
 * people, and every figure must move. Figures are paired by what they are —
 * kind, class, basis, provenance and the nearest identifying ancestor — never
 * by their value, so a figure that failed to move is caught rather than
 * quietly matched to a different one.
 */
type Register = {
  seedInvariant: { surface: string; key: string; reason: string }[];
  seedInvariantShapes?: { surface: string; shape: string; reason: string }[];
};
const REGISTER: Register = JSON.parse(fs.readFileSync("docs/figures-register.json", "utf8"));

/** The key without its ordinal: what a figure is, across every repeat of it. */
export function shapeOf(key: string): string {
  return key.slice(0, key.lastIndexOf("|"));
}

function invariant(surface: string, key: string): string | null {
  const entry = REGISTER.seedInvariant.find(row => row.surface === surface && row.key === key);
  if (entry) return entry.reason;
  const shape = (REGISTER.seedInvariantShapes ?? [])
    .find(row => row.surface === surface && row.shape === shapeOf(key));
  return shape ? shape.reason : null;
}

/**
 * The comparison itself, identical for every surface.
 *
 * Soft, so one run names every surface that carries a constant. A hard
 * assertion stops the loop at the first failing surface and reports the rest
 * as passing when they were never read — which is exactly how the first pass
 * over four My Genome surfaces came to be described as three greens and one
 * failure.
 */
export function assertEveryFigureMoved(surface: string,
  a: Map<string, CollectedFigure>, b: Map<string, CollectedFigure>) {
  // The surface must actually carry figures, or "all of them differ" is vacuous.
  expect.soft(a.size, `${surface}: seed A renders figures at all`).toBeGreaterThan(0);
  expect.soft([...b.keys()].sort(), `${surface}: both seeds render the same figures, so pairing is by shape`)
    .toEqual([...a.keys()].sort());

  const unchanged: string[] = [];
  for (const [key, figureA] of a) {
    const figureB = b.get(key);
    // A figure only one seed renders is the assertion above, not this one.
    if (!figureB || figureA.value !== figureB.value) continue;
    if (invariant(surface, key)) continue;
    unchanged.push(`${key} = "${figureA.value}" under both seeds`);
  }
  expect.soft(unchanged,
    `${surface}: a figure identical under two different genomes is a constant, not a result; `
    + "register it in docs/figures-register.json with the reason it cannot move")
    .toEqual([]);

  // A register entry that has started moving is stale and must not stay.
  const stale = REGISTER.seedInvariant
    .filter(row => row.surface === surface)
    .filter(row => a.has(row.key) && b.has(row.key) && a.get(row.key)!.value !== b.get(row.key)!.value)
    .map(row => row.key);
  expect.soft(stale, `${surface}: registered seed-invariant but they do differ; remove them`).toEqual([]);

  // A registered shape is stale when every figure of that shape moved: the
  // reason it gave has stopped being true, and leaving it would exempt a
  // surface that no longer needs exempting.
  const staleShapes = (REGISTER.seedInvariantShapes ?? [])
    .filter(row => row.surface === surface)
    .filter(row => {
      const keys = [...a.keys()].filter(key => shapeOf(key) === row.shape && b.has(key));
      return keys.length > 0 && keys.every(key => a.get(key)!.value !== b.get(key)!.value);
    })
    .map(row => row.shape);
  expect.soft(staleShapes,
    `${surface}: registered seed-invariant shapes whose every figure moved; remove them`).toEqual([]);
}
