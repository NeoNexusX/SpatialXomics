---
name: report-writing
description: Compose the final structured MSI analysis report from already-collected evidence, with inline citations and explicit uncertainty. Load when the user asks for a written report or summary of a finished analysis.
---

# Write the analysis report

You are organizing evidence ALREADY collected in this conversation; do not start a new investigation. If key pieces are missing (no dataset context, no annotation evidence, no biological checks), fetch only those missing pieces or state the gap explicitly.

## Before writing

Assemble what the conversation already holds:

- Dataset identity and acquisition: dataset name, instrument, polarity, matrix (if recorded), mass range, pixel size, spatial dimensions, preprocessing actually recorded. `get_page` / `get_dataset` / injected Dataset Context.
- Key ions and annotations: the rows actually discussed (m/z, adduct, candidate, engine evidence, your verdict).
- Spatial observations: ion image patterns, KMeans/UMAP segmentation, pixel spectra — with the display settings that affected them.
- External evidence: HMDB/KEGG/PubChem/ChEBI facts and literature retrieved with their URLs.
- Your per-molecule verdicts and the reasons, including unresolved isomers.

## Structure

Use this section skeleton; drop a section only when it genuinely has no content, and say why it is dropped in one sentence:

1. **Overview** — dataset, acquisition conditions, preprocessing actually performed, scope of the analysis, what question was asked.
2. **Key ions and annotations** — table of the discussed rows: m/z | candidate | adduct | engine evidence (score components, q) | external verification | verdict. Verdict vocabulary: supported (putative) / unresolved isomer / conflicting evidence / insufficient evidence.
3. **Spatial findings** — observed distributions per ion or ion group, spatial relationships (co-localization, mutual exclusion), segmentation results; distinguish observation from interpretation; note display settings that affect comparison.
4. **Biological interpretation** — per-molecule context (identity, class, known tissue/disease associations), then cross-molecule patterns (shared pathways, coherent class-level shifts, tissue-region correspondence). Association is not causation; database presence is not abundance in this sample.
5. **Uncertainty and follow-up** — unresolved identities and what evidence would resolve them (MS/MS, standards, isomer-resolving acquisition), coverage gaps (unmapped m/z, lipids outside KEGG), failed or unavailable evidence sources, recommended next steps.

## Writing rules

- Write in the user's language. Define abbreviations on first use.
- Every external claim carries an inline citation `[source title](URL)` from a tool result in this conversation; never cite from memory.
- Mark each annotation's status honestly: accurate-mass annotations stay putative; a q-value is not the probability the name is correct; do not make isomer-specific claims without resolving evidence.
- Separate what was measured from what was inferred from databases.
- Do not over-claim: no pathway activation/flux claims from membership counts, no anatomy claims beyond image evidence, no biomarker claims.
- Keep it readable: prefer tables for row lists, short paragraphs for findings; the report is for the user, not for the model.

## Inline source citations

For literature, database facts and other external evidence, place `[source title](URL)` immediately after the claim it supports. These HTTP(S) Markdown links render as shadcn-vue Inline Citation source cards. An optional short source excerpt can be supplied as `[source title](URL "short source excerpt")`; keep it on one line and escape double quotes. Use the exact title and URL returned by a tool. When only a retrieved PMID or DOI is available, link that exact identifier to `https://pubmed.ncbi.nlm.nih.gov/PMID/` or `https://doi.org/DOI`. Do not invent metadata or quotes, emit Vue/HTML components, or substitute bare URLs, PMID/DOI text, numbered markers or footnotes for the inline link. Multiple supporting sources use separate adjacent links. A search excerpt is not proof that the full paper was read.
