---
name: adduct-isotope-analysis
description: Assess adduct assignments and same-formula sibling evidence for MSI annotation rows. Use for adduct plausibility or ion-family questions; isotope-pattern fitting and MS/MS search are unavailable.
---

# Adduct evidence

Use the dataset's polarity, source, matrix and additives. Read `get_annotation_top` and batch `get_annotation_detail(rowIds=[...])` for the requested rows. The detail contains mass error, acquisition fit, sibling ions with image Pearson r, missing enabled adducts and same-peak alternatives.

Compare observed sibling m/z differences with the proposed adduct shifts and the acquisition tolerance. Common singly charged differences are Na–H about 21.9819 Da and K–H about 37.9559 Da. Do not apply singly charged differences to a multiply charged ion. Prefer evidence from the returned row over a remembered generic fit table; user overrides and acquisition rules can change which adducts are enabled.

A plausible fit plus consistent mass differences and spatially correlated siblings supports an ion family. It does not resolve isomer identity. Low correlation raises ambiguity or artifact concerns. Absence of an enabled adduct is not decisive: ionization, suppression and detection thresholds can prevent observation. `origin` is a database prior rather than independent evidence.

Use `get_annotation_images(rowIds=[...])` to inspect suspicious sibling patterns. The platform has no isotope-envelope fitting or in-browser MS/MS search; do not claim either from top peaks or an image correlation. If the question needs those data, explain the specific missing measurement.

Check formula and identifiers with `pubchem_compound_lookup` when candidate identity is uncertain; retain lipid class and shorthand evidence from the annotation detail. A sum composition is not a unique molecular structure. Query `hmdb_lookup`, `kegg_pathway_lookup` or literature only when tissue biology is relevant. Batch distinct candidate names, follow `nextOffset` only for needed evidence, and avoid repeating queries for multiple adducts of the same formula.

Return the rowId, candidate/adduct, observed mass and sibling evidence, acquisition fit, competing assignments, and a calibrated verdict. Keep the annotation putative unless independent resolving evidence is supplied; state what MS/MS, standard, or isotope data would settle the uncertainty.

## Inline source citations

For literature, database facts and other external evidence, place `[source title](URL)` immediately after the claim it supports. These HTTP(S) Markdown links render as shadcn-vue Inline Citation source cards. An optional short source excerpt can be supplied as `[source title](URL "short source excerpt")`; keep it on one line and escape double quotes. Use the exact title and URL returned by a tool. When only a retrieved PMID or DOI is available, link that exact identifier to `https://pubmed.ncbi.nlm.nih.gov/PMID/` or `https://doi.org/DOI`. Do not invent metadata or quotes, emit Vue/HTML components, or substitute bare URLs, PMID/DOI text, numbered markers or footnotes for the inline link. Multiple supporting sources use separate adjacent links. A search excerpt is not proof that the full paper was read.
