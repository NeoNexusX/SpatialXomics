---
name: ion-image-interpretation
description: Interpreting individual ion images — spatial patterns, artifacts vs biology, co-localization, and literature-grounded significance
whenToUse: When the user asks about a specific ion image, its spatial distribution, hot spots, or what an ion image reveals biologically
---

# Ion Image Interpretation Guide

## 1. What an Ion Image Is
A 2D map of one m/z bin's intensity across the tissue (one pixel = one acquired spectrum at that location). Read `get_page_state` / `get_ion_image_stats` for the numbers; interpretation below.

Key statistics:
- **Max / hot-spot coordinates**: brightest pixel(s). Coordinates locate the region — cross-check against anatomy or the optical image.
- **Percentiles p50/p90/p99**: p99 ≈ top-1% cutoff. Large p90→p99 gap = a few extreme pixels (check if they cluster spatially or are isolated noise).
- **Non-zero ratio**: > 50% ubiquitous (structural lipids PC, SM, PE); 10–50% regional; < 10% focal (candidate biomarker, drug, or artifact — see §3).

## 2. Biological Patterns vs Artifacts
Before biology, exclude artifacts:

| Pattern | Could be biology | Could be artifact |
|---|---|---|
| Sharp region-boundary alignment | tissue types, tumor margin | matrix spray edge, tissue edge |
| Speckled bright dots | secretory structures | matrix crystals (MALDI), hot pixels |
| Edge-only intensity | tissue rim physiology | delocalization / matrix accumulation at edges |
| Smooth global gradient | metabolic zonation (liver), polarity of organ | uneven matrix/spray, ion suppression gradient |
| Ring around a hole | necrosis rim, penumbra | tissue tear, fold, dried drop |

Artifact tells: patterns that follow the **spray/matrix direction**, coincide with the **optical image's damaged areas**, or appear at identical shapes for unrelated m/z values (check 2–3 random m/z as "blank" controls — same pattern ⇒ instrument/artifact, not this ion).

Physical limits: MALDI matrix crystals spread analyte by ~10–50 µm; features smaller than ~2× pixel size are not resolvable; diffusion during DESI solvent flow smears sharp boundaries.

## 3. Common Ion Classes (m/z ballparks)
- **Phospholipids 600–900** (PC, PE, SM, PI, PS): ubiquitous membranes; regional differences track tissue composition — e.g. gray vs white matter in brain (PC-rich vs galactolipid-rich).
- **Triacylglycerols 800–1000**: adipose, steatosis, necrotic cores (dying cells accumulate neutral lipids).
- **Fatty acids 200–400** & **acylcarnitines 400–600**: metabolism; elevated in energetically stressed / hypoxic regions.
- **Ceramides / sphingolipids 500–900**: apoptosis, stress response.
- **Metabolites 100–600** (amino acids, nucleotides, organic acids): high turnover; often poor MALDI ionization without matrix optimization.
- **Drugs / metabolites 200–800**: exogenous — match dosed compound's exact mass + fragments; localization in target organ or clearance path.
Metal-adduct preference hints at local salt/K⁺-rich necrosis (more [M+K]+).

## 4. Workflow for a Single Ion
1. Stats first (`get_ion_image_stats`): distribution class (§1), hot spots.
2. Annotate the m/z (see the msi-analysis skill §5): for lipids call `library_mass_search(mz, polarity)` first — adduct-aware, full LMSD; for non-lipids use `hmdb_lookup(mz=..., polarity=...)` / `pubchem_formula_search` / `pubchem_compound_lookup` (all lookup tools accept arrays for several names/m/z at once). Remember sum-composition annotations are composite over isomers. If platform annotations exist, `get_annotation_detail(mzs=[...])` (batched when checking several rows) gives the full evidence (score breakdown, same-molecule sibling ions with r, undetected enabled adducts, same-peak alternatives, candidates) per row.
3. Visual pattern: apply §2 artifact checklist against the optical image.
4. Co-localization: compare with other annotated ions and k-means clusters (`get_kmeans_summary` returns only cluster sizes and the current selection — pixel-level Pearson correlation is not computable from tool output; infer co-localization from hot-spot coordinates and cluster membership, or ask the user to compare overlays visually). Co-localized lipid sets support a real tissue domain. Multi-adduct rows with `ar ≥ 0.7` are a built-in co-localization signal for the same molecule.
5. Biology grounded in literature: `europepmc_search("{molecule} mass spectrometry imaging {tissue}")` — has this molecule been imaged in this tissue? What did it mark? Cite PMID in the answer.
6. State confidence explicitly: "putative annotation by accurate mass only" vs literature-corroborated.

## 5. Answering the User
Lead with the spatial observation, then identity, then biology, then caveat. Example shape: "The ion at m/z 760.58 (putative PC 34:1 [M+H]+) concentrates in region X (~coordinates), consistent with {literature finding}; MS/MS confirmation would be needed."

## 6. Reference Resources
- LIPID MAPS (https://www.lipidmaps.org) — lipid shorthand, classes, exact masses (`library_lookup` / `library_mass_search` tools, offline LMSD index)
- PubChem (https://pubchem.ncbi.nlm.nih.gov) — compound identity (`pubchem_compound_lookup`, `pubchem_formula_search` tools)
- Europe PMC / PubMed — literature grounding (`europepmc_search` with abstracts, `pubmed_search`)
- HMDB (https://hmdb.ca) — tissue/disease context (`hmdb_lookup`); KEGG — pathways (`kegg_pathway_lookup`); ChEBI — biological roles (`chebi_lookup`)
- METLIN (https://metlin.scripps.edu), MassBank (https://massbank.eu), GNPS (https://gnps.ucsd.edu) — metabolite/spectra databases (reference only; no browser-callable tool)
- MALDI-MSI methodology & reporting review: Balluff et al., *Histochem Cell Biol* 2011, doi:10.1007/s00418-011-0843-x
- Recent: Kumar BS, *From tumors to neurons: mass spectrometry imaging in spatial lipidomics*, Anal Methods, doi:10.1039/d6ay00170j; lipid isomer differentiation in IMS, *Int J Mass Spectrom* 2024, PMID 40766833
