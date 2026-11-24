---
name: adduct-isotope-analysis
description: Assess adduct assignments for MSI annotation rows from acquisition fit, observed mass differences and the size of the molecule's adduct-ion family. Use for adduct plausibility or ion-family questions; isotope-pattern fitting and MS/MS search are unavailable.
---

# Adduct evidence

Use the dataset's polarity, source, matrix and additives. Page `get_annotation` (default window rank 1-10; the inclusive 1-based `rankFrom`/`rankTo` range reaches any rank) and batch `get_annotation(ranks=[...])` for the requested rows. Rows are full JSON: mass error, acquisition fit (`adductFit`), the adduct label, `siblings` (the molecule's other adduct ions, including rows outside the current window) and same-peak alternatives.

**The number of adduct ions carrying a molecule is positive evidence.** Count `siblings.length + 1`: a molecule independently detected as several adduct ions is better corroborated than a single-ion assignment. Report the count and which adducts they are.

Compare the observed m/z differences between those rows with the proposed adduct shifts and the acquisition tolerance. Common singly charged differences are Na–H about 21.9819 Da and K–H about 37.9559 Da. Do not apply singly charged differences to a multiply charged ion. Prefer evidence from the returned row over a remembered generic fit table; user overrides and acquisition rules can change which adducts are enabled.

A plausible `adductFit` plus consistent mass differences and several adduct ions supports an ion family. It does not resolve isomer identity. A molecule with only one detected ion is not disproved — ionization, suppression and detection thresholds limit which adducts appear — but it has less corroboration, and you should say so rather than lowering the verdict. `origin` is a database prior rather than independent evidence.

**Isotope reasoning is out of scope for now.** The platform has no isotope-envelope fitting and no in-browser MS/MS search, so do not build an argument on an isotope ladder, and do not gate an adduct assignment on excluding an isotope explanation. Missing M+1/M+2 in centroid/processed data is unavailable evidence, never proof of absence. No computed image-correlation value is exposed either — use `get_ion_image_by_ranks(ranks=[...])` to describe how the distributions compare, and never quote an r you did not receive. When the question genuinely needs isotope or MS/MS data, name the specific missing measurement.

Check the returned PubChem record (name/synonyms, formula, identifiers and description) when candidate identity is uncertain; retain lipid class and shorthand evidence from the annotation detail. A sum composition is not a unique molecular structure. Query `hmdb_lookup` (archived profiles by id), `kegg_compound`/`kegg_find` or literature only when tissue biology is relevant; for mass-only candidate lookup pass one observed `mz` and one explicit `adduct` consistent with the known polarity to `kegg_mass_search`. Batch distinct candidate names, follow `nextOffset` only for needed evidence, and avoid repeating queries for multiple adducts of the same formula.

Return the rank, candidate/adduct, observed mass, how many adduct ions carry the molecule and the spacing checks you ran, acquisition fit, competing assignments, and a calibrated verdict. Keep the annotation putative unless independent resolving evidence is supplied; state what MS/MS, standard, or isotope data would settle the uncertainty.

## Inline source citations

For literature, database facts and other external evidence, place `[source title](URL)` immediately after the claim it supports. These HTTP(S) Markdown links render as shadcn-vue Inline Citation source cards. An optional short source excerpt can be supplied as `[source title](URL "short source excerpt")`; keep it on one line and escape double quotes. Use the exact title and URL returned by a tool. When only a retrieved PMID or DOI is available, link that exact identifier to `https://pubmed.ncbi.nlm.nih.gov/PMID/` or `https://doi.org/DOI`. Do not invent metadata or quotes, emit Vue/HTML components, or substitute bare URLs, PMID/DOI text, numbered markers or footnotes for the inline link. Multiple supporting sources use separate adjacent links. A search excerpt is not proof that the full paper was read.
