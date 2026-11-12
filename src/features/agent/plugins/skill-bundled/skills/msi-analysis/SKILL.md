---
name: msi-analysis
description: Analyze a loaded MSI dataset, assess data quality, or write an analysis report using page evidence, annotations and targeted knowledge queries. For a single ion or annotation review, load the corresponding focused skill.
---

# MSI analysis

Use static metadata already in Dataset Context. Call `get_page` once when the request depends on the current selection or annotation results; reuse that snapshot within the turn unless the data changes. Its annotation block is a fixed rank 1-10 preview — page deeper windows with `get_annotation(offset=..., limit=...)`. These tools read data and render images; they do not run preprocessing, change annotations, or perform new clustering.

## Choose the next evidence

- Dataset summary: use injected instrument, polarity, dimensions, pixel size and mass range. Call `get_dataset` for the full dataset info panel JSON (attrs, acquisition, source file, methods, display range); use it only when the injected summary or the page snapshot is not enough.
- Quality or dominant ions: `get_mean_spectrum_top_peaks(offset=..., limit=..., mzMin=..., mzMax=...)` reads the continuous-mode mean spectrum, ranked by descending intensity and paged by a zero-based window (default rank 1-10; offset reaches any rank). Omit bounds unless needed. A processed dataset may expose TIC without extractable ion images.
- Spatial questions: `get_ion_image` returns an image and statistics for the selected ion, a single mz, up to 9 mzs, or annotation rowIds — the three selectors are mutually exclusive. Shared display range by default for comparison; at most 4 separate panels, otherwise a montage. Raster hotspots are zero-based; `get_pixel_spectrum(x=..., y=..., offset=..., limit=...)` uses one-based acquisition coordinates and attaches a full-spectrum stick plot per pixel (window peaks highlighted). Do not interchange them without a coordinate mapping.
- Selected-ion detail (display parameters, spectrum area, channels, ROI): `get_ion` re-renders the current ion with the user's real display parameters and reports the full ion view. Arbitrary-ion statistics without an image: `get_ion_image(mzs=[...])` returns per-target stats summaries.
- Segmentation: `get_kmeans` gives clusters with colors and selected ids plus the overlay image; `get_umap` gives overlay status plus its image. Neither exposes anatomical labels or quantitative inter-ion correlation.

## Annotations and identity

If annotations exist, start with `get_annotation` (default window: rank 1-10; `offset`/`limit` page to any rank, e.g. rank 20-30 = offset 19 + limit 11). One row is one adduct ion. Rows are full JSON: total score `totalScore`, target-decoy `q`, mass score `massScore`, `adductFit`, spatial `spatialScore` (chaos + co-localization), sibling adducts. Missing spatial scores or q-values mean unavailable evidence. The same formula can have multiple isomer candidates. The panel header reports the current filters and the visible row count; the window itself always pages the FULL result set, independent of the table filters.

Read exact rows with `get_annotation(rowIds=[...])` or `get_annotation(mzs=[...])` for rows you will discuss; exact selectors conflict with offset/limit. An m/z query selects the best-ranked row on the nearest peak, so use row ids to investigate a particular competing assignment. Load `annotation-review` for a full review, or `adduct-isotope-analysis` for an adduct question.

When there are no annotations, report that fact. For de novo matching against a lipid or user-supplied database, ask the user to run the annotation panel, then inspect its candidate rows. `kegg_mass_search(mz/mzs=[...], polarity=...)` can supply small-molecule candidates against KEGG compound (~19,000 entries; no lipids); state its coverage limits. Use acquisition polarity; ask for it if unavailable. `pubchem_formula_search` requires an existing molecular formula and cannot infer one from m/z. Accurate mass and database presence establish candidates, not unique identities.

## Biology and efficient lookup

Choose sources that answer the user's question: `pubchem_compound_lookup` for named compound properties; `hmdb_lookup` for archived tissue/disease profiles (by HMDB id); `kegg_find`/`kegg_compound`/`kegg_pathway` for KEGG evidence; `chebi_lookup` for ontology definitions. Preserve lipid shorthand/class evidence from annotation rows rather than treating a sum composition as a unique PubChem identity. Collect distinct names and send arrays in one call per relevant source. Lookup batches accept up to 25 inputs and return pages: default 5, at most 8 queries per page. Follow `nextOffset` with the same arrays only when remaining items matter. Use `read_archived_result(archiveId=..., offset=...)` for a complete archived item; reloading the original query does not recover its truncated part.

Report ambiguous KEGG matches. An API/proxy failure means unavailable evidence, not an unmapped molecule; never request a local KEGG index build.

For a biological claim, retrieve supporting literature with `europepmc_search(query=..., maxResults=3)`; load `literature-evidence` for a literature-focused task. PubMed/OpenAlex metadata alone cannot substantiate a detailed mechanism. Cite only retrieved supporting text and distinguish tissue-specific observations from general background.

For current methods documentation, database instructions or broader source discovery, use `web_search` (Exa); load `web-research` when the task centers on finding web sources. Search public method/molecule descriptions, not private sample data, and cite only the retrieved sources.

## Quality and reporting

Separate observations from interpretations. A nonzero-pixel mean is not a background estimate or signal-to-noise measurement. Nonzero fraction depends on acquisition, processing and masking; it is not a biomarker classifier. Compare images for matrix edges, isolated hot pixels, gradients and common background patterns. Subpixel features are not resolved anatomy. Do not infer anatomy from cluster colors alone.

Describe preprocessing only if its execution is recorded. Recommendations depend on data mode, noise, spatial resolution and the question; explain the reason and avoid claiming a fixed pipeline has already run.

For a report include dataset and recorded preprocessing, key ions with candidate/adduct and observed evidence, spatial structure, targeted biological interpretation with retrieved sources, and limits/confirmation needs. For a narrow request return only the relevant findings. Accurate-mass annotations remain putative; isomer-specific claims require resolving evidence such as MS/MS or standards.

## Inline source citations

For literature, database facts and other external evidence, place `[source title](URL)` immediately after the claim it supports. These HTTP(S) Markdown links render as shadcn-vue Inline Citation source cards. An optional short source excerpt can be supplied as `[source title](URL "short source excerpt")`; keep it on one line and escape double quotes. Use the exact title and URL returned by a tool. When only a retrieved PMID or DOI is available, link that exact identifier to `https://pubmed.ncbi.nlm.nih.gov/PMID/` or `https://doi.org/DOI`. Do not invent metadata or quotes, emit Vue/HTML components, or substitute bare URLs, PMID/DOI text, numbered markers or footnotes for the inline link. Multiple supporting sources use separate adjacent links. A search excerpt is not proof that the full paper was read.
