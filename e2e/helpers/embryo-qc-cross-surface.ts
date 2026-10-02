import { expect, type Page } from "@playwright/test";
import { adminClient } from "../helpers";
import { collectFigures } from "../figure-collector";
import { assertRegisteredQcFigures, collectQcPresentations, type QcFigurePresentation } from "../embryo-qc-cross-surface";
import { participantCPublication } from "../../scripts/comprehension/participant-c-seed";
import { projectQc, type EmbryoQcRow } from "@/lib/embryos/projection";
import { readEmbryoQcRows } from "@/lib/embryos/qc-reader";

/** Reads genuine published QC; never advances a job or creates a result. */
export async function provePublishedQcCrossSurface(input: { page: Page; ownerId: string; cohortId: string; read(): Promise<unknown> }) {
  const current = async () => participantCPublication(await input.read(), input.ownerId, input.cohortId);
  const publication = await current();
  const readQc = async () => {
    const result = await readEmbryoQcRows(adminClient(), input.cohortId, publication.embryos.map(row => row.id));
    expect(result.error).toBeNull();expect(result.data).toHaveLength(2);
    expect(result.data!.map(row => row.embryo_id).sort()).toEqual(publication.embryos.map(row => row.id).sort());
    return publication.embryos.map(embryo => ({ embryoId: embryo.id, subjectId: embryo.subject_id,
      qc: projectQc(result.data!.find(row => row.embryo_id === embryo.id) as EmbryoQcRow) }));
  };
  const sources = await readQc();
  const receipts: { route: string; url: string; figures: QcFigurePresentation[] }[] = [];
  for (const target of [{ route: "/embryos/compare", url: `/embryos/compare?cohort=${input.cohortId}`, sources, surface: "compare" as const },
    ...publication.embryos.map(embryo => ({ route: "/embryos/[embryoId]", url: `/embryos/${embryo.id}`,
      sources: sources.filter(row => row.embryoId === embryo.id), surface: "detail" as const }))]) {
    expect(await current()).toEqual(publication);expect(await readQc()).toEqual(sources);
    const response = await input.page.goto(target.url);
    expect(response?.status()).toBe(200);await expect(input.page).toHaveURL(url => url.pathname + url.search === target.url);
    await expect(input.page.locator('[data-slot="result-gate"], [data-slot="cohort-permission"], [data-slot="consent-required"], [data-slot="blocking-state"]')).toHaveCount(0);
    if (target.surface === "detail") {
      const disclosure = input.page.locator('[data-slot="qc-detail"]');
      await disclosure.locator("summary").click();
      await expect(disclosure).toHaveAttribute("open", "");
    }
    const classified = await input.page.evaluate(collectFigures), presentation = await input.page.evaluate(collectQcPresentations);
    expect(presentation).toHaveLength(classified.length);
    const figures = classified.map((figure, index) => ({ ...figure, ...presentation[index] }));
    assertRegisteredQcFigures(target.surface, figures, target.sources);
    receipts.push({ route: target.route, url: target.url, figures });
    expect(await readQc()).toEqual(sources);expect(await current()).toEqual(publication);
  }
  // Exact equality between actual primary table/detail presentations, with
  // separate copies (footer/full table) already held to the same stored value.
  for (const source of sources) {
    const comparison = receipts[0].figures.filter(row => row.subjectId === source.subjectId && row.location === "table");
    const detail = receipts.find(row => row.url === `/embryos/${source.embryoId}`)!.figures.filter(row => row.location === "block");
    const value = (rows: QcFigurePresentation[]) => rows.map(row => ({ field: row.field, kind: row.kind, figureClass: row.figureClass,
      basis: row.basis, provenance: row.provenance, value: row.value, unit: row.unit, caption: row.caption,
      modelledMarkers: row.modelledMarkers, exactMarkers: row.exactMarkers })).sort((a, b) => a.field!.localeCompare(b.field!));
    expect(value(detail)).toEqual(value(comparison));
  }
  return { publication, sources, surfaces: receipts };
}
