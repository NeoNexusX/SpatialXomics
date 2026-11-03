---
name: annotation-review
description: Review existing annotations with engine evidence plus chemical identity, tissue biology, and KEGG pathways; assess plausibility and report candidate pathway findings
whenToUse: When the user asks to review/check/rank annotations, assess whether annotated molecules are biologically plausible, or discover pathways represented by the current annotation table
---

# Annotation Review Workflow

Goal: treat the **existing annotation panel results as hypotheses**, then use
chemical, biological and pathway tools to test their plausibility and discover
pathways represented by the set. This is not a de novo m/z re-annotation
workflow and never ends with a bare "this is X".

## 1. Read the existing annotations

1. `get_page_state` — confirm annotation count > 0 and note polarity. If there
   are no annotations, ask the user to run the annotation panel first; do not
   replace this workflow with `library_mass_search` or other de novo matching.
2. `get_annotation_top` (topN up to 20). One row = one adduct ion; rows carry tokens:
   `#1 PC 34:1 [M+H]+ mz=760.5856 (+0.6ppm) s=0.94 q=0.4% m=0.97 fit=1.0 ch=0.95 col=0.91 sib=[M+Na]+,[M+K]+ samePeak=1`
   - `s` — total score = weighted sum of mass, adduct fit and spatial (higher = stronger). The user sets the weights in the annotation conditions (default 0.6×mass + 0.1×adduct fit + 0.3×spatial); the `get_annotation_top` header states the weights in use. Spatial = 0.2×chaos + 0.8×co-localization; co-localization counts only when r > 0.1, and uncomputed spatial scores count as 0.
   - `q` — target-decoy FDR q-value (smaller = more credible).
   - `m` — mass-error score (1 = exact, ~0.14 at the tolerance edge).
   - `fit` — how plausible this adduct is for the acquisition (ion source, matrix, solvent, polarity).
   - `ch` — spatial chaos (level-set measure; high = coherent structure, low = scattered noise). Present only for ions that got spatial scoring.
   - `col` — best Pearson between this ion's image and the images of the same molecule's other adducts. It only raises the spatial score.
   - `sib` — other adduct ions of the same molecule (each is its own row).
   - `samePeak` — number of other annotations explaining the same peak.
   - `origin` — provenance label of the named compound, from the annotation database's optional Origin column: `endo` (endogenous: detected in samples or in a metabolic pathway), `expected` (labelled endogenous, never detected), `exo` (drug, plant, food or synthetic). Absent = unknown or no labels. Candidates of a formula are listed endogenous first, so `exo` means every candidate is exogenous.
3. For every row you will discuss, call `get_annotation_detail(mzs=[...])` ONCE
   with all of them (batch array). Collect the displayed candidate AND competing
   same-peak candidates for the knowledge checks; checking only the displayed
   name would assume the answer under review.

## 2. Query chemical, biological and pathway evidence (required)

**Batch first**: collect names and make ONE call per source with arrays rather
than one call per molecule (`library_lookup(queries=[...])`,
`pubchem_compound_lookup(names=[...])`, `hmdb_lookup(queries=[...])`,
`kegg_pathway_lookup(queries=[...])`, `chebi_lookup(queries=[...])`). A failed
name does not block the rest. Do not claim a check that was not actually run.

1. **Chemical identity**: use `library_lookup` for lipid shorthand and
   `pubchem_compound_lookup` for general compounds/synonyms. Compare returned
   formula, exact mass and class with the annotation row and its candidates.
   Use `chebi_lookup` when a semantic role helps distinguish candidates. These
   calls verify the candidate's identity; they do not independently prove that
   the measured ion is that molecule.
2. **Biological context**: `hmdb_lookup(queries=[...])` for tissue localization,
   disease associations, biological function and KEGG id. Compare this evidence
   with the actual imaged tissue/sample context. ChEBI roles may supplement
   endogenous/xenobiotic interpretation.
3. **Pathway membership and discovery**:
   - `kegg_pathway_lookup(queries=[...])` for the candidates under discussion.
   - Call `pathway_enrichment(topN)` ONCE for the whole annotation set. It folds
     adduct ions by formula, maps annotated molecules to KEGG and ranks pathways
     by distinct-molecule count. Its counts are descriptive, NOT a statistical
     enrichment test.
   - For an interesting pathway, `kegg_pathway_lookup(<pathway>)` can list member
     compounds to look for additional annotated members. Report only molecules
     actually present in the annotation results.
4. **Literature only when needed**: for a surprising assignment or a decisive
   tissue-specific claim, use `europepmc_search("{molecule} {tissue}")` (or
   `openalex_search` for reviews) and cite PMID/DOI. Literature is supporting
   evidence, not a substitute for the chemical/biological/pathway checks above.

## 3. Judge plausibility by combining independent evidence

### Engine-evidence baseline
| Baseline | Criteria (all required unless noted) |
|---|---|
| **Strong** | q ≤ 5% AND ch ≥ 0.8 AND (a sibling with r ≥ 0.7, OR m ≥ 0.9 with fit ≥ 0.9) |
| **Moderate** | q ≤ 10–20% AND ch ≥ 0.6; or a sibling with r ≥ 0.7 even if q is higher |
| **Weak / mass-only** | no spatial score (ch absent) AND no sibling AND q > 10% |
| **Questionable** | samePeak > 0; or siblings exist but every r < 0.4; or ch < 0.5 |
| **Reject** | q ≥ 50% with no other evidence |

### Knowledge-evidence interpretation
- **Chemically consistent**: formula/mass/class and synonyms support the same
  candidate identity. A formula/class conflict is a concrete reason to prefer a
  competing candidate or downgrade the row. Database presence alone is not
  identification evidence.
- **Biologically consistent**: expected endogenous role and tissue/sample
  context fit the annotation. A drug/xenobiotic profile in an undosed tissue,
  or a disease association from an unrelated organ, is a contradiction to flag.
  No HMDB/tissue record means **insufficient coverage**, not evidence of absence.
- **Pathway coherence**: TWO OR MORE DISTINCT annotated molecules (not two
  adducts of one molecule) on the same pathway are set-level coherence evidence
  and a **candidate pathway finding**. One molecule means membership only.
  Common/large pathways are weaker evidence than a specific pathway with several
  members. Pathway agreement cannot rescue a row with contradictory mass,
  adduct or spatial evidence.
- **No pathway hit**: report "no pathway finding in the mapped annotations" and
  state mapping coverage/unmapped names. Do not conclude that the pathway is
  biologically absent, and do not call a descriptive count "significant" or
  statistically enriched.

Additional checks:
- **Same-peak ambiguity**: a classic case is [M+Na]⁺ of one lipid vs [M+H]⁺ of another (e.g. PC 34:1 [M+Na]⁺ and PC 36:4 [M+H]⁺ differ by 2.4 mDa). Prefer the explanation whose siblings co-localize and whose chemical/biological evidence fits; otherwise say MS/MS is needed.
- **Isomers**: one row may be a sum composition; multiple candidate names are isomers, not separate identifications. Never assign isomer-specific biology without isomer-resolving evidence.
- **Origin is a prior, not evidence**: it decides which candidate name is shown first and orders same-peak alternatives; it is not part of the total score or q. Prefer an endogenous name among isomers, and when a same-peak alternative is endogenous while the shown row is `exo`, mention it — but never upgrade or downgrade a verdict on origin alone.
- **Matrix/background peaks** can have high chaos (uniform coverage on and off tissue); check the ion image before calling them biological.
- **Pixel-size sanity**: any spatial claim needs the pixel size from the dataset context; features < 2× pixel size are noise.

## 4. Output template (use this structure)

```
## Annotation review (top N rows, sorted by total score)

| # | m/z | Candidate (putative) | Adduct | Engine evidence | Chemical / biological check | Verdict |
|---|-----|----------------------|--------|-----------------|-----------------------------|---------|
| 1 | 760.5856 | PC 34:1 | [M+H]+ | q=0.4%; ch=0.95; sibling r=0.91 | formula/class match; tissue context consistent | Supported, still putative |
| 2 | ... | ... | ... | ... | ... | ... |

### Plausibility findings
- <2–4 rows: combine engine + chemical + biological evidence; explain agreements AND conflicts>
- <same-peak alternatives and rows that remain uncertain; say what evidence is missing>

### Candidate pathway findings
| Pathway | Distinct annotated molecules | Evidence and interpretation |
|---|---|---|
| <KEGG pathway + map id> | <names/formulas, not adduct count> | <why relevant, or why only weak/descriptive evidence> |

Mapping coverage: <X/Y distinct annotated molecules mapped to KEGG>; unmapped: <...>.
<If no multi-molecule pathway: "No candidate pathway finding in the mapped annotations." Do not infer biological absence.>

### Caveats and next steps
All annotations remain putative (accurate-mass level unless MS/MS/standards confirm).
<Which assignments need on-tissue MS/MS, standards, or isomer-resolving evidence.>
```

Rules: cap the row table at 10–12 rows; always state the sort criterion (total
score descending); always include the pathway section and its mapping coverage;
separate observed tool results from interpretation; never silently convert a
missing database record into a negative verdict.
