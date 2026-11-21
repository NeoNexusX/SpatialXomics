---
name: report-writing
description: Write the final structured MSI analysis report after the annotation scan, independent candidate assessments and association analysis are complete. Load it once an annotation-review or msi-analysis pass has finished judging its molecules; organize collected evidence and make gaps explicit.
---

# Write the analysis report

This skill closes an annotation pass. Load/call it after `annotation-review` or `msi-analysis` has scanned its rows, given each molecule an independent verdict and completed the association analysis. It organizes evidence ALREADY collected; do not restart broad annotation or biological investigation. If an essential report field is missing, fetch only that missing evidence or state the gap explicitly. Never imply unscanned rows or unchecked sources were reviewed.

## Before writing

Assemble what the conversation already holds:

- Dataset identity and acquisition: dataset name, instrument, polarity, matrix (if recorded), mass range, pixel size, spatial dimensions, preprocessing actually recorded. `get_page` / `get_dataset` / injected Dataset Context.
- Key ions and annotations: the rows actually discussed (m/z, adduct, candidate, engine evidence, your verdict).
- Spatial observations: ion image patterns, KMeans/UMAP segmentation, pixel spectra — with the display settings that affected them.
- External evidence: HMDB/KEGG/PubChem/ChEBI facts and literature retrieved with their URLs.
- Candidate verdicts and uncertainty from the independent per-molecule analysis, using the verdict set defined by the analysis skill (`supported but putative` / `conflicting evidence` / `insufficient evidence` / `unsupported`) plus the resolution level (composition / class / isomer). Include each molecule once even if several adduct rows support it. Record the row/rank range scanned and how many distinct molecules were judged — putative molecules count toward that total; the target is ten judged molecules, not ten fully resolved ones. Unresolved isomers, low intensity and unavailable database coverage are limitations to record, not verdict downgrades.

## Report-template catalog

This skill provides shared report-writing rules plus a catalog of report-specific templates. Select a template by its exact namespaced ID; do not confuse a report template with an analysis skill of a similar name. At present, only one template is available:

- **`report-template:annotation-review`** — a full MSI annotation-review report closing an `annotation-review` or `msi-analysis` pass. This is the only currently available report template; do not imply other report types are already implemented. For a future report type, add a separate catalog entry with its own purpose and scaffold while reusing the shared rules below. This prompt-level catalog is not a runtime-validated registry.

Load the template with the `skill` tool's `resourceId` argument:

- `report-template:annotation-review:en` (`references/report-templates/annotation-review.en.md`)

This is the only template resource; there is no translated variant to choose between. The scaffold is written in English, but **the report itself is written in the user's language** — translate the section headings and prose, and keep molecule names, formulas, adduct labels and shorthand unchanged. Do not load unrelated resources. The selected resource is a fillable scaffold, not a rigid output schema. Do not preserve unused placeholders. If a whole section has no applicable evidence, retain its heading and briefly state why information is unavailable. Include only metadata that is actually recorded; mark important missing fields as unavailable rather than guessing.

## Standards-informed reporting

Use reporting standards as context for completeness and confidence communication, not as a substitute for the project's independent LLM verdicts or as a rigid checklist when the underlying metadata were not recorded:

- The Metabolomics Standards Initiative (MSI) chemical-analysis recommendations provide a framework for communicating metabolite identification confidence and supporting evidence ([Sumner et al., 2007](https://doi.org/10.1007/s11306-007-0082-2)).
- MSI data-analysis recommendations inform transparent reporting of preprocessing and analysis methods ([Goodacre et al., 2007](https://doi.org/10.1007/s11306-007-0081-3)).
- Schymanski et al. describe a separate HRMS confidence framework ([2014](https://doi.org/10.1021/es5002105)); do not equate its levels with MSI identification categories or silently assign a formal level without the required evidence.
- mQACC provides complementary community guidance on quality assurance and control ([2021](https://doi.org/10.1007/s11306-020-01756-z)). Report QC design/results only when available. imzML is an imaging-data format/interoperability standard, not by itself an experimental reporting checklist ([imzML](https://www.imzml.org/); [Römpp et al., 2012](https://doi.org/10.1016/j.jprot.2012.07.026)).

## Writing rules

- Write in the user's language. Define abbreviations on first use.
- Every external claim carries an inline citation `[source title](URL)` from a tool result in this conversation; never cite from memory.
- Mark each annotation's status honestly: accurate-mass annotations stay putative; a q-value is not the probability the name is correct; do not make isomer-specific claims without resolving evidence.
- Separate what was measured from what was inferred from databases.
- Do not over-claim: no pathway activation/flux claims from membership counts, no anatomy claims beyond image evidence, no biomarker claims.
- Keep it readable: prefer tables for row lists, short paragraphs for findings; the report is for the user, not for the model.

## Inline source citations

For literature, database facts and other external evidence, place `[source title](URL)` immediately after the claim it supports. These HTTP(S) Markdown links render as shadcn-vue Inline Citation source cards. An optional short source excerpt can be supplied as `[source title](URL "short source excerpt")`; keep it on one line and escape double quotes. Use the exact title and URL returned by a tool. When only a retrieved PMID or DOI is available, link that exact identifier to `https://pubmed.ncbi.nlm.nih.gov/PMID/` or `https://doi.org/DOI`. Do not invent metadata or quotes, emit Vue/HTML components, or substitute bare URLs, PMID/DOI text, numbered markers or footnotes for the inline link. Multiple supporting sources use separate adjacent links. A search excerpt is not proof that the full paper was read. Text the user pasted in answer to a question is user-provided evidence: link the page it came from but label it "user-provided, excerpted from that page", and never present it as a source you retrieved. A user's confirmation that an abstract fits a claim is recorded as their relevance judgement, not as literature confirmation.
