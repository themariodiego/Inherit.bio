/**
 * G8.3's collector. Every figure the product renders carries the attributes
 * `src/lib/figures/contract.ts` defines, and exactly two components emit them
 * (`Figure` and `RelativeFigure`), so a surface cannot show a number outside
 * this net without going around the contract.
 *
 * Passed to `page.evaluate`, so it must be self-contained: no imports, no
 * closure over anything in the test realm.
 */
export type CollectedFigure = {
  kind: string;
  figureClass: string | null;
  basis: string | null;
  provenance: string | null;
  /**
   * The nearest identifying ancestor — a region code or a claim id.
   *
   * Without this, figures are paired by their position among figures of the
   * same shape, and ancestry shares render in descending order, so position
   * does not name a region. The first differencing run reported two shares as
   * unchanged at "0.0%": seed A's SAS against seed B's EUR, two different
   * regions that happened to round to the same string. Pairing on that would
   * have put a meaningless entry in the register and hidden a real comparison.
   */
  context: string | null;
  value: string;
};

export function collectFigures(): CollectedFigure[] {
  const nodes = document.querySelectorAll<HTMLElement>("[data-figure-kind]");
  return [...nodes].map((node) => {
    const valueNode = node.querySelector<HTMLElement>('[data-slot="figure-value"]');
    const identified = node.closest<HTMLElement>("[data-region], [data-claim-id]");
    return {
      kind: node.getAttribute("data-figure-kind") ?? "",
      figureClass: node.getAttribute("data-figure-class"),
      basis: node.getAttribute("data-figure-basis"),
      provenance: node.getAttribute("data-provenance"),
      context: identified
        ? identified.getAttribute("data-region") ?? identified.getAttribute("data-claim-id")
        : null,
      value: (valueNode ?? node).innerText.replace(/\s+/g, " ").trim(),
    };
  });
}

/** The key a figure is paired by across two seeds: what it is, not what it says. */
export function figureKey(figure: CollectedFigure, ordinal: number): string {
  return [figure.kind, figure.figureClass ?? "-", figure.basis ?? "-", figure.provenance ?? "-",
    figure.context ?? "-", ordinal].join("|");
}

/** Keys in document order, numbering repeats of the same shape. */
export function keyed(figures: readonly CollectedFigure[]): Map<string, CollectedFigure> {
  const seen = new Map<string, number>();
  const out = new Map<string, CollectedFigure>();
  for (const figure of figures) {
    const shape = figureKey(figure, 0).slice(0, -2);
    const ordinal = (seen.get(shape) ?? 0) + 1;
    seen.set(shape, ordinal);
    out.set(figureKey(figure, ordinal), figure);
  }
  return out;
}
