# Dataset Overview

Inspect dataset metadata, download raw files, share links, and make datasets public.

**Author:** Chen Kejiang

**Feedback:** Found a bug or have a suggestion? Open a [GitHub Issue](https://github.com/NeoNexusX/MassVision/issues) or email **jydong@xmu.edu.cn**.

## Open the Detail Page

Click any dataset row to open its detail page in a new tab.

![Click dataset](https://cdn.neonexus.top/docs/20260908164356724.jpg_view)

## Metadata Sections

The detail page is organized into three sections.

![Detail page overview](https://cdn.neonexus.top/docs/20260908164615849.jpg_view)

### Biological & Sample Info

![Biological info](https://cdn.neonexus.top/docs/20260914194520307.jpg_view)

| Field | Example | Meaning |
|---|---|---|
| **Organism** | Mouse (mus musculus) | Species |
| **Organism Part** | Brain | Tissue or organ |
| **Condition** | Control | Experimental condition (e.g., untreated vs. disease) |
| **Growth Conditions** | — | How the sample was grown (often blank) |
| **Stabilization** | FFPE | Preservation method (formalin-fixed paraffin-embedded) |
| **Tissue Modification** | — | Pre-processing applied to the tissue (often blank) |

### MSI Analysis Settings

![MSI settings](https://cdn.neonexus.top/docs/20260914194545854.jpg_view)

| Field | Example | Meaning |
|---|---|---|
| **Polarity** | Positive | Ion polarity mode |
| **Ionisation Source** | MALDI | Ionization method (Matrix-Assisted Laser Desorption/Ionization) |
| **Analyzer** | Orbitrap | Mass analyzer type |
| **Pixel Size** | 30 × 30 μm | Spatial resolution |
| **Resolving Power** | at m/z 300.2, 30000 | Resolving power reported at a reference m/z. Shows `at m/z 0, 0` when neither value was provided — the fields default to 0, this is normal. |
| **Matrix** | DHB | Matrix compound (2,5-Dihydroxybenzoic acid) |
| **Matrix Application** | Spraying | How the matrix was applied |
| **Solvent** | 100% Water | Solvent composition |

### File Information

![File info](https://cdn.neonexus.top/docs/20260914194608330.jpg_view)

| Field | Example | Meaning |
|---|---|---|
| **File Type** | zip | Archive format |
| **Experiment Type** | imzML | Data format |
| **Size** | 259.7 MB | File size |
| **Spectrum Mode** | centroid | Centroid (peak-picked) or profile (continuous) |
| **Storage Mode** | continuous | How spectra are stored in the file |
| **Submitted By** | dre | Uploader's username |

## Download

You can download the raw .imzML/.ibd pair in two places.

**Option 1:** Click **Download** on the dataset row in any list view.

![Download from list](https://cdn.neonexus.top/docs/20260908170252957.jpg_view)

**Option 2:** Click **Download** on the detail page.

![Download from detail](https://cdn.neonexus.top/docs/20260914195006583.jpg_view)

## Share

Both public and private datasets can be shared. Sharing does not change the dataset's visibility.

1. Open the detail page and click **Share**.
2. The link is copied to your clipboard automatically.

The link uses the short `/s/` form built from the dataset's 16-character public id.

![Share button](https://cdn.neonexus.top/docs/20260914195044165.jpg_view)

## Make Public

To list a dataset under Public Datasets so every user can see it, make it public:

1. Open the detail page from **My Datasets** (the button only appears for private datasets).

   <img src="https://cdn.neonexus.top/docs/20261008180527576.jpg_view" alt="b4788d43248812376b8046143e4b6f49" style="zoom:67%;" />

2. Click **Make Public** and confirm the dialog.

   <img src="https://cdn.neonexus.top/docs/20261008180555416.jpg_view" alt="image-20261008180555369" style="zoom: 80%;" />

Making a dataset public cannot be undone. It is independent of sharing: **Share** only copies the link and never turns a private dataset public.
