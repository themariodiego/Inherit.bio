"""Writes the four htslib cross-check files from the in-repository invented BAM.

Not part of the product or of any CI job. It exists so that the files in this
directory can be rebuilt and audited. They were written once, on 22 October
2026, with pysam 0.24.1 (htslib 1.24, samtools 1.24) from PyPI, in a scratch
virtual environment outside the repository. htslib is an independent BAM/CRAM
implementation: it writes the files Inherit's readers must open, and its own
reading of them supplies the record digests in `htslib-cross-check.json`.

No input here comes from a person: the source is
`../synthetic-matrix.bam` and `../synthetic-reference.fa`, both written by
`scripts/generate-read-calling-fixtures.ts`.

Run (outside the repository's toolchain):
    python -I recipe.py <output directory>
"""
import hashlib
import json
import os
import random
import sys

import pysam

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = HERE + "/../synthetic-matrix.bam"
REFERENCE = HERE + "/../synthetic-reference.fa"


def dump(path, mode):
    lines = []
    with pysam.AlignmentFile(path, mode, reference_filename=REFERENCE) as handle:
        for read in handle.fetch(until_eof=True):
            lines.append("|".join(map(str, [read.query_name, read.flag, read.reference_id, read.reference_start,
                                            read.mapping_quality, read.cigarstring, read.query_sequence,
                                            ",".join(map(str, read.query_qualities))])))
    return len(lines), hashlib.sha256("\n".join(lines).encode()).hexdigest()


def main(directory):
    # CRAM stores the first 20 bytes of the output name as its file id, so the
    # files are written by bare name from inside the output directory.
    os.chdir(directory)
    out = "."
    with pysam.AlignmentFile(SOURCE, "rb") as source:
        header = source.header
        text = str(header)
        lines = [read.to_string() for read in source.fetch(until_eof=True)]
    with open(out + "/header.sam", "w") as handle:
        handle.write(text)
    reads = [pysam.AlignedSegment.fromstring(line, header) for line in lines]

    with pysam.AlignmentFile(out + "/htslib-matrix.bam", "wb", header=header) as handle:
        for read in reads:
            handle.write(read)
    for name, version in [("htslib-matrix-3.0.cram", "3.0"), ("htslib-matrix-3.1.cram", "3.1")]:
        with pysam.AlignmentFile(out + "/" + name, "wc", header=header, reference_filename=REFERENCE,
                                 format_options=["version=" + version]) as handle:
            for read in reads:
                handle.write(read)

    # Six thousand invented reads copied from the invented reference, with
    # qualities that drift like real ones, so htslib chooses rANS order 1 for
    # the quality block and that decoder path is exercised too.
    rng = random.Random(7)
    fasta = pysam.FastaFile(REFERENCE)
    drifting = []
    for index in range(6000):
        ref_id = index % 3
        position = rng.randint(0, 1500 - 61)
        read = pysam.AlignedSegment(header)
        read.query_name = "o1-%05d" % index
        read.flag = 0
        read.reference_id = ref_id
        read.reference_start = position
        read.mapping_quality = 60
        read.cigarstring = "60M"
        read.query_sequence = fasta.fetch(fasta.references[ref_id], position, position + 60)
        quality, previous = [], 30
        for _ in range(60):
            previous = max(2, min(41, previous + rng.choice([-1, 0, 0, 0, 1]) if rng.random() < 0.9 else rng.randint(2, 41)))
            quality.append(previous)
        read.query_qualities = pysam.qualitystring_to_array("".join(chr(33 + q) for q in quality))
        drifting.append(read)
    drifting.sort(key=lambda read: (read.reference_id, read.reference_start))
    with pysam.AlignmentFile(out + "/htslib-qualities-3.0.cram", "wc", header=header, reference_filename=REFERENCE,
                             format_options=["version=3.0"]) as handle:
        for read in drifting:
            handle.write(read)

    # htslib records the reference's absolute path as UR; replace the header
    # with the source's own, so no local path is stored.
    for name in ["htslib-matrix-3.0.cram", "htslib-matrix-3.1.cram", "htslib-qualities-3.0.cram"]:
        pysam.samtools.reheader("-P", "-i", out + "/header.sam", out + "/" + name)

    files = {}
    for name, mode, kind in [("htslib-matrix.bam", "rb", "BAM"), ("htslib-matrix-3.0.cram", "rc", "CRAM 3.0"),
                             ("htslib-matrix-3.1.cram", "rc", "CRAM 3.1"), ("htslib-qualities-3.0.cram", "rc", "CRAM 3.0")]:
        data = open(out + "/" + name, "rb").read()
        records, digest = dump(out + "/" + name, mode)
        files[name] = {"format": kind, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
                       "records": records, "recordDumpSha256": digest}
    print(json.dumps(files, indent=2))


if __name__ == "__main__":
    main(sys.argv[1])
