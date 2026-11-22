# MSI Annotation Review Report

## 1. General information
- **Dataset:** [Name / ID]
- **Tissue or sample:** [Recorded tissue or sample; if not recorded, state “unknown”]
- **Acquisition conditions:** [Instrument / ionization method / polarity / matrix / additives; use recorded information only]
- **Imaging and data:** [Acquisition mode / mass range / pixel size or spatial resolution / data format or storage location, if available]
- **Preprocessing and quality control:** [Preprocessing, calibration, and QC design/results actually recorded; mark unrecorded items as unknown]
- **Annotation scan scope:** [Rows or rank range examined; number of distinct candidate molecules independently judged (putative ones count); whether 10 were reached or the annotation set was exhausted]
- **Analysis question and scope:** [Question / analysis scope / important limitations]

## 2. Credible ions and annotations
| Candidate molecule | Row ID | Observed m/z | Adduct | Formula / shorthand | Engine evidence | Independent verdict | Resolution level |
|---|---:|---:|---|---|---|---|---|
| [Candidate molecule; combine the adduct rows carrying the same molecule name] | [...] | [...] | [...] | [...] | [Mass error / adduct / spatial / q-value evidence; state actual weights when relevant. When the spatial score sits at the 0.2×chaos floor — record spatial evidence as unavailable] | [One of four fixed labels: supported but putative / conflicting evidence / insufficient evidence / unsupported] | [Composition / class / isomer; record unresolved isomers here, not as a verdict downgrade] |

## 3. Evidence conclusions for each judged molecule
### [Candidate molecule name]
[Lead with one line of verdict + resolution level. Then introduce the molecule in the four profile bullets below **before** presenting any evidence — the reader needs to know what the molecule is before judging whether the assignment holds. One or two sentences each; write "unavailable" for an item you could not retrieve rather than omitting it.]

**Profile**
- **Basic information:** [Name as returned by the annotation/library tools plus the synonyms actually used; the row ids and ranks merged into this entry; observed m/z and adduct(s); formula or lipid shorthand; compound class; library `origin`; intensity and rank only as detectability context, never as confidence]
- **Structure:** [**Attach the 2D structure image** from `pubchem_compound_lookup(names=[...], withImage=true)` — one image per returned CID, 1–4 names per call. The image depicts whatever the name resolved to, so confirm the returned identity first and say which CID the structure belongs to. If the lookup failed or the image was unavailable, link the record page that displays it (PubChem CID page, ChEBI entry or KEGG compound entry) and state the structure was not retrieved. Never draw it, describe it from memory, or embed an image URL no tool returned. For a lipid sum composition, say which structural features are NOT determined (sn-position, double-bond position/geometry, stereochemistry) — the database structure is one specific isomer, not the measured species]
- **Chemical information:** [Formula, `inchikey` and other structural identifiers actually returned; PubChem CID / ChEBI id / KEGG C number; how many same-formula candidates or isomers exist and what distinguishes them. This is what the databases say the molecule is, not what was measured]
- **Biological information:** [Recorded tissue locations and disease context from HMDB, pathway membership from KEGG (with map ids), and the molecule's known role or class biology. Cite each item inline. Label all of it as database background — none of it is a measurement of this sample]

**Evidence**
[One or two sentences per dimension; write "unavailable" for a dimension you could not check rather than omitting it. Every dimension that rests on an image must SHOW that image, not just describe it.]
- **Mass evidence:** [Mass error against instrument resolution; any independent mass-search finding. Isotope-ladder arguments are out of scope — the platform has no envelope fitting or MS/MS; if the judgement needs them, name the missing measurement in section 5 instead]
- **Adduct and acquisition:** [Adduct fit against polarity, matrix and additives, plus **how many adduct ions carry this molecule** (`siblings.length + 1`, counting rows outside the scanned window) and whether their observed spacings fit the proposed shifts. More adduct ions means better corroboration — state the count. A single-ion molecule is not disproved, just less corroborated. Do not build an isotope argument: envelope fitting and MS/MS are unavailable on this platform. When another adduct ion is cited as corroboration, attach its image alongside the parent]
- **Spatial evidence:** [**Attach this molecule's ion image(s)** from `get_ion_image_by_rowIds` (fixed p99/shared range), then state what they show. Without histology registration/an anatomical mask use "central band/outer region", not asserted medulla or pelvis. A spatialScore on the 0.2×chaos floor means spatial evidence is UNAVAILABLE, not weak — say so and still show the image]
- **Chemical identity:** [Synthesize the returned external record: whether name/synonyms denote the intended candidate, formula consistency, description context and structural identifiers. Formula alone is not the verdict; candidate/isomer counts feed the resolution level, not the verdict]
- **Biological background (read with the image and literature):** [Complete this molecule's spatial–tissue correspondence during its independent analysis: first state the image region — referring to the image attached above — then use the retrieved abstract/HMDB profile to judge whether that region is compatible with its recorded tissue localization and whether its composition fits the tissue, matrix and additives. Cite the text supporting the tissue claim; do not defer this to association analysis. Implausible biology is a question to flag, never a refutation on its own; plausible biology is not corroboration]
- **Competing identities:** [Same-peak alternatives, and whether any check actually favours one. When a competitor was compared by image or by an independent mass search, attach the competing ion images next to the assigned one so the comparison is visible]
- **Literature evidence:** [The claim searched for and the keywords used; retrieved findings and applicability; direct evidence / transferable evidence / background context / contradictory evidence. Name the tier that actually served it (europepmc / pubmed / web_search) and why earlier tiers did not; label web_search findings as web-source evidence; distinguish all-tiers-empty from all-tiers-errored. A user's confirmation that an abstract fits the claim is their relevance judgement, not literature confirmation]
- **Overall conclusion:** [Evidence supporting this candidate; unresolved identity questions]
- **Sources:** [Place retrieved source links next to the claims they support. Label anything the user pasted as user-provided, excerpted from its page]

[Image rules for this section: use only images a tool actually attached in this conversation — reuse the ones already fetched in the spatial-evidence and identity steps and fetch only what is missing. Ion images batch 6 targets per call; structure images come 1–4 per PubChem call. Describe what an image shows before interpreting it. Never fabricate an image, embed an external image URL, or present a pathway schematic or a database structure as sample-specific evidence.]

[Repeat this section for every independently judged molecule, putative ones included; keep the heading of any subsection whose evidence was unavailable and say why.]

## 4. Association analysis
[Each molecule's spatial–tissue correspondence was completed in section 3 using its image and literature; this section covers only connections between molecules, drawn from the biology, chemistry and literature already collected. Work the five lenses in two tiers: lead with tier 1 (spatial co-distribution, adduct-ion count), then add tier 2 (metabolic branch, common mechanism/background/origin, shared pathway or class) only when it carries new information. Give the molecules involved and the denominator for each; if nothing is supported, say so rather than forcing a link]
- **1. Spatial co-distribution (tier 1):** [Group the molecules sharing a region and **attach that group's ion images** from get_ion_image_by_rowIds (fixed p99/shared range, batch 6 targets per call, 2-column montage above 4). An association argued from spatial overlap without the images is incomplete. Describe what the images show before interpreting; sharing an anatomical compartment is not independent corroboration]
- **2. Adduct-ion count (tier 1):** [How many adduct ions carry each judged molecule (`siblings.length + 1`). More ions means better corroboration, so say which associations rest on multi-ion molecules and which involve single-ion assignments. Note any adduct family recurring across molecules as a preparation-level pattern, not a biological link]
- **3. Precursor–product or shared metabolic branch (tier 2):** [Only when the identities and retrieved literature actually support the conversion or branch. Name the supporting text; do not claim flux or conversion rates]
- **4. Common mechanism, background or contamination origin (tier 2):** [Shared pharmacology/class mechanism, shared tissue background from literature, or shared matrix/background/contaminant origin from images plus identity. A negative association is still a finding]
- **5. Shared pathways or classes (tier 2):** [How many were checked, mapped and matched. An empty pathway intersection is a normal result — state it and do not run extra queries to fill this bullet]
- **Integrated association:** [What the independently assessed molecules collectively suggest]
- **Interpretive limits:** [Pathway co-occurrence does not establish statistical enrichment, pathway activation, metabolic flux, or causality; spatial co-distribution is not identity evidence]

## 5. Unresolved identities and recommendations
| Candidate molecule / row ID | Unresolved question | Recommended evidence or next step |
|---|---|---|
| [Candidate molecule or row ID] | [Unresolved isomer / conflicting evidence / insufficient coverage / missing measurement] | [MS/MS / authentic standard / isomer-separation method / additional lookup / other action] |

[List unavailable sources, unscanned annotation rows, and other important coverage limitations.]
