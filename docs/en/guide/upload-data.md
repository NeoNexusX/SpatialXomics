# Upload Data

Upload paired imzML/ibd files, fill in metadata, and manage the datasets you contribute.

**Author:** Chen Kejiang

**Feedback:** Found a bug or have a suggestion? Open a [GitHub Issue](https://github.com/NeoNexusX/MassVision/issues) or email **jydong@xmu.edu.cn**.

## Upload a Dataset

Click **Upload New Dataset** to open the upload dialog.

![Upload button](https://cdn.neonexus.top/docs/20260908174622409.jpg_view)

![Upload dialog](https://cdn.neonexus.top/docs/20260908174725075.jpg_view)

### 1. Select Files

Click **Choose Files** and select both the `.imzML` and `.ibd` files. They must share the same base filename.

![File picker](https://cdn.neonexus.top/docs/20260908175048689.jpg_view)

### 2. Visibility

Choose whether the dataset is **public** (visible to all users) or **private** (visible only to you). Public is selected by default. The `.ibd` file of a public dataset must be at least **10 MB**.

![Visibility toggle](https://cdn.neonexus.top/docs/20260908175221284.jpg_view)

### 3. Fill in Metadata

Fields marked with \* are required. The spectrum and storage modes are read from the imzML header and pre-filled — changing one asks for confirmation.

![Metadata form](https://cdn.neonexus.top/docs/20260908193210320.jpg_view)

#### Acquisition Parameters

| Field | Required | Description | Values |
|---|---|---|---|
| **Polarity** | Yes | Ion polarity | Positive / Negative |
| **Ionisation Source** | Yes | Ionization method | MALDI, DESI, SIMS, AP-MALDI, AP-SMALDI, nano-DESI, LDI, SALDI, MALDI-2, LAESI, IR-MALDESI, Other |
| **Analyzer** | Yes | Mass analyzer | Orbitrap Exploris 480/240/120, Q Exactive HF, Q Exactive, timsTOF fleX, Orbitrap, FTICR, TOF, FTMS, Q-TOF, Other |
| **Pixel Size X (μm)** | Yes | Horizontal pixel size | Integer, 1–200 |
| **Pixel Size Y (μm)** | Yes | Vertical pixel size | Integer, 1–200 |
| **Spectrum Mode** | Yes | Spectrum type | profile (continuous) / centroid (peak-picked) |
| **Storage Mode** | Yes | imzML storage mode | continuous / processed |
| **Solvent** | Depends | Solvent composition | Pre-filled "100% Water"; options include Water, ACN, MeOH, Ethanol, IPA, Acetone |
| **MALDI Matrix** | Depends | Matrix compound | CHCA, DHB, NEDC, Sinapinic acid, 9-AA, Norharmane, DAN |
| **Matrix Application** | Depends | How matrix was applied | Spraying, Airbrush, Automated sprayer, Sublimation, Spotting |
| **m/z** | No | Reference m/z for resolving power | Number |
| **Resolving Power** | No | Resolution value | Number |

#### Dynamic Fields by Ion Source

Whether Solvent, MALDI Matrix, and Matrix Application are required depends on the selected ion source:

| Ion Source Family | Solvent | Matrix | Matrix Application |
|---|---|---|---|
| MALDI / MALDI-2 / AP-MALDI / AP-SMALDI | Required | Required | Required |
| DESI / nano-DESI / IR-MALDESI | Required | Optional | Optional |
| SIMS / LDI / SALDI / LAESI / Other / (none) | Optional | Optional | Optional |

#### Sample Information

| Field | Required | Description | Example Values |
|---|---|---|---|
| **Organism** | Yes | Species | Human, Mouse, Rat, Zebrafish, Fruit fly, Arabidopsis, E. coli, Yeast |
| **Organism Part** | Yes | Tissue location | Brain, Heart, Liver, Lung, Kidney, Spleen, Pancreas, Tumor, Whole organism |
| **Condition** | Yes | Experimental condition | Control, Disease, Cancer, Infection, Drug-treated, Genetic modification, Time-course |
| **Sample Stabilization** | Yes | Preservation method | Fresh, Fresh frozen, Snap frozen, FFPE, Fixed (formalin), Ethanol fixed, Dried |
| **Sample Growth Conditions** | No | How sample was grown | In vivo, Ex vivo, In vitro, Cell culture, 2D culture, 3D culture, Organoid |
| **Tissue Modification** | No | Tissue pre-processing | None, Sectioned, Cryosectioned, Microdissected, Washed, Digested, Stained |

## What Happens During Upload

The upload runs entirely in the browser and streams to Alibaba Cloud OSS. The combined size of the source files in one upload is capped at **100 GB**:

1. A Web Worker hashes the source files with MD5 and asks the server whether the content already exists. A hit reuses the stored copy immediately.
2. On a miss, the client fetches temporary STS credentials and initializes a multipart upload.
3. The pair is compressed to a ZIP64 archive and uploaded part by part while it is still being produced, so the archive is never written to disk.
4. A credit gate, a part queue, and a concurrency governor keep memory bounded and adapt the upload parallelism to the measured bottleneck.
5. Progress, speed, and per-part retry are reported in **Upload Progress**. A part that exhausts its retries stops the pipeline and leaves a resumable session behind.

Interrupted uploads can be resumed from the banner at the top of the upload dialog. The session is kept in a single `localStorage` entry (`oss_upload_session_v2`) that records the dataset's public id, source filenames, and compression settings, because a resumed part must reproduce the exact same archive bytes. Only one resumable session exists at a time — starting another upload overwrites it. Sessions left by older releases are discarded rather than migrated.

## My Datasets

After uploading, your dataset appears under **Datahub > My Datasets**. See [Dataset Overview](./dataset-overview) for how to view details, download, and share.

![My Datasets](https://cdn.neonexus.top/docs/20260908203828434.jpg_view)
