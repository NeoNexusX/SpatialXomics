---
name: metabolite-biology
description: Interpret annotated metabolites in their tissue or disease context using identity, HMDB associations, KEGG membership and retrieved literature, then relate the verified molecules to each other. Work molecule-by-molecule first; do cross-molecule analysis only on verified identities. For mass-only candidate discovery use msi-analysis.
---

# Metabolite biology

Start with the candidate, formula, adduct and ambiguity from `get_annotation` windows / `get_annotation(rowIds=[...])`, or use the identity explicitly supplied by the user. Do not require a loaded dataset for a general molecule question. Use static tissue/acquisition metadata already available; do not invent tissue information.

## Stage 1 — Independent per-molecule analysis

Analyze EACH molecule on its own before any cross-molecule reasoning. For each, collect only the evidence the question needs:

1. **Identity**: `pubchem_compound_lookup(names=[...])` for formula/mass/identifiers, and `kegg_compound(ids=[...])` for KEGG identity — compare FORMULA/EXACT_MASS against the annotation row. Check returned identities: fuzzy name matches may be derivatives, and sum compositions cover isomer families. A verified C id beats a keyword hit; keyword rank is not identity.
2. **Context**: `hmdb_lookup(ids=[...])` for the archived official profile (taxonomy, roles, tissues, cell locations, pathways, normal concentrations, cross-references). Association is not causation or evidence of abundance in this sample. A missing snapshot or unreachable archive is limited coverage, not biological absence; relay failure returns links and explicitly says the profile was NOT read — never invent profile data. For names, `hmdb_lookup(queries=[...])` returns candidate ids with excerpts; review the candidates yourself and re-query by id — search relevance is not identity verification.
3. **Ontology**: `chebi_lookup` when "what role does this molecule have" matters (antioxidant, xenobiotic metabolite, …). Relevance-ranked results are not identity verification.
4. **Pathway membership**: `kegg_compound(ids=[...])` already returns each compound's PATHWAY links; use `kegg_pathway(ids=[...])` when a specific pathway's membership matters. Membership is targeted evidence, not enrichment or pathway activity.
5. **Literature**: `europepmc_search(query="molecule tissue", maxResults=3)` for tissue-specific claims or surprising assignments; a title is not evidence.

`kegg_find(query/queries=[...], db="compound"|"pathway")` locates ids by keyword (DBGET ANDs multi-word queries; per-query offset/limit windows). `kegg_mass_search(mz/mzs=[...], polarity=...)` is for supplied unknown m/z values: adduct-aware exact-mass matching over KEGG's ~19,000 small molecules, no lipids (use the annotation library or PubChem for lipids). All KEGG tools query the official REST API at runtime through the application's proxy; use the returned URLs for citations. If the API/proxy/network fails, state that KEGG evidence is unavailable for that attempt — do not interpret failure as biological absence and do not ask the user to build a local index.

Record a per-molecule verdict as you go: verified identity / putative identity (unresolved isomers) / conflicting evidence / insufficient evidence. Only verified or clearly-marked putative molecules proceed to Stage 2.

## Stage 2 — Cross-molecule analysis

Now relate the molecules that survived Stage 1, using the per-molecule evidence you already collected. There is no dedicated enrichment tool; do the association reasoning yourself and present it as descriptive, not statistical:

- **Shared pathways**: intersect the PATHWAY links collected in Stage 1 (kegg_compound returns them per compound). A pathway shared by ≥2 independent molecules is a coherent pattern worth reporting; state how many molecules map to it out of how many verified. This is a descriptive count — no background model, no p-values, no FDR, no claims of statistical enrichment or pathway activation. Use `kegg_pathway(ids=[...])` to check what else is in a pathway of interest.
- **Class-level patterns**: group by ChEBI role or HMDB taxonomy (chemical class) collected in Stage 1 — e.g. several phospholipids or several bile acids shifting together is class-level evidence even when individual isomers are unresolved.
- **Tissue/region correspondence**: HMDB tissue locations and cell locations (Stage 1) against the imaging regions where these ions localize (from `get_ion_image` evidence). Consistent tissue annotation is supporting, not decisive.
- **Concentration sanity**: HMDB normal concentrations give expected biofluid ranges; a measured claim wildly outside known ranges deserves a flag, but MSI is not quantitative without standards.
- **Literature**: `europepmc_search` for the joint pattern ("moleculeA moleculeB tissue") only when the co-occurrence claim is decisive for the answer; otherwise rely on the per-molecule literature already retrieved.

Cross-molecule conclusions inherit the weakest identity status among their members: a pattern built on unresolved isomers stays putative and isomer ambiguity remains explicit. For a defined statistical test, explain the need for a background set and an actual test rather than performing one implicitly.

`chebi_lookup` returns ontology labels/definitions, not a complete inferred biological-role graph. When HMDB/KEGG coverage is unavailable, `web_search` can discover external sources — state that this is web-source evidence rather than a completed HMDB/KEGG lookup, and retain the candidate identity uncertainty.

## Batch discipline

Batch distinct names once per relevant source (maximum 25 inputs; default 5 queries per page, maximum 8). Follow `nextOffset` with unchanged query arrays only for remaining items you need. Read archived evidence via `read_archived_result(archiveId=...)` rather than repeating the original lookup. Avoid querying every database automatically for a narrow question.

Respond with identity and uncertainty, the relevant tissue/function/pathway evidence, retrieved citations, and a verdict such as consistent / plausible / insufficient evidence. A drug in an undosed sample is a mismatch to investigate; unknown dosing is not proof of misannotation. Keep mass-only candidates putative and avoid isomer-specific claims without resolving data.

## Inline source citations

For literature, database facts and other external evidence, place `[source title](URL)` immediately after the claim it supports. These HTTP(S) Markdown links render as shadcn-vue Inline Citation source cards. An optional short source excerpt can be supplied as `[source title](URL "short source excerpt")`; keep it on one line and escape double quotes. Use the exact title and URL returned by a tool. When only a retrieved PMID or DOI is available, link that exact identifier to `https://pubmed.ncbi.nlm.nih.gov/PMID/` or `https://doi.org/DOI`. Do not invent metadata or quotes, emit Vue/HTML components, or substitute bare URLs, PMID/DOI text, numbered markers or footnotes for the inline link. Multiple supporting sources use separate adjacent links. A search excerpt is not proof that the full paper was read.
