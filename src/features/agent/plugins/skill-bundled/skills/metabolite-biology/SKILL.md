---
name: metabolite-biology
description: Interpret annotated metabolites in their tissue or disease context using identity, HMDB associations, KEGG membership and retrieved literature. For mass-only candidate discovery use msi-analysis.
---

# Metabolite biology

Start with the candidate, formula, adduct and ambiguity from `get_annotation_top` / `get_annotation_detail(rowIds=[...])`, or use the identity explicitly supplied by the user. Do not require a loaded dataset for a general molecule question. Use static tissue/acquisition metadata already available; do not invent tissue information.

Choose the sources needed for the question. `library_lookup(queries=[...])` verifies lipid shorthand and class; `pubchem_compound_lookup(names=[...])` supplies formula, mass and identifiers. Check the returned identity: fuzzy name matches may be derivatives or related compounds, and sum compositions cover isomer families.

`hmdb_lookup(queries=[...])` provides tissue/disease associations, functions and KEGG ids when the deployment contains its index. Association is not causation or evidence of the molecule's abundance in this sample. A lookup miss or missing index is limited coverage, not biological absence. For supplied unknown m/z values use adduct-aware matching only when acquisition polarity is known.

`kegg_pathway_lookup(queries=[...])` maps compounds or C ids to reference pathways, or pathway names to members. `pathway_enrichment(topN=...)` is useful for a set-wide question: report descriptive formula-group counts and mapping coverage. It may include alternative isomers and does not establish statistical enrichment, pathway activation or metabolic flux. `chebi_lookup` returns ontology labels/definitions, not a complete inferred biological-role graph.

For tissue-specific claims use `europepmc_search(query="molecule tissue", maxResults=3)`. Prefer exact molecule/tissue evidence; label class-level or other-organ findings as indirect. Do not infer a mechanism from a title, a pathway name or general database presence.

When a database index is unavailable or official resource documentation is needed, `web_search` can discover external sources. State that this is web-source evidence rather than a completed HMDB/KEGG lookup, and retain the candidate identity uncertainty.

Batch distinct names once per relevant source (maximum 25 inputs; default 5 queries per page, maximum 8). Follow `nextOffset` with unchanged query arrays only for remaining items you need. Read archived evidence via `read_archived_result(archiveId=...)` rather than repeating the original lookup. Avoid querying every database automatically for a narrow question.

Respond with identity and uncertainty, the relevant tissue/function/pathway evidence, retrieved citations, and a verdict such as consistent / plausible / insufficient evidence. A drug in an undosed sample is a mismatch to investigate; unknown dosing is not proof of misannotation. Keep mass-only candidates putative and avoid isomer-specific claims without resolving data.

## Inline source citations

For literature, database facts and other external evidence, place `[source title](URL)` immediately after the claim it supports. These HTTP(S) Markdown links render as shadcn-vue Inline Citation source cards. An optional short source excerpt can be supplied as `[source title](URL "short source excerpt")`; keep it on one line and escape double quotes. Use the exact title and URL returned by a tool. When only a retrieved PMID or DOI is available, link that exact identifier to `https://pubmed.ncbi.nlm.nih.gov/PMID/` or `https://doi.org/DOI`. Do not invent metadata or quotes, emit Vue/HTML components, or substitute bare URLs, PMID/DOI text, numbered markers or footnotes for the inline link. Multiple supporting sources use separate adjacent links. A search excerpt is not proof that the full paper was read.
