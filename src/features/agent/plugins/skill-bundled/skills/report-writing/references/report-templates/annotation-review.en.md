# MSI Annotation Review Report

## 1. General information

- **Dataset:** [Name / ID]
- **Tissue or sample:** [Recorded tissue or sample; when it is not recorded, give the organ you infer from the image outline, the judged molecule set and the retrieved localization, marked as an inference with its basis — do not stop at “unknown”]
- **Acquisition conditions:** [Instrument / ionization method / polarity / matrix / additives; use recorded information only]
- **Imaging and data:** [Acquisition mode / mass range / pixel size or spatial resolution / data format or storage location, if available]
- **Preprocessing and quality control:** [Preprocessing, calibration, and QC design/results actually recorded; mark unrecorded items as unknown]
- **Annotation scan scope:** [Rows or rank range examined; number of distinct candidate molecules independently judged (putative ones count); whether 10 were reached or the annotation set was exhausted]
- **Analysis question and scope:** [Question / analysis scope / important limitations]

## 2. Credible ions and annotations

| Candidate molecule                                                            |  Rank | Observed m/z | Adduct | Formula / shorthand | Engine evidence                                                                                                                                                                     | Independent verdict                                                                                             | Resolution level                                                                           |
| ----------------------------------------------------------------------------- | ----: | -----------: | ------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [Candidate molecule; combine the adduct rows carrying the same molecule name] | [...] |        [...] | [...]  | [...]               | [Mass error / adduct / spatial / q-value evidence; state actual weights when relevant. When the spatial score sits at the 0.2×chaos floor — record spatial evidence as unavailable] | [One of four fixed labels: supported but putative / conflicting evidence / insufficient evidence / unsupported] | [Composition / class / isomer; record unresolved isomers here, not as a verdict downgrade] |

## 3. Evidence conclusions for each judged molecule

### [Candidate molecule name]

[Lead with one line of verdict + resolution level, plus the merged ranks / observed m/z / adduct(s) tying this entry to the annotation table. Then list only supplementary tool-derived findings in the Profile bullets below. Do not restate panel fields already in section 2. Omit any bullet with no useful retrieved content; do not write "unavailable" placeholders.]

**Profile**

[Organize by tool. Use short sub-bullets, not paragraphs. Omit a tool entirely if it returned nothing useful. Do not copy these instructions or stock caveats into the report.]

- **PubChem / ChEBI:**
  - [Resolved CID / ChEBI id, returned name/synonyms, InChIKey or other structural identifiers]
  - [Whether the record denotes the intended candidate; remaining structural ambiguity]
  - [2D structure image `![CID 00000](session-artifact:fig-N)` when retrieved; for lipid sum composition, list unresolved sn-position / double-bond geometry / stereochemistry]
- **HMDB:**
  - [Tissue and cellular locations actually returned]
  - [Class / role / disease context actually returned]
- **KEGG:**
  - [Compound C number and pathway map ids actually returned]
- **Literature:**
  - [Claim-focused conclusion: what supports or weakens the spatial–tissue/biological claim]
  - [Applicability limit; provider and evidence class; at most one short decisive quote]

**Evidence**
[Include a bullet only when it carries actual supporting or contradicting evidence. Do not write unavailable/coverage-gap bullets; put all gaps in section 5. Keep each bullet short. The reader sees only the images this report embeds — an image you mention without embedding is a missing image.]

- **Mass evidence:** [Mass error against instrument resolution; include an independent mass-search finding only if one was actually run. Do not write that a check was not run. Isotope-ladder arguments are out of scope — the platform has no envelope fitting or MS/MS; if the judgement needs them, name the missing measurement in section 5 instead]
- **Adduct and acquisition:** [Adduct fit against polarity, matrix and additives, plus **how many adduct ions carry this molecule** (`siblings.length + 1`, counting rows outside the scanned window) and whether their observed spacings fit the proposed shifts. More adduct ions means better corroboration — state the count. A single-ion molecule is not disproved, just less corroborated. Do not build an isotope argument: envelope fitting and MS/MS are unavailable on this platform. When another adduct ion is cited as corroboration, embed its image below this bullet with its own `session-artifact:` reference]
- **Spatial evidence:** `![ion image caption](session-artifact:fig-N)` — [embed this molecule's ion image(s) from `get_ion_image_by_ranks` here, each on its own line, copying the reference verbatim from the `## Session figures` list in your system prompt; then state what they show. Name the organ when the outline, the molecule set and the retrieved localization support it, marked as an inference with its basis; keep the finer compartment observational ("central band", "outer region") unless a retrieved reference plus the image pattern supports naming it. Write that term and nothing about the rule behind it — no caveat explaining that a finer anatomical name is being withheld. A spatialScore on the 0.2×chaos floor means spatial evidence is unavailable, not weak; if the image itself is informative, embed it and state the observation]
- **Chemical identity:** [Synthesize the returned external record: whether name/synonyms denote the intended candidate, formula consistency, description context and structural identifiers. Formula alone is not the verdict; candidate/isomer counts feed the resolution level, not the verdict]
- **Biological background check:** [Only when there is a concrete compatibility or conflict finding between the embedded image region and the literature/HMDB localization. Otherwise omit this bullet. Cite the supporting text. Implausible biology is a question to flag, never a refutation on its own; plausible biology is not corroboration]
- **Competing identities:** [Same-peak alternatives, and whether any check actually favours one. When a competitor was compared by image, embed the competing ion image directly below with its own `session-artifact:` reference so the comparison is visible]
- **Overall conclusion:** [Verdict basis and unresolved identity questions; do not repeat coverage disclaimers here]
- **Sources:** [Place retrieved source links next to the claims they support. Label anything the user pasted as user-provided, excerpted from its page]

[Image rules for this section: use only images a tool actually attached in this conversation — reuse the ones already fetched in the spatial-evidence and identity steps and fetch only what is missing. **Images belong under the evidence of the molecule they support**: this subsection shows only this molecule's images — its ion image(s) under Spatial evidence, its structure under PubChem / ChEBI, a sibling adduct's image under Adduct and acquisition, a competitor's image under Competing identities. Never gather images into a gallery, and never put one molecule's image in another molecule's subsection; a montage that mixes molecules cannot be placed here (re-fetch the rows on their own). Every embedded image is a Markdown image whose reference is copied verbatim from the `## Session figures` list in your system prompt; describing an image instead of embedding it leaves the reader without it. Describe what an image shows before interpreting it. Never fabricate a reference, alter a handle, embed an external image URL, or present a pathway schematic or a database structure as sample-specific evidence.]

[Repeat this section for every independently judged molecule, putative ones included. If a molecule has no useful supplementary profile or evidence bullets, keep its heading and verdict line and state the decisive limitation once.]

## 4. Association analysis

[Each molecule's spatial–tissue correspondence was completed in section 3 using its image and literature; this section covers only connections between molecules, drawn from the biology, chemistry and literature already collected. Lead with spatial co-distribution and adduct-ion count; add metabolic branch, common mechanism/background/origin, and shared pathway or class only when they carry new information. Give the molecules involved and the denominator for each; if nothing is supported, say so rather than forcing a link. Do not label these as tiers.]

- **1. Spatial co-distribution:** [Group the molecules sharing a region and **embed that group's ion images** from get_ion_image_by_ranks (fixed p99/shared range; a cross-molecule montage above 4 targets belongs here in section 4, not in any molecule's subsection), each with its `session-artifact:` reference. An association argued from spatial overlap without the embedded images is incomplete. Describe what the images show before interpreting; sharing an anatomical compartment is not independent corroboration]
- **2. Adduct-ion count:** [How many adduct ions carry each judged molecule (`siblings.length + 1`). More ions means better corroboration, so say which associations rest on multi-ion molecules and which involve single-ion assignments. Note any adduct family recurring across molecules as a preparation-level pattern, not a biological link]
- **3. Precursor–product or shared metabolic branch:** [Only when the identities and retrieved literature actually support the conversion or branch. Name the supporting text; do not claim flux or conversion rates]
- **4. Common mechanism, background or contamination origin:** [Shared pharmacology/class mechanism, shared tissue background from literature, or shared matrix/background/contaminant origin from images plus identity. A negative association is still a finding]
- **5. Shared pathways or classes:** [How many were checked, mapped and matched. For dataset-wide pathway coverage use `kegg_pathway_annotations(pathwayId="map...")` and report matched members / total members plus matched annotation rows. An empty pathway intersection is a normal result — state it and do not run extra queries to fill this bullet Large pathways page: when `scanComplete` is false the counts are LOWER BOUNDS — call again with `memberOffset=nextMemberOffset` and union member ids across pages before reporting a total. Formula-only isomer hits stay in `formulaOnlyCandidateCount`, never in the confirmed count.]
- **Integrated association:** [What the independently assessed molecules collectively suggest]
- **Interpretive limits:** [Pathway co-occurrence does not establish statistical enrichment, pathway activation, metabolic flux, or causality; spatial co-distribution is not identity evidence]

## 5. Unresolved identities and recommendations

| Candidate molecule / rank    | Unresolved question                                                                      | Recommended evidence or next step                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [Candidate molecule or rank] | [Unresolved isomer / conflicting evidence / insufficient coverage / missing measurement] | [MS/MS / authentic standard / isomer-separation method / additional lookup / other action] |

[List unavailable sources, unscanned annotation rows, and other important coverage limitations.]
