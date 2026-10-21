# Finding Datasets

Search, filter, and sort public and personal datasets on SpatialXomics.

**Author:** Chen Kejiang

**Feedback:** Found a bug or have a suggestion? Open a [GitHub Issue](https://github.com/NeoNexusX/MassVision/issues) or email **jydong@xmu.edu.cn**.

## Search by Name

### Dataset Naming Convention

Dataset names are generated at upload time from the metadata you entered plus the file hash. For example, `0e75ee_Human_Brain_MALDI_20_Positive`:

| Segment | Meaning | Example |
|---|---|---|
| Identifier | First six characters of the file hash | 0e75ee |
| Organism | Species | Human |
| Organism Part | Tissue or organ | Brain |
| Ion Source | Ionization method | MALDI |
| Pixel Size | Horizontal pixel size (μm) | 20 |
| Polarity | Ion polarity | Positive |

Use any of these segments to search.

![Dataset naming convention](https://cdn.neonexus.top/docs/20260908161627268.jpg_view)

### Search Bar

Type a dataset name (or part of it) in the search bar and click **Search**.

![Search bar](https://cdn.neonexus.top/docs/20260908162509801.jpg_view)

## Filter

Click **Add filter**, choose your criteria, then click **Apply**.

![Filter panel](https://cdn.neonexus.top/docs/20260914193954466.jpg_view)

### Available Filters

| Filter | Type | Example Values |
|---|---|---|
| **Filename** | Text | `0e75ee_Human_Brain_MALDI_20_Positive` |
| **Experiment Type** | Multi-select | imzML, Other |
| **Submitted By** | Text | Submitter's username |
| **Owner** | Text | Dataset owner (shown on Public Datasets only) |
| **Organism** | Multi-select | Human, Mouse, Rat, Zebrafish… |
| **Organism Part** | Multi-select | Brain, Heart, Liver, Tumor, Whole organism… |
| **Condition** | Multi-select | Control, Disease, Cancer, Drug-treated, Genetic modification… |
| **Sample Stabilization** | Multi-select | Fresh, Fresh frozen, Snap frozen, FFPE, Ethanol fixed… |
| **Sample Growth Conditions** | Multi-select | In vivo, Ex vivo, In vitro, Cell culture, Organoid… |
| **Tissue Modification** | Multi-select | None, Cryosectioned, Washed, Stained, Chemical derivatization… |
| **MALDI Matrix** | Multi-select | CHCA, DHB, NEDC, Sinapinic acid, 9-AA… |
| **Matrix Application** | Multi-select | Spraying, Sublimation, Spotting, Inkjet printing… |
| **Solvent** | Multi-select | Water, ACN, MeOH, Ethanol, TFA… |
| **Polarity** | Multi-select | Positive, Negative |
| **Ionisation Source** | Multi-select | MALDI, DESI, SIMS, AP-MALDI, LDI… |
| **Analyzer** | Multi-select | Orbitrap Exploris 480, Q Exactive HF, timsTOF fleX, TOF… |

**Multi-select** filters are tag inputs: pick values from the vocabulary dropdown or type your own; multiple values within one field are OR-ed. The **Owner** filter is not shown on **My Datasets** — that list is always limited to your own uploads.

## Sort

Use the sort dropdown to the right of the search bar and pick one of four orders:

- **Submission time (newest first)** — default
- **Submission time (oldest first)**
- **File size (largest first)**
- **File size (smallest first)**

![image-20261008174924334](https://cdn.neonexus.top/docs/20261008174924392.jpg_view)

