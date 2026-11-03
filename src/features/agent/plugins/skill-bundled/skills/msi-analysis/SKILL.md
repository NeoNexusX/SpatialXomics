---
name: msi-analysis
description: Analyze a loaded MSI dataset, assess data quality, or write an analysis report using page evidence, annotations and targeted knowledge queries. For a single ion or annotation review, load the corresponding focused skill.
---

# MSI analysis

Use static metadata already in Dataset Context. Call `get_page_state` once when the request depends on the current selection or annotation results; reuse that state within the turn unless the data changes. These tools read data and render images; they do not run preprocessing, change annotations, or perform new clustering.

## Choose the next evidence

- Dataset summary: use injected instrument, polarity, dimensions, pixel size and mass range. Call `get_dataset_overview` only to verify missing or disputed metadata.
- Quality or dominant ions: `get_mean_spectrum_top_peaks(topN=10, mzMin=..., mzMax=...)` reads the continuous-mode mean spectrum. Omit bounds unless needed. A processed dataset may expose TIC without extractable ion images.
- Spatial questions: `get_ion_image` returns an image and statistics. For comparison, `get_ion_images(mzs=[...], normalize="shared")` uses a common display range; use at most 4 separate panels or a montage for up to 9 ions. `get_ion_image_stats` accepts up to 6 ions when an image is unnecessary. Raster hotspots are zero-based; `get_pixel_spectrum(x=..., y=...)` uses one-based acquisition coordinates. Do not interchange them without a coordinate mapping.
- Segmentation: `get_kmeans_summary` gives sizes and selected ids; `get_umap_summary` gives overlay status. Neither exposes cluster masks, anatomical labels, or quantitative inter-ion correlation.

## Annotations and identity

If annotations exist, start with `get_annotation_top(topN=10)`. One row is one adduct ion. Its header gives the actual score weights. Tokens include total score `s`, target-decoy `q`, mass score `m`, acquisition fit `fit`, spatial coherence `ch`, and same-formula sibling correlation `col`. Missing spatial scores or q-values mean unavailable evidence. The same formula can have multiple isomer candidates.

Read `get_annotation_detail(rowIds=[...])` for rows you will discuss; ids come from the top listing. An m/z query selects the best-ranked row on the nearest peak, so use row ids to investigate a particular competing assignment. Load `annotation-review` for a full review, or `adduct-isotope-analysis` for an adduct question.

When there are no annotations, report that fact. If de novo matching is requested, use `library_mass_search(mzs=[...], polarity=...)` for lipids or `hmdb_lookup(mzs=[...], polarity=...)` for other metabolites. Use acquisition polarity; ask for it if unavailable. `pubchem_formula_search` requires an existing molecular formula and cannot infer one from m/z. Accurate mass and database presence establish candidates, not unique identities.

## Biology and efficient lookup

Choose sources that answer the user's question: `library_lookup` for lipid identity; `pubchem_compound_lookup` for general compound properties; `hmdb_lookup` for tissue associations; `kegg_pathway_lookup` for pathways; `chebi_lookup` for ontology definitions. Collect distinct names and send arrays in one call per relevant source. Lookup batches accept up to 25 inputs and return pages: default 5, at most 8 queries per page. Follow `nextOffset` with the same arrays only when remaining items matter. Use `read_archived_result(archiveId=..., offset=...)` for a complete archived item; reloading the original query does not recover its truncated part.

`pathway_enrichment(topN=...)` reports descriptive formula-group counts, not statistical enrichment. It folds adduct rows by formula and may map several alternative isomers. Report mapping coverage, unresolved candidates and unmapped names. Shared pathway membership does not measure pathway activity or independently validate the ion assignments. Database misses may reflect coverage or shorthand names.

For a biological claim, retrieve supporting literature with `europepmc_search(query=..., maxResults=3)`; load `literature-evidence` for a literature-focused task. PubMed/OpenAlex metadata alone cannot substantiate a detailed mechanism. Cite only retrieved supporting text and distinguish tissue-specific observations from general background.

For current methods documentation, database instructions or broader source discovery, use `web_search` (Exa); load `web-research` when the task centers on finding web sources. Search public method/molecule descriptions, not private sample data, and cite only the retrieved sources.

## Quality and reporting

Separate observations from interpretations. A nonzero-pixel mean is not a background estimate or signal-to-noise measurement. Nonzero fraction depends on acquisition, processing and masking; it is not a biomarker classifier. Compare images for matrix edges, isolated hot pixels, gradients and common background patterns. Subpixel features are not resolved anatomy. Do not infer anatomy from cluster colors alone.

Describe preprocessing only if its execution is recorded. Recommendations depend on data mode, noise, spatial resolution and the question; explain the reason and avoid claiming a fixed pipeline has already run.

For a report include dataset and recorded preprocessing, key ions with candidate/adduct and observed evidence, spatial structure, targeted biological interpretation with retrieved sources, and limits/confirmation needs. For a narrow request return only the relevant findings. Accurate-mass annotations remain putative; isomer-specific claims require resolving evidence such as MS/MS or standards.

## Inline source citations

For literature, database facts and other external evidence, place `[source title](URL)` immediately after the claim it supports. These HTTP(S) Markdown links render as shadcn-vue Inline Citation source cards. An optional short source excerpt can be supplied as `[source title](URL "short source excerpt")`; keep it on one line and escape double quotes. Use the exact title and URL returned by a tool. When only a retrieved PMID or DOI is available, link that exact identifier to `https://pubmed.ncbi.nlm.nih.gov/PMID/` or `https://doi.org/DOI`. Do not invent metadata or quotes, emit Vue/HTML components, or substitute bare URLs, PMID/DOI text, numbered markers or footnotes for the inline link. Multiple supporting sources use separate adjacent links. A search excerpt is not proof that the full paper was read.
