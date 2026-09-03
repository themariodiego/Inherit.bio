# Design notes

Working design documents produced during the Inherit v2 resolution, kept
so the decisions recorded in `docs/protocol/decisions.md` can be traced to
the analysis behind them. They are not binding: the brief, the registers
and the ledgers are. Paths inside them may refer to the session scratchpad
they were written in.

| Document | Scope | Status |
| --- | --- | --- |
| `w7-ancestry-surface.md` | Ancestry surface (§4.6): data feasibility, region set, uncertainty, components, tests, registers, open decisions | Built (268a8d8, c255e8a) |
| `w7-ancestry-surface-part-b-brief.md` | The brief given to the part B build | Built |
| `w8-expert-path.md` | The variant browser and data page on the figure contract | Built (f88ef91) |
| `pharmacogenomics-research-2026-09-03.md` | Primary-source research behind the Medicines category decision (licences, coordinates, guideline citations, structural limits); items it could not verify are marked UNVERIFIED | Built into the withheld dossier (`docs/withheld/pharmacogenomics.md`, ADR 0018): three designs built with their gate output, register row `withheld` |
| `w9-family-surfaces.md` | The Family surfaces (§4 §3): people graph, eight states, Tier-2 gate, permissions, health picture with carrier pairs, Portrait; figures, copy, data, tests, registers; build split F0–F3 | Designed; F0 (migrations and RPCs) next |
