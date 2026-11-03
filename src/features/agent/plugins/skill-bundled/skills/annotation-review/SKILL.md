---
name: annotation-review
description: Review, compare or rank existing MSI annotations using engine evidence, candidate identity and biological plausibility. Includes descriptive pathway rollups when requested; use msi-analysis for de novo matching.
---

# Review existing annotations

Treat annotation rows as hypotheses. Read `get_page_state` once to confirm annotations, then `get_annotation_top(topN=10)` (maximum 20). If there are none, explain that a review needs annotation results; offer de novo matching only when that addresses the user's request.

Read `get_annotation_detail(rowIds=[...])` for the rows under scrutiny in one batch. Use `rowId` from the top listing: an m/z lookup returns only the best-ranked row on the nearest peak and can hide a competing row. Follow `nextOffset` with the same arrays to read further pages. Read an archived item with `read_archived_result(archiveId=...)` when essential evidence was shortened.

## Evaluate evidence

- Read actual score weights from the top-list header. `s` is total score, `m` mass error, `fit` acquisition/adduct plausibility, `ch` spatial coherence, `col` best sibling-image correlation, `q` target-decoy estimate. Missing scores are unavailable. A q-value is not the probability that a particular named isomer is correct.
- Same-formula siblings can corroborate an ion family. Competing same-peak rows, inconsistent sibling distributions, or a formula mismatch require explanation. Missing adducts alone do not disprove an identity.
- Inspect `get_annotation_images(rowIds=[...])` when spatial evidence affects the verdict. Coherent background or matrix patterns can also score highly. Cluster sizes cannot prove anatomical localization.
- `origin` orders candidate names as a prior; it is not spectral evidence. Check the displayed name and plausible alternative candidates, including isomers. Sum composition does not resolve fatty-acyl positions or stereochemistry.

## Target knowledge checks

Batch distinct names per relevant source, up to 25 inputs; default pages contain 5 queries, maximum 8. Do not repeat the same lookup per adduct.

Use `pubchem_compound_lookup(names=[...])` for named candidate identities; compare formula and exact mass with the annotation detail. Keep lipid shorthand and class evidence from the annotation result, and do not treat a sum composition as a unique structure. Use `hmdb_lookup(queries=[...])` for tissue/disease context and `chebi_lookup` when an ontology definition helps. Substring search results can be related compounds: verify the returned identity. A missing record means limited coverage, not absence from tissue.

For a set-wide review or pathway question, call `pathway_enrichment(topN=...)` (live official KEGG REST queries; no local KEGG index) once and inspect interesting pathways with `kegg_pathway_lookup`. Report **formula groups**, mapping coverage and alternatives: the rollup collapses isomers as well as adducts and may use any candidate in a group. Counts are descriptive, without a background model, significance test, or measurement of pathway activity. One group gives membership only; several groups give a tentative contextual pattern.

Report ambiguous KEGG matches and any candidates deferred by the query budget. An API/proxy failure means unavailable evidence, not an unmapped molecule; never request a local KEGG index build.

Retrieve `europepmc_search` evidence for decisive tissue-specific claims or surprising assignments. Cite only findings supported by returned text; a database name or paper title cannot confirm the measured species.

## Respond

State the ranking criterion and discuss the requested rows. A full review can use a compact table of rowId, m/z, candidate/adduct, engine evidence, knowledge check, and verdict (supported but putative / unresolved / conflicting evidence). Explain disagreements and candidate alternatives. Include a pathway section and coverage when a rollup was performed; do not imply checks you did not run. Recommend MS/MS, standards or isomer resolution for specific remaining uncertainty. Avoid fixed score cutoffs as universal identification rules.

## Inline source citations

For literature, database facts and other external evidence, place `[source title](URL)` immediately after the claim it supports. These HTTP(S) Markdown links render as shadcn-vue Inline Citation source cards. An optional short source excerpt can be supplied as `[source title](URL "short source excerpt")`; keep it on one line and escape double quotes. Use the exact title and URL returned by a tool. When only a retrieved PMID or DOI is available, link that exact identifier to `https://pubmed.ncbi.nlm.nih.gov/PMID/` or `https://doi.org/DOI`. Do not invent metadata or quotes, emit Vue/HTML components, or substitute bare URLs, PMID/DOI text, numbered markers or footnotes for the inline link. Multiple supporting sources use separate adjacent links. A search excerpt is not proof that the full paper was read.
