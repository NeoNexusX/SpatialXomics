---
name: annotation-review
description: Review the current annotation table — total score, FDR, spatial structure, same-molecule adducts, and a per-row verdict template
whenToUse: When the user asks to review/check/rank annotations, ask which annotations are trustworthy, or wants a confidence report of the annotation table
---

# Annotation Review Workflow

Goal: turn the scored annotation table into a per-row verdict with explicit
judgment criteria — never a bare "this is X".

## 1. Gather
1. `get_page_state` — confirm annotation count > 0; note polarity.
2. `get_annotation_top` (topN up to 20). One row = one adduct ion; rows carry tokens:
   `#1 PC 34:1 [M+H]+ mz=760.5856 (+0.6ppm) s=0.94 q=0.4% m=0.97 fit=1.0 ch=0.95 col=0.91 sib=[M+Na]+,[M+K]+ samePeak=1`
   - `s` — total score = 0.7×mass + 0.1×adduct fit + 0.2×spatial (higher = stronger). Spatial = 0.2×chaos + 0.8×co-localization; missing co-localization and uncomputed spatial scores count as 0.
   - `q` — target-decoy FDR q-value (smaller = more credible).
   - `m` — mass-error score (1 = exact, ~0.14 at the tolerance edge).
   - `fit` — how plausible this adduct is for the acquisition (ion source, matrix, solvent, polarity).
   - `ch` — spatial chaos (level-set measure; high = coherent structure, low = scattered noise). Present only for ions that got spatial scoring.
   - `col` — best Pearson between this ion's image and the images of the same molecule's other adducts. It only raises the spatial score.
   - `sib` — other adduct ions of the same molecule (each is its own row).
   - `samePeak` — number of other annotations explaining the same peak.
3. For any row you will discuss in depth, call `get_annotation_detail(mz)` — score breakdown, sibling ions with their r, undetected enabled adducts, same-peak alternatives, candidate list.

## 2. Judgment criteria (verdict matrix)
| Verdict | Criteria (all required unless noted) |
|---|---|
| **High confidence** | q ≤ 5% AND ch ≥ 0.8 AND (a sibling with r ≥ 0.7, OR m ≥ 0.9 with fit ≥ 0.9) |
| **Moderate** | q ≤ 10–20% AND ch ≥ 0.6; or a sibling with r ≥ 0.7 even if q is higher |
| **Low / mass-only** | no spatial score (ch absent) AND no sibling AND q > 10% |
| **Questionable** | samePeak > 0 (the peak has other explanations); or siblings exist but every r < 0.4 (same neutral mass, different spatial distribution); or ch < 0.5 (scattered signal) |
| **Reject** | q ≥ 50% with no other evidence |

Additional checks:
- **Same-peak ambiguity**: a classic case is [M+Na]⁺ of one lipid vs [M+H]⁺ of another (e.g. PC 34:1 [M+Na]⁺ and PC 36:4 [M+H]⁺ differ by 2.4 mDa). Prefer the explanation whose siblings co-localize; otherwise say MS/MS is needed.
- **Isomers**: one row is a sum composition (formula); multiple candidate names are isomers, not separate identifications.
- **Matrix/background peaks** can have high chaos (uniform coverage on and off tissue); check the ion image before calling them biological.
- **Pixel-size sanity**: any spatial claim needs the pixel size from the dataset context; features < 2× pixel size are noise.

## 3. Output template (use this structure)

```
## Annotation review (top N rows, sorted by total score)

| # | m/z | Candidate (putative) | Adduct | q | Spatial (ch / best sibling r) | Same peak | Verdict |
|---|-----|----------------------|--------|---|-------------------------------|-----------|---------|
| 1 | 760.5856 | PC 34:1 | [M+H]+ | 0.4% | 0.95 / 0.91 ([M+Na]+) | — | High |
| 2 | 782.5668 | PC 34:1 | [M+Na]+ | 1.2% | 0.93 / 0.91 | PC 36:4 [M+H]+ | Moderate (ambiguous peak) |

### Key findings
- <2-4 strongest rows: what evidence makes them credible, which region they mark>

### Questionable calls
- <rows with shared peaks, non-co-localized siblings, low chaos, or q > 20%: what to re-check>

### Caveats
All annotations are putative (accurate-mass level unless MS/MS/standards confirm).
```

Rules for the table: cap at 10–12 rows; one line per row in prose findings; always state the sort criterion (total score descending).
