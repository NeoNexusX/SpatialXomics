---
name: literature-evidence
description: Retrieve and grade published evidence for MSI molecules, tissues or methods, or supply citations for a report. Use retrieved abstracts to assess support; title-only metadata cannot substantiate a mechanism.
---

# Literature evidence

Use `europepmc_search(query=..., maxResults=3)` first when a claim needs abstract text. `pubmed_search` returns titles/journal/year/PMID, while `openalex_search` gives broad work metadata, types and citation counts. They help discover papers; metadata alone does not verify a detailed claim. Citation counts are not evidence quality, and a preprint is not peer-reviewed by default.

Use `web_search(query=..., maxResults=3)` for broader source discovery, official methods pages or publisher/database documentation when the literature tools miss the needed source. Load `web-research` for that workflow. Exa returns URLs and excerpts, not a guarantee of full-text retrieval: verify scientific findings against available abstract text and do not invent a DOI from a title.

Search the candidate name plus tissue and modality. If too narrow, remove one qualifier or search the molecule class, labeling that evidence as class-level. After two useful reformulations with no supporting result, report the retrieval gap instead of inventing citations. Cancellation, HTTP/auth errors, invalid responses and a missing offline index are tool failures, not evidence of no literature or biological absence.

Distinguish direct evidence (the same molecule in the same tissue/modality), transferable evidence (other omics or class-level imaging), mechanism background, and contradicting findings. Separate candidate literature from evidence identifying the measured ion. Confirm isomer/adduct specificity before applying species-specific biology.

Use only the returned text to support claims. Abstracts may be excerpts; avoid assuming omitted methods, tissue context or outcomes. If the needed detail is unavailable, state the limit. Quote at most one short decisive phrase and paraphrase the rest. Use only retrieved PMID/DOI values and working source links; never copy unverified citations from another skill.

For a literature request, give a verdict (supported / partially supported / unsupported / no supporting literature retrieved), a compact finding-and-source table when useful, and the main applicability limit. For a narrow interpretation, embed one or two supporting citations in the explanation. Do not require a long report for a simple lookup.

## Inline source citations

For literature, database facts and other external evidence, place `[source title](URL)` immediately after the claim it supports. These HTTP(S) Markdown links render as shadcn-vue Inline Citation source cards. An optional short source excerpt can be supplied as `[source title](URL "short source excerpt")`; keep it on one line and escape double quotes. Use the exact title and URL returned by a tool. When only a retrieved PMID or DOI is available, link that exact identifier to `https://pubmed.ncbi.nlm.nih.gov/PMID/` or `https://doi.org/DOI`. Do not invent metadata or quotes, emit Vue/HTML components, or substitute bare URLs, PMID/DOI text, numbered markers or footnotes for the inline link. Multiple supporting sources use separate adjacent links. A search excerpt is not proof that the full paper was read.
