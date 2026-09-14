"""Minimal tabix client over HTTPS range requests.

Reads only the BGZF blocks that can contain a queried position, so a 267 GB
VCF costs a few megabytes per marker instead of a download. Implements the
tabix index format directly because this container has no tabix or bcftools,
and installing one to read a few hundred records would be the wrong trade.
"""
import gzip, struct, zlib, subprocess

def _read(url, start, end):
    """Byte range [start, end] inclusive, as bytes."""
    p = subprocess.run(["curl", "-sS", "--max-time", "300", "-H", f"Range: bytes={start}-{end}", url],
                       capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(p.stderr.decode()[:300])
    return p.stdout

def load_index(path):
    # BGZF is concatenated gzip members; `gzip.decompress` walks all of them
    # where a single zlib stream stops after the first.
    with open(path, "rb") as f:
        raw = gzip.decompress(f.read())
    assert raw[:4] == b"TBI\x01", raw[:4]
    n_ref, fmt, col_seq, col_beg, col_end, meta, skip, l_nm = struct.unpack("<8i", raw[4:36])
    names = raw[36:36 + l_nm].split(b"\x00")
    off = 36 + l_nm
    refs = {}
    for r in range(n_ref):
        (n_bin,) = struct.unpack("<i", raw[off:off + 4]); off += 4
        bins = {}
        for _ in range(n_bin):
            b, n_chunk = struct.unpack("<Ii", raw[off:off + 8]); off += 8
            chunks = []
            for _ in range(n_chunk):
                beg, end = struct.unpack("<QQ", raw[off:off + 16]); off += 16
                chunks.append((beg, end))
            bins[b] = chunks
        (n_intv,) = struct.unpack("<i", raw[off:off + 4]); off += 4
        intv = list(struct.unpack(f"<{n_intv}Q", raw[off:off + 8 * n_intv])); off += 8 * n_intv
        refs[names[r].decode()] = (bins, intv)
    return refs

def reg2bins(beg, end):
    """Every bin id that can contain a feature overlapping [beg, end)."""
    end -= 1
    out = [0]
    for shift, start in ((26, 1), (23, 9), (20, 73), (17, 585), (14, 4681)):
        out.extend(range(start + (beg >> shift), start + (end >> shift) + 1))
    return out

def bgzf_blocks(buf):
    """Yield (uncompressed bytes) for each complete BGZF block in buf."""
    pos = 0
    while pos + 18 <= len(buf):
        if buf[pos:pos + 2] != b"\x1f\x8b":
            break
        xlen = struct.unpack("<H", buf[pos + 10:pos + 12])[0]
        extra = buf[pos + 12:pos + 12 + xlen]
        bsize = None
        i = 0
        while i + 4 <= len(extra):
            si1, si2, slen = extra[i], extra[i + 1], struct.unpack("<H", extra[i + 2:i + 4])[0]
            if si1 == 66 and si2 == 67:
                bsize = struct.unpack("<H", extra[i + 4:i + 6])[0] + 1
            i += 4 + slen
        if bsize is None or pos + bsize > len(buf):
            break
        block = buf[pos:pos + bsize]
        yield zlib.decompress(block[12 + xlen:bsize - 8], -zlib.MAX_WBITS)
        pos += bsize

def query(url, refs, chrom, pos):
    """Every VCF line at 1-based `pos` on `chrom`. Fetches only what it must."""
    if chrom not in refs:
        raise KeyError(chrom)
    bins, intv = refs[chrom]
    beg, end = pos - 1, pos
    # The smallest bin that covers the position, so the fetched span is ~16 kb
    # of genome rather than the whole chromosome.
    candidates = [b for b in reg2bins(beg, end) if b in bins]
    if not candidates:
        return []
    chunks = []
    for b in sorted(candidates, reverse=True):
        chunks.extend(bins[b])
        break  # the finest bin present is enough; coarser ones only widen it
    floor = intv[beg >> 14] if (beg >> 14) < len(intv) else 0
    lines = []
    for cbeg, cend in chunks:
        if cend < floor:
            continue
        virtual = max(cbeg, floor)
        # A record in this file spans many BGZF blocks, so the chunk's virtual
        # offset points INTO a block. Ignoring its uoffset lands mid-record and
        # parses a genotype field as a position.
        start, uoffset = virtual >> 16, virtual & 0xFFFF
        stop = (cend >> 16) + 65536
        buf = _read(url, start, stop)
        tail, first = b"", True
        for chunk in bgzf_blocks(buf):
            if first:
                chunk, first = chunk[uoffset:], False
            data = tail + chunk
            *complete, tail = data.split(b"\n")
            for line in complete:
                if line.startswith(b"#") or not line:
                    continue
                f = line.split(b"\t", 3)
                if not f[1].isdigit():
                    raise RuntimeError(f"not at a record boundary: {line[:60]!r}")
                p = int(f[1])
                if p == pos:
                    lines.append(line)
                elif p > pos:
                    return lines
    return lines
