---
name: adduct-isotope-analysis
description: Assess adduct assignments for MSI annotation rows from acquisition fit, observed mass differences and isotope-spacing checks. Use for adduct plausibility or ion-family questions; isotope-pattern fitting and MS/MS search are unavailable.
---

# Adduct evidence

Use the dataset's polarity, source, matrix and additives. Page `get_annotation` (default window rank 1-10; the inclusive 1-based `rankFrom`/`rankTo` range reaches any rank) and batch `get_annotation(rowIds=[...])` for the requested rows. Rows are full JSON: mass error, acquisition fit (`adductFit`), the adduct label and same-peak alternatives. Group rows carrying the same molecule name to see which adducts were annotated for it.

Compare the observed m/z differences between those rows with the proposed adduct shifts and the acquisition tolerance. Common singly charged differences are Na–H about 21.9819 Da and K–H about 37.9559 Da. Do not apply singly charged differences to a multiply charged ion. Prefer evidence from the returned row over a remembered generic fit table; user overrides and acquisition rules can change which adducts are enabled.

**Exclude an isotope explanation before accepting any adduct label.** A peak about +1.00336 Da above a stronger neighbour may be that neighbour's ¹³C M+1 peak rather than a chloride adduct of another molecule. Check the spacing against the isotope ladder, compare the intensity ratio with the carbon count, and compare the images. Run this check against *any* stronger nearby peak, not only rows already labelled as the same molecule — a mislabelled adduct usually points at a different molecule's isotope.

A plausible `adductFit` plus consistent mass differences supports an ion family. It does not resolve isomer identity. The absence of an adduct is not decisive: ionization, suppression and detection thresholds can prevent observation, and it is not evidence against the identity. `origin` is a database prior rather than independent evidence.

Use `get_ion_image_by_rowIds(rowIds=[...])` to compare the distributions of the rows in question; identical patterns at isotope spacing are a warning, not corroboration. The platform has no isotope-envelope fitting or in-browser MS/MS search, and no computed image-correlation value is exposed — do not claim a correlation coefficient from looking at two images. If the question needs those data, explain the specific missing measurement.

Check the returned PubChem record (name/synonyms, formula, identifiers and description) when candidate identity is uncertain; retain lipid class and shorthand evidence from the annotation detail. A sum composition is not a unique molecular structure. Query `hmdb_lookup` (archived profiles by id), `kegg_compound`/`kegg_find` or literature only when tissue biology is relevant; for mass-only candidate lookup pass one observed `mz` and one explicit `adduct` consistent with the known polarity to `kegg_mass_search`. Batch distinct candidate names, follow `nextOffset` only for needed evidence, and avoid repeating queries for multiple adducts of the same formula.

Return the rowId, candidate/adduct, observed mass and the spacing checks you ran, acquisition fit, competing assignments, and a calibrated verdict. Keep the annotation putative unless independent resolving evidence is supplied; state what MS/MS, standard, or isotope data would settle the uncertainty.

## Inline source citations

For literature, database facts and other external evidence, place `[source title](URL)` immediately after the claim it supports. These HTTP(S) Markdown links render as shadcn-vue Inline Citation source cards. An optional short source excerpt can be supplied as `[source title](URL "short source excerpt")`; keep it on one line and escape double quotes. Use the exact title and URL returned by a tool. When only a retrieved PMID or DOI is available, link that exact identifier to `https://pubmed.ncbi.nlm.nih.gov/PMID/` or `https://doi.org/DOI`. Do not invent metadata or quotes, emit Vue/HTML components, or substitute bare URLs, PMID/DOI text, numbered markers or footnotes for the inline link. Multiple supporting sources use separate adjacent links. A search excerpt is not proof that the full paper was read.
