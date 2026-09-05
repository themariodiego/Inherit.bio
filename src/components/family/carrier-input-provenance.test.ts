import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CarrierInputProvenance } from "./carrier-input-provenance";
import type { InputSourceView } from "@/lib/genome/input-sources";

it("distinguishes each adult's gene observations, checked-only inputs and exact long-run inputs", () => {
  const source = (fileId: string): InputSourceView => ({ fileId, fileType: "vcf", processedAt: null, snapshot: null });
  const html = renderToStaticMarkup(h(CarrierInputProvenance, {
    sources: { a: [source("a-gene"), source("a-runs")], b: [source("b-checked"), source("b-gene")] },
    subjects: { a: { id: "adult-a", label: "Adult A" }, b: { id: "adult-b", label: "Adult B" } },
    summary: { matches: [], classifiedPositions: 2, positionsBothCover: 1, genotypes: { a: new Map(), b: new Map() },
      inputFileIds: { a: ["a-gene"], b: ["b-gene"] },
      runsInputFileIds: { a: ["a-runs"], b: ["b-gene"] },
      inputFilesByGene: new Map([["CFTR", { a: ["a-gene"], b: ["b-gene"] }], ["HBB", { a: [], b: [] }]]),
    },
  }));
  expect(html).toContain("Adult A"); expect(html).toContain("Adult B");
  expect(html).toContain("CFTR — File 1"); expect(html).toContain("CFTR — File 2");
  expect(html.match(/Files checked for the stored long-run measure: File 2/g)).toHaveLength(2);
  expect(html).not.toContain("long-run measure: File 1");
  expect(html).toContain("HBB — no recorded position");
  expect(html).toContain("supplied no record");
  expect(html).not.toMatch(/<details|<h[1-6]|a-gene|b-checked/);
});
