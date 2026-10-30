---
name: adduct-isotope-analysis
description: Analyze adduct evidence for one annotation row — adduct fit vs acquisition conditions, same-molecule sibling ions with co-localization, then biochemical/literature verification
whenToUse: When the user asks about adduct assignment, whether an adduct pattern supports an annotation, or wants one annotation row verified in depth
---

# Adduct Evidence Analysis

The core loop: **the left annotation panel's row as the basis → read its adduct
evidence → verify biochemically with the knowledge tools**.

## 1. Read the row's adduct evidence

The engine enables adducts by rules over the acquisition context (polarity,
ion source, matrix, additives) and assigns `fit` 0..1 (multiple hits take the
max):

| Adduct | Baseline fit | Raised to | When |
|---|---|---|---|
| [M+H]+ protonation | 1.0 | — | always |
| [M+Na]+ | 0.8 endogenous | 0.9 MALDI/LDI, 1.0 Na additive | laser desorption / sodium solvent |
| [M+K]+ | 0.6 endogenous | 0.9 MALDI/LDI | laser desorption |
| [M+NH4]+ | 0 (off) | 0.8 | ammonium additive |
| [M+Li]+ | 0 (off) | 0.9 | lithium additive |
| [M+Ag]+ | 0 (off) | 1.0 | AgNP matrix / silver additive |
| [M−H]− deprotonation | 1.0 | — | always |
| [M+Cl]− | 0.7 endogenous | 0.8 ESI, 0.9 Cl additive, 1.0 NEDC matrix | |
| [M+HCOO]− / [M+CH3COO]− | 0 (off) | 0.8 | formate / acetate additive |
| [M+H−H2O]+ / [M−H−H2O]− | manual only | 0.4 | user override |

Via tools:
1. `get_annotation_top` — the `fit=` token per row.
2. `get_annotation_detail(mzs=[...])` — pass ALL rows under scrutiny in ONE
   batched call; each result's `same molecule:` line lists every sibling
   adduct ion with its m/z, rank, and image Pearson `r` vs this ion;
   `enabled but not detected:` lists adducts the context would allow but no
   peak matched (negative evidence — a strong candidate usually shows its
   primary adducts).

Judgment:
- **Supports identity**: fit ≥ 0.8, ≥ 1 sibling with r ≥ 0.7, and mass
  differences between siblings match adduct deltas within ppm (verify:
  [M+Na]−[M+H] = 21.9819, [M+K]−[M+H] = 37.9559, [M+Cl]− and [M−H]− differ by
  ~35.9767).
- **Questionable**: siblings exist but every r < 0.4 — same neutral mass,
  different spatial distributions ⇒ likely two molecules (isobars) or a
  matrix-region artifact. Recommend MS/MS or narrower tolerance.
- **fit low but detected**: the engine still lists the ion (detection is
  mass-based; fit only weights the total score) — a [M+Na]+ row in a
  no-sodium context is not wrong, just worth checking siblings harder.

## 2. Biochemical & literature verification (always before reporting)

- `hmdb_lookup(queries=[...])` — endogenous metabolites? tissue/disease
  profiles consistent with the imaged sample? (batch all candidate names in
  one call)
- `kegg_pathway_lookup(queries=[...])` — pathway membership; if sibling
  annotations share a pathway, report it as coherence evidence.
- `chebi_lookup` / `pubchem_compound_lookup` — identity and biological role
  cross-check for competing candidates.
- `europepmc_search` / `pubmed_search` — prior imaging literature in this
  tissue/modality; cite PMID/DOI.

## 3. Output template

```
## Adduct evidence for m/z <value> (<candidate>)

**Adduct fit**: fit=<f> (<reason context: ion source / matrix / additives>).
Same-molecule ions: <siblings + m/z + r>. Δ between siblings matches adduct
deltas within <X> ppm. Enabled but not detected: <list, or none>.

**Biochemical verification**: HMDB <endogenous? tissue match?>; KEGG <pathway
membership, shared with which other annotations?>; literature <prior imaging
in this tissue, PMID>.

**Verdict**: <adduct + biochemical evidence supports / does not support this
annotation because …>. If uncertain: on-tissue MS/MS or standards (the
platform has no in-browser MS/MS library search).
```

Ground adduct expectations in the Dataset Context: MALDI favors
[M+H]+/[M+Na]+/[M+K]+; DESI negative often shows [M−H]−, [M+Cl]−,
[M+HCOO]−; ESI with buffers shows [M+NH4]+ or formate/acetate adducts.
