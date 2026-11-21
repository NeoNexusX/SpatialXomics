---
name: ion-image-interpretation
description: Interpret a selected or specified MSI ion image, compare spatial distributions, and distinguish observed patterns from artifacts and tentative biology. For a full dataset report use msi-analysis.
---

# Interpret ion images

Read `get_page` when the question depends on the current selection (its ion block carries the display parameters, spectrum area, channels and ROI state). Use `get_ion_image_by_mzs(mzs=[...])` to obtain images and statistics for specified m/z values. `get_ion` returns the selected-ion view and re-renders the image with the user's current display parameters (not a canvas screenshot: ROI highlights, channel blending and overlays are not in the image). Processed data can return TIC through `get_ion`; never describe TIC as a molecule-specific map.

For comparisons use `get_ion_image_by_mzs(mzs=[...])`: at most 4 separate images, or a 2-column montage of up to 9. **Batch 6 targets per call** — 4 fills the separate-image limit and 6 fills the montage evenly; odd counts and larger batches leave a ragged grid. `get_ion_image_by_rowIds(rowIds=[...])` preserves annotation labels (rows sharing an observed m/z are grouped) and takes the same batch of 6. Both tools fix display to p99 and use a shared range for visual intensity comparison. State the fixed display range when relevant. Reuse image statistics; a second stats call is unnecessary unless requesting other ions.

## Spatial evidence

- Hotspots use zero-based raster x/y; explicit `get_pixel_spectrum(x=..., y=...)` uses one-based acquisition coordinates (peaks are paged by offset/limit, default rank 1-10; withImage attaches a full-spectrum stick plot per pixel with the window peaks highlighted). Do not convert without a known mapping, especially on sparse grids.
- `mean` is the nonzero-pixel mean. Percentiles are sampled across the raster. Nonzero fraction and hotspots describe coverage/intensity; they do not determine molecule class, S/N, quantification limits, or biomarker status.
- Look for region boundaries, gradients, edge accumulation and isolated bright pixels. Matrix spray, tissue damage, ion suppression and biology can produce similar patterns. Compare relevant control ions or an optical reference only if available; do not claim you inspected an unavailable optical image.
- Pixel size bounds spatial claims. Clustering colors are not anatomy. `get_kmeans` provides clusters with counts and selection plus the overlay image, not masks or pixel-to-cluster membership. Hotspot overlap alone is not a Pearson correlation. Annotation `coloc` and sibling `r` provide computed correlation for those ion pairs only.

## Identity and biology

If annotations exist, read the relevant `get_annotation(rowIds=[...])`; use exact row ids from a `get_annotation` window to retain competing assignments. For de novo lipid matching, ask the user to run the annotation panel against an appropriate database. `kegg_mass_search(mz=..., adduct="[M+H]+")` can supply KEGG small-molecule candidates for one peak. Select an adduct consistent with the acquisition polarity. `pubchem_formula_search` needs a molecular formula, not m/z. A mass window or lipid shorthand cannot identify a unique isomer.

Use targeted identity/context lookups and `europepmc_search` for biological claims, with keywords you build from the claim being checked (molecule, tissue/region, modality, observed pattern), falling back to `pubmed_search` then `web_search` on error or zero hits. Batch names per relevant source and follow page/archive pointers only when necessary. Database presence, pathway membership and literature about a candidate do not prove the measured ion's identity or pathway activity.

Lead with the observed spatial pattern, then candidate identity, supported biological context, and the specific uncertainty. Report m/z/adduct, pixel size if known, display settings that affect comparison, and retrieved citations. Do not assign anatomy or mechanism without supporting evidence.

## Inline source citations

For literature, database facts and other external evidence, place `[source title](URL)` immediately after the claim it supports. These HTTP(S) Markdown links render as shadcn-vue Inline Citation source cards. An optional short source excerpt can be supplied as `[source title](URL "short source excerpt")`; keep it on one line and escape double quotes. Use the exact title and URL returned by a tool. When only a retrieved PMID or DOI is available, link that exact identifier to `https://pubmed.ncbi.nlm.nih.gov/PMID/` or `https://doi.org/DOI`. Do not invent metadata or quotes, emit Vue/HTML components, or substitute bare URLs, PMID/DOI text, numbered markers or footnotes for the inline link. Multiple supporting sources use separate adjacent links. A search excerpt is not proof that the full paper was read.
