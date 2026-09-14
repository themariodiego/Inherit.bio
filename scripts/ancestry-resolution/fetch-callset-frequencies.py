#!/usr/bin/env python3
"""Per-population allele frequencies at the shipped panel, from the full callset.

The public gnomAD API returns 73 named populations and omits Oceania entirely
(D-116), so the equal-granularity question cannot be answered through it. The
full HGDP+1kGP release can answer it, and this reads the release **without
downloading it**: each chromosome's VCF is 50-270 GB, but it ships a tabix
index, so a marker costs one range request over the ~16 kb of genome its
smallest index bin covers. Measured: about a second per marker.

    python3 scripts/ancestry-resolution/fetch-callset-frequencies.py

Writes `hgdp-tgp-freqs.json` and `hgdp-tgp-populations.json` beside this script.
Reference data is fetched at run time and NOT committed: no marker enters
`data/ref/` without a licence-audit row (docs/dataset-licenses.md, and the
HGDP+1kGP row added 2026-09-14). NOTHING HERE READS A REAL PERSON'S FILE.

The genotypes read here belong to named, consenting reference cohorts, and are
reduced to per-population counts before anything is written.
"""
import gzip, json, os, subprocess, sys, time
import tabix_http as tabix

HERE = os.path.dirname(os.path.abspath(__file__))
BUCKET = "https://storage.googleapis.com/gcp-public-data--gnomad/release/3.1.2/vcf/genomes"
VCF = f"{BUCKET}/gnomad.genomes.v3.1.2.hgdp_tgp.chr{{c}}.vcf.bgz"
META = f"{BUCKET}/gnomad.genomes.v3.1.2.hgdp_1kg_subset_sample_meta.tsv.bgz"
WORK = os.environ.get("CALLSET_WORK", "/tmp/hgdp-tgp")
os.makedirs(WORK, exist_ok=True)


def curl(url, out):
    if os.path.exists(out) and os.path.getsize(out) > 0:
        return out
    p = subprocess.run(["curl", "-sS", "--max-time", "900", "-o", out, url])
    assert p.returncode == 0, url
    return out


def sample_populations():
    """sample id -> (population, genetic region), high-quality samples only."""
    path = curl(META, os.path.join(WORK, "meta.tsv.bgz"))
    out = {}
    with gzip.open(path, "rt") as f:
        head = f.readline().rstrip("\n").split("\t")
        idx = {h: i for i, h in enumerate(head)}
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) != len(head) or parts[idx["high_quality"]] != "true":
                continue
            try:
                meta = json.loads(parts[idx["hgdp_tgp_meta"]])
            except Exception:
                continue
            if meta.get("population"):
                out[parts[idx["s"]]] = (meta["population"], meta.get("genetic_region"))
    return out


def header_samples(chrom):
    """The #CHROM line's sample columns, read from the front of the file."""
    url = VCF.format(c=chrom)
    start, buf, tail = 0, b"", b""
    while start < 40_000_000:
        raw = tabix._read(url, start, start + 4_000_000 - 1)
        if not raw:
            break
        for block in tabix.bgzf_blocks(raw):
            buf += block
            if b"\n#CHROM" in buf or buf.startswith(b"#CHROM"):
                line = buf.split(b"#CHROM", 1)[1].split(b"\n", 1)[0]
                return line.decode().split("\t")[9:]
        start += 4_000_000
    raise RuntimeError(f"no #CHROM line found for chr{chrom}")


def counts(line, samples, pop_of):
    """Per-population (ALT copies, called copies) for one VCF record."""
    fields = line.split(b"\t")
    ref, alt = fields[3].decode(), fields[4].decode()
    fmt = fields[8].decode().split(":")
    gt_at = fmt.index("GT")
    tally = {}
    for sample, raw in zip(samples, fields[9:]):
        pop = pop_of.get(sample)
        if pop is None:
            continue
        gt = raw.split(b":", gt_at + 1)[gt_at].decode() if gt_at else raw.split(b":", 1)[0].decode()
        ac = an = 0
        for allele in gt.replace("|", "/").split("/"):
            if allele == ".":
                continue
            an += 1
            # Only the first ALT is this panel's allele; a record carrying more
            # is counted against it and the rest are REF-or-other, which is
            # what an allele frequency for THIS allele means.
            if allele == "1":
                ac += 1
        name = pop[0]
        c = tally.setdefault(name, [0, 0])
        c[0] += ac
        c[1] += an
    return {"ref": ref, "alt": alt, "pops": {k: {"ac": v[0], "an": v[1]} for k, v in tally.items()}}


def main():
    aims = json.load(open(os.path.join(HERE, "..", "..", "data", "ref", "aims.json")))
    pop_of = sample_populations()
    print(f"high-quality samples with a population: {len(pop_of)}", file=sys.stderr)
    by_pop = {}
    for pop, region in pop_of.values():
        by_pop.setdefault(pop, {"region": region, "samples": 0})["samples"] += 1
    json.dump(by_pop, open(os.path.join(HERE, "hgdp-tgp-populations.json"), "w"), indent=2, sort_keys=True)

    out_path = os.path.join(HERE, "hgdp-tgp-freqs.json")
    out = json.load(open(out_path)) if os.path.exists(out_path) else {}
    by_chrom = {}
    for m in aims:
        by_chrom.setdefault(m["chrom"], []).append(m)

    for chrom in sorted(by_chrom):
        markers = [m for m in by_chrom[chrom] if f"{m['chrom']}-{m['pos38']}-{m['ref']}-{m['alt']}" not in out]
        if not markers:
            continue
        tbi = curl(VCF.format(c=chrom) + ".tbi", os.path.join(WORK, f"chr{chrom}.tbi"))
        refs = tabix.load_index(tbi)
        samples = header_samples(chrom)
        url = VCF.format(c=chrom)
        for m in markers:
            key = f"{m['chrom']}-{m['pos38']}-{m['ref']}-{m['alt']}"
            t = time.time()
            lines = tabix.query(url, refs, f"chr{chrom}", m["pos38"])
            hit = None
            for line in lines:
                rec = counts(line, samples, pop_of)
                # EXACT match only. `counts` attributes every ALT copy to
                # allele 1, so accepting a record whose second ALT happens to
                # be this panel's allele would report a frequency for a
                # different variant. gnomAD splits multi-allelics one per line,
                # so a record with a comma here is a reason to stop rather than
                # to pick.
                if rec["ref"] == m["ref"] and rec["alt"] == m["alt"]:
                    hit = rec
                    break
            out[key] = hit and {"rsid": m["rsid"], **hit}
            json.dump(out, open(out_path, "w"))
            print(f"chr{chrom}:{m['pos38']} {m['rsid']} "
                  f"{'ok' if hit else 'NO MATCHING ALLELE'} {time.time() - t:.1f}s "
                  f"({len(out)}/{len(aims)})", file=sys.stderr, flush=True)
    found = sum(1 for v in out.values() if v)
    print(f"wrote {found} of {len(aims)} markers", file=sys.stderr)


if __name__ == "__main__":
    main()
