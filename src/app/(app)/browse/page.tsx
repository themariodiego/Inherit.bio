import type { Metadata } from "next";
import { GenomeBrowser } from "@/components/browse/genome-browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getActiveFile } from "@/lib/genome/load";
import { chromToName, chromToNumber, parseRsid } from "@/lib/genome/types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Browse genome" };

interface Hit {
  rsid: number | null;
  chrom: number;
  pos: number;
  ref: string | null;
  alt: string | null;
  genotype: string | null;
  gene: string | null;
  clinvar: string | null;
  gnomadAf: number | null;
}

export default async function BrowsePage(props: PageProps<"/browse">) {
  const searchParams = await props.searchParams;
  const q = (typeof searchParams.q === "string" ? searchParams.q : "").trim();
  const fileParam =
    typeof searchParams.file === "string" ? searchParams.file : undefined;

  const supabase = await createClient();
  const active = await getActiveFile(supabase, fileParam);

  let hits: Hit[] = [];
  let mode: "rsid" | "gene" | "locus" | null = null;
  let locus: { chrom: number; start: number; end: number } | null = null;
  let message: string | null = null;

  if (q && active) {
    const rsid = parseRsid(q);
    const locusMatch = /^(chr)?([0-9XYM T]+):([\d,]+)(?:-([\d,]+))?$/i.exec(q);

    if (rsid) {
      mode = "rsid";
      const [{ data: mine }, { data: ann }] = await Promise.all([
        supabase
          .from("user_variants")
          .select("rsid, chrom, pos, ref, alt, genotype")
          .eq("file_id", active.id)
          .eq("rsid", rsid)
          .limit(1),
        supabase
          .from("ref_variants")
          .select("rsid, chrom, pos38, ref, alt, gene_symbol, clinvar_significance, gnomad_af")
          .eq("rsid", rsid)
          .maybeSingle(),
      ]);
      const v = mine?.[0];
      if (v) {
        hits = [
          {
            rsid,
            chrom: v.chrom,
            pos: v.pos,
            ref: v.ref,
            alt: v.alt,
            genotype: v.genotype,
            gene: ann?.gene_symbol ?? null,
            clinvar: ann?.clinvar_significance ?? null,
            gnomadAf: ann?.gnomad_af ?? null,
          },
        ];
        locus = { chrom: v.chrom, start: Math.max(1, v.pos - 5000), end: v.pos + 5000 };
      } else if (ann?.pos38) {
        message = `Your file does not cover rs${rsid}${ann.gene_symbol ? ` (${ann.gene_symbol})` : ""}.`;
        locus = {
          chrom: ann.chrom,
          start: Math.max(1, ann.pos38 - 5000),
          end: ann.pos38 + 5000,
        };
      } else {
        message = `rs${rsid} is not in your file and not in the reference store.`;
      }
    } else if (locusMatch) {
      mode = "locus";
      const chrom = chromToNumber(locusMatch[2]);
      const start = Number(locusMatch[3].replace(/,/g, ""));
      const end = locusMatch[4]
        ? Number(locusMatch[4].replace(/,/g, ""))
        : start + 10000;
      if (chrom) {
        locus = { chrom, start: Math.max(1, start - 1), end };
        const { data } = await supabase
          .from("user_variants")
          .select("rsid, chrom, pos, ref, alt, genotype")
          .eq("file_id", active.id)
          .eq("chrom", chrom)
          .gte("pos", start)
          .lte("pos", end)
          .order("pos")
          .limit(200);
        hits = (data ?? []).map((v) => ({
          ...v,
          gene: null,
          clinvar: null,
          gnomadAf: null,
        }));
      } else {
        message = "Unrecognized chromosome.";
      }
    } else {
      mode = "gene";
      const { data: refs } = await supabase
        .from("ref_variants")
        .select("rsid, chrom, pos38, ref, alt, gene_symbol, clinvar_significance, gnomad_af")
        .ilike("gene_symbol", q)
        .order("pos38")
        .limit(100);
      if (refs && refs.length > 0) {
        const rsids = refs.map((r) => r.rsid);
        const { data: mine } = await supabase
          .from("user_variants")
          .select("rsid, genotype")
          .eq("file_id", active.id)
          .in("rsid", rsids);
        const genotypeOf = new Map(
          (mine ?? []).map((m) => [m.rsid, m.genotype]),
        );
        hits = refs.map((r) => ({
          rsid: r.rsid,
          chrom: r.chrom,
          pos: r.pos38 ?? 0,
          ref: r.ref,
          alt: r.alt,
          genotype: genotypeOf.get(r.rsid) ?? null,
          gene: r.gene_symbol,
          clinvar: r.clinvar_significance,
          gnomadAf: r.gnomad_af,
        }));
        const positions = refs.map((r) => r.pos38 ?? 0).filter(Boolean);
        if (positions.length > 0) {
          locus = {
            chrom: refs[0].chrom,
            start: Math.max(1, Math.min(...positions) - 10000),
            end: Math.max(...positions) + 10000,
          };
        }
      } else {
        message = `No reference variants known for "${q}" — try an rsID (rs123…) or a position (chr15:74749576).`;
      }
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="eyebrow mb-2">Exploration</p>
        <h1 className="display text-3xl">Browse your genome</h1>
        {active ? (
          <p className="mt-2 text-sm text-ink-muted">
            Searching <strong>{active.original_name}</strong> (
            {active.variant_count?.toLocaleString()} variants) — by rsID, gene
            symbol, or position.
          </p>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">
            Process a file first to explore your variants.
          </p>
        )}
      </div>

      <form className="flex gap-2" action="/browse" method="get">
        <Input
          name="q"
          defaultValue={q}
          placeholder="rs762551 · CYP1A2 · chr20:1000000-1100000"
          aria-label="Search variants"
          className="max-w-md font-mono text-sm"
        />
        <Button type="submit">Search</Button>
      </form>

      {message ? (
        <p className="rounded-xl border border-line bg-card p-4 text-sm text-ink-muted">
          {message}
        </p>
      ) : null}

      {hits.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-ink-muted">
                <th className="px-4 py-2 font-normal">Variant</th>
                <th className="px-4 py-2 font-normal">Position (GRCh38)</th>
                <th className="px-4 py-2 font-normal">Gene</th>
                <th className="px-4 py-2 font-normal">Your genotype</th>
                <th className="px-4 py-2 font-normal">ClinVar</th>
                <th className="px-4 py-2 font-normal">gnomAD AF</th>
              </tr>
            </thead>
            <tbody>
              {hits.map((h, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="px-4 py-2 font-mono">
                    {h.rsid ? `rs${h.rsid}` : "—"}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">
                    chr{chromToName(h.chrom)}:{h.pos.toLocaleString()}
                    {h.ref && h.alt ? ` ${h.ref}→${h.alt}` : ""}
                  </td>
                  <td className="px-4 py-2">{h.gene ?? "—"}</td>
                  <td className="px-4 py-2">
                    {h.genotype ? (
                      <span className="rounded-full bg-tint px-2.5 py-0.5 font-mono">
                        {h.genotype}
                      </span>
                    ) : (
                      <span className="text-xs text-ink-muted">
                        not covered
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-xs">{h.clinvar ?? "—"}</td>
                  <td className="px-4 py-2 text-xs">
                    {h.gnomadAf != null ? h.gnomadAf.toFixed(4) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {locus && active ? (
        <section>
          <h2 className="eyebrow mb-2">
            Genome browser · chr{chromToName(locus.chrom)}:
            {locus.start.toLocaleString()}-{locus.end.toLocaleString()}
          </h2>
          <GenomeBrowser fileId={active.id} locus={locus} />
          <p className="mt-2 text-xs text-ink-muted">
            Rendered from your own variant store only — no external genome
            service is contacted (the reference here is positions-only, served
            by this deployment).
          </p>
        </section>
      ) : null}
    </div>
  );
}
