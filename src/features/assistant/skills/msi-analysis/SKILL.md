---
name: msi-analysis
description: General MSI (Mass Spectrometry Imaging) analysis workflow — preprocessing, quality, annotation with adduct/ppm rules, reporting
whenToUse: When the user asks about analyzing MSI data, preprocessing methods, data quality, m/z annotation, or wants to interpret a whole dataset
---

# MSI Data Analysis Workflow

## 1. Data Understanding
- Static sample metadata (dimensions, data mode, pixel size, m/z range, analyzer, ion source, polarity) is already injected in the system prompt's "Dataset Context" section — treat it as known session knowledge, no need to re-query. Use `get_page_state` for dynamic state (selected ion, clustering selection, annotation count) instead.
- Continuous mode: every pixel carries a full spectrum — use `get_mean_spectrum_top_peaks` to find dominant ions.
- Polarity determines the adduct search space (see §5). MALDI vs DESI vs SIMS changes typical molecule coverage: MALDI favors lipids and peptides; DESI favors small metabolites and lipids without matrix; SIMS gives element/fragment images at sub-cellular resolution.

## 2. Preprocessing
Ordered pipeline and when each step matters:

| Step | Methods | Use when |
|---|---|---|
| Normalization | TIC, RMS (median), median, TIC-in-MSI | comparing regions/samples; uneven ion suppression |
| Baseline correction | SNIP, top-hat | low-m/z drift, MALDI matrix background |
| Smoothing | Savitzky-Golay (spectral), Gaussian (spatial) | noisy single-pixel spectra |
| Peak picking | centroid, matched filtering | profile → peak list; downstream statistics |
| Coregistration | landmark/feature-based | correlating with H&E or serial sections |

Caveats:
- TIC normalization assumes constant total ion flux — invalid when a dominant species varies hugely (tumor necrosis); prefer median normalization then.
- Never smooth before peak picking on quantification workflows (peak height bias).
- Report pixel size with every spatial claim — a "hot spot" smaller than 1–2 pixels is usually noise.

## 3. Ion Image & Statistics
- `get_ion_image_stats` for the selected m/z: max / mean / percentiles / non-zero ratio / hot-spot coordinates.
- S/N heuristic: max ÷ (mean of background region). > 3 = detectable, > 10 = quantifiable.
- Non-zero ratio interpretation: > 50% widely distributed (structural lipids, PC/SM); 10–50% regional; < 10% highly localized (candidate biomarker or drug).

## 4. Clustering
- `get_kmeans_summary`: k, per-cluster pixel counts, and the currently selected cluster ids — no spatial masks or per-pixel data. k is chosen on the workbench.
- Use k-means for exploratory segmentation; expect blobs, not anatomy. Biological claim needs follow-up (overlay H&E, ROI statistics).
- Clusters driven by a few extreme pixels usually indicate noise or dead-pixel artifacts — check cluster size vs image.

## 5. Annotation (m/z → molecule)

The core loop is short: **left annotation panel results as the basis → orchestrate the knowledge tools for biochemical & literature analysis**. The engine already did the mass matching, adduct plausibility, spatial scoring and FDR — the assistant's job is to confirm, contextualize, and discover beyond those scores.

### Step 1 — Read the annotation panel's results (the basis)

`get_page_state` (confirm annotation count > 0, note polarity) → `get_annotation_top` (topN up to 20).

One row = one adduct ion; the total score is a weighted sum `s = 0.6×mass + 0.1×adduct fit + 0.3×spatial` (the user can change these weights in the annotation conditions) (mass = Gaussian on the ppm error, fit = adduct plausibility under the acquisition, spatial = 0.2×chaos + 0.8×same-molecule co-localization; uncomputed spatial counts as 0), with target-decoy FDR q-values (decoys are impossible element adducts; q is re-estimated after spatial scoring finishes). Rows carry tokens like `#1 PC 34:1 [M+H]+ mz=760.5856 (+0.6ppm) s=0.94 q=0.4% m=0.97 fit=1.0 ch=0.95 col=0.91 sib=[M+Na]+,[M+K]+ samePeak=1`: `sib` = other adduct ions of the same molecule (each its own row), `col` = best image Pearson with them, `samePeak` = other annotations explaining the same peak. Cut at q ≤ 5–10%, prefer rows with ch ≥ 0.6 and co-localized siblings. For the rows you will report, `get_annotation_detail(mzs=[...])` (ONE batched call with all of them) gives the full breakdown (score decomposition, sibling ions with r, undetected enabled adducts, same-peak alternatives, candidates). Treat as candidates, not identifications.

If no library is loaded (annotation count = 0): de novo route — lipids via `library_mass_search(mzs=[...], polarity)`; non-lipid small metabolites via `hmdb_lookup(mzs=[...], polarity=...)` or `pubchem_formula_search`, then judge plausibility as a tissue molecule.

### Step 2 — Orchestrate the knowledge tools (the assistant's value-add)

For the molecules you will report, query the biochemical and literature sources and synthesize. **Batch first**: the lookup tools accept arrays — collect all names and query them in ONE call per source (`hmdb_lookup(queries=[...])`, `kegg_pathway_lookup(queries=[...])`, `chebi_lookup(queries=[...])`, `library_lookup(queries=[...])`, `pubchem_compound_lookup(names=[...])`) instead of one call per molecule; a failed name does not block the rest.

- **Identity cross-check**: `library_lookup` (shorthand → species, classification, exact mass) and `pubchem_compound_lookup` (synonyms, SMILES/InChIKey) verify the molecular identity; for a suspicious row or competing candidate, `library_mass_search(mzs=[...], polarity)` re-derives candidates independently.
- **Tissue & disease context**: `hmdb_lookup` — endogenous metabolites? Expected tissues, disease associations, biological function. A molecule whose HMDB tissue profile matches the imaged sample region strengthens the annotation.
- **Pathway discovery**: `kegg_pathway_lookup` — which metabolic pathways contain them? When SEVERAL top annotations fall on ONE pathway (glycolysis, TCA, phospholipid biosynthesis …), that is independent coherence evidence: report the pathway and its members to the user as a NEW finding ("the annotation set is enriched in pathway X — the spatial pattern of these ions likely maps that pathway's activity"). To test the whole set at once, call `pathway_enrichment(topN)` — it batch-maps the top annotations onto KEGG pathways and ranks them by molecule count. You can also query a pathway name via `kegg_pathway_lookup` to list its member compounds and check which ones appear in the annotations.
- **Biological role**: `chebi_lookup` — role terms (antioxidant, xenobiotic metabolite …) for the report's semantic layer.
- **Literature**: `europepmc_search` / `pubmed_search` ("{molecule} mass spectrometry imaging {tissue}") — has this molecule been imaged in this tissue/modality before? Prior imaging literature corroborates; absence is not counter-evidence but worth stating. Cite PMID/DOI.

The reverse direction also works: a suspicious row whose "identity" has no biochemical existence (no HMDB entry, no pathway, no literature in any tissue) drops in credibility.

### Step 3 — Report with discipline

Everything is putative: imaging-level annotation is never an identification — confirmation requires on-tissue MS/MS or standards (reporting practice: Balluff et al., *Histochem Cell Biol* 2011, doi:10.1007/s00418-011-0843-x). State the sort criterion (total score descending) and keep the verdict vocabulary of the annotation-review skill.

### Authoritative databases to cite / verify against
- **LIPID MAPS / LMSD** (https://www.lipidmaps.org) — lipid systematics, shorthand notation, calculated masses; queried offline by the `library_*` tools (deployed index).
- **PubChem** (https://pubchem.ncbi.nlm.nih.gov) — general compounds; the `pubchem_*` tools query it live.
- **HMDB** (https://hmdb.ca) — human metabolites, tissue/disease context (`hmdb_lookup`, offline index).
- **KEGG** (https://www.kegg.jp) — metabolic pathways (`kegg_pathway_lookup`, offline index).
- **ChEBI** (https://www.ebi.ac.uk/chebi) — biological role ontology (`chebi_lookup`, online).
- **METLIN / GNPS / LipidBlast / mzCloud** — MS/MS reference collections (not browser-callable; cite only, the platform has no MS/MS search tool).
MSI-specific: confirmation requires on-tissue MS/MS or standards — imaging-only annotation is "putative" (review & reporting practice: Balluff et al., *Histochem Cell Biol* 2011, doi:10.1007/s00418-011-0843-x).

### Recent key literature
- Kumar BS. *From tumors to neurons: mass spectrometry imaging in spatial lipidomics.* Anal Methods, doi:10.1039/d6ay00170j (PMID 42370410) — current landscape of MALDI/DESI/SIMS spatial lipidomics.
- *An analytical evaluation of tools for lipid isomer differentiation in imaging mass spectrometry.* Int J Mass Spectrom 2024 (PMID 40766833) — isomer/isobar resolution options.
- *MS-DIAL 5 multimodal mass spectrometry data mining unveils lipidome complexities.* Nat Commun 2024, doi:10.1038/s41467-024-54137-w — open-source data processing incl. lipid identification.
Search for newer work with `pubmed_search` before writing reports.

## 6. Literature grounding
Before claiming biological meaning, search `europepmc_search` (abstracts included) or `pubmed_search`, e.g. `"{molecule} mass spectrometry imaging {tissue}"`. Prefer reviews for mechanism claims (`openalex_search` finds them); cite PMID/DOI when writing reports.

## 7. Reporting (output template)
Include: dataset summary (instrument, dimensions, pixel size, m/z range, polarity) → preprocessing actually applied → key ions with m/z, annotation level (putative by mass / MS/MS confirmed), spatial pattern → clustering results → biological interpretation with literature (PMID) → limitations (mass resolution, pixel size, no MS/MS).

Structure the report as:

```
# MSI Analysis Report — <sample>

## 1. Dataset & preprocessing
<instrument, mode, dims × pixel size, polarity; steps actually applied>

## 2. Key ions & annotations (putative)
| m/z | Candidate | Adduct | Evidence (s, q, fit, ch/col) | Spatial pattern |
|---|---|---|---|---|

## 3. Spatial structure
<k-means / co-localized groups; 2–4 findings>

## 4. Biological interpretation
<per finding: molecule → tissue context (HMDB/KEGG) → literature (PMID)>

## 5. Limitations & next steps
<mass-only annotations, no MS/MS, pixel-size limits; what to confirm>
```
