"""Apply every docs/density-baseline.json budget to one successor capture.

usage: python3 -I evaluate-budgets.py <baseline computed-measurements.json> <successor dir>

The successor dir holds capture-manifest.json (tools/successor-capture.mjs) and
computed-measurements.json (scripts/density-baseline/compute.mjs, unchanged).
The thresholds and surface classes are the ones scripts/density-current.ts
applies; the relative rule compares with the baseline file given, which must
come from the same machine and browser build. Writes <dir>/evaluation.json.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
baseline_file, succ_dir = sys.argv[1], Path(sys.argv[2])
base = json.load(open(baseline_file))
succ = json.load(open(succ_dir / "computed-measurements.json"))
man = json.load(open(succ_dir / "capture-manifest.json"))
reg = json.load(open(ROOT / "docs/route-register.json"))
contract = json.load(open(ROOT / "docs/density-baseline.json"))
routes = {r["id"]: r for r in reg["routes"]}
B = {(r["measurementPath"], v): m for r in base["routes"] for v, m in r["measurements"].items()}
pred = {e["successorRouteId"]: e["baselineRoute"] for e in contract["relativeComparison"]["routes"]}
invented = {"/ancestry", "/reports", "/dashboard"}
domain = {"app.overview", "genome.subject", "family.index", "embryos.index"}
rows = []
for r in succ["routes"]:
    p = r["measurementPath"]; rid = man["routeIds"][p]; route = routes[rid]
    for vp, m in r["measurements"].items():
        w = int(vp.split("x")[0]); s = route["surface"]
        fails = []
        floor = 0.45 if s == "wide-data" else 0.62 if s in ("hub", "standard") else 0
        if m["whiteSpaceRatio"] < floor: fails.append(f"white {m['whiteSpaceRatio']:.3f}<{floor}")
        acts = 24 if s == "wide-data" else 7 if s == "flow" else 12 if s in ("hub", "standard") else None
        if acts is not None and m["interactiveElementCount"] > acts: fails.append(f"interactive {m['interactiveElementCount']}>{acts}")
        cap = 480 if rid in domain else 700
        if m["visibleTextCharacterCount"] > cap: fails.append(f"chars {m['visibleTextCharacterCount']}>{cap}")
        dcap = 40 if w == 390 else 60
        if m["budgetedDecoratedElementCount"] > dcap: fails.append(f"decorated {m['budgetedDecoratedElementCount']}>{dcap}")
        if m["maxProseMeasureCh"] is not None and m["maxProseMeasureCh"] > 68: fails.append(f"maxProse {m['maxProseMeasureCh']:.1f}>68")
        if w >= 640 and m["minProseMeasureCh"] is not None and m["minProseMeasureCh"] < 45: fails.append(f"minProse {m['minProseMeasureCh']:.1f}<45")
        gap = 96 if w >= 1024 else 80 if w >= 768 else 64
        if m["minimumAdjacentSectionGapPx"] is not None and m["minimumAdjacentSectionGapPx"] < gap: fails.append(f"gap {m['minimumAdjacentSectionGapPx']}<{gap}")
        if w == 390:
            if m["primaryContentLeftPaddingPx"] is None or m["primaryContentLeftPaddingPx"] < 24: fails.append(f"pad {m['primaryContentLeftPaddingPx']}<24")
            if m["primaryClaimTextElementCount"] is not None and m["primaryClaimTextElementCount"] > 7: fails.append("claimText")
            if m["primaryClaimFigureCount"] is not None and m["primaryClaimFigureCount"] > 1: fails.append("claimFig")
        if m["horizontalOverflowPx"] != 0: fails.append(f"overflow {m['horizontalOverflowPx']}")
        raw = man["routes"][p][vp]
        alt = []
        if raw.get("maxParagraphProseMeasureCh") is not None and raw["maxParagraphProseMeasureCh"] > 68: alt.append("pMax")
        if w >= 640 and raw.get("minParagraphProseMeasureCh") is not None and raw["minParagraphProseMeasureCh"] < 45: alt.append("pMin")
        if raw.get("maxParagraphLineMeasureCh") is not None and raw["maxParagraphLineMeasureCh"] > 68: alt.append("lineMax")
        rel = None
        bp = pred.get(rid)
        if bp and bp not in invented:
            b = B[(bp, vp)]
            rel = m["inkCoverageRatio"] / b["inkCoverageRatio"]
            if m["inkCoverageRatio"] > b["inkCoverageRatio"] * 0.6: fails.append(f"relative {rel:.4f}>0.6")
        rows.append(dict(id=rid, path=p, vp=vp, surface=s, ink=m["inkCoverageRatio"], rel=rel, fails=fails, alt=alt))
json.dump(rows, open(succ_dir / "evaluation.json", "w"), indent=1)
print(f"captures {len(rows)} passing-all {sum(1 for r in rows if not r['fails'])}")
for r in rows:
    print(f"{r['id']:34} {r['vp']:9} ink={r['ink']:.6f} " + (f"ratio={r['rel']:.4f} " if r["rel"] is not None else "") + ("; ".join(r["fails"]) or "PASS"))
