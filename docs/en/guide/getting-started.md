# Getting Started

SpatialXomics is a web-based platform for managing, analyzing, and visualizing mass spectrometry imaging (MSI) data.

**Author:** Chen Kejiang

**Feedback:** Found a bug or have a suggestion? Open a [GitHub Issue](https://github.com/NeoNexusX/MassVision/issues) or email **jydong@xmu.edu.cn**.

## Overview

MSI data files are large and often scattered across instruments and personal machines. Researchers typically juggle local environments, multiple tools, and manual workflows — which makes data hard to share and results hard to reproduce.

SpatialXomics brings the most common MSI data management and analysis tasks into a single web platform. Upload imzML/ibd pairs from your browser, fill in metadata, then manage, preprocess, visualize, and analyze your datasets — all without installing anything locally.

**Who is this for?**

- MSI, metabolomics, and mass spectrometry researchers who need a central place to manage, share, and download imzML datasets.
- Anyone who wants to run denoising, baseline correction, intensity normalization, peak picking, or peak alignment in the cloud.
- Users who need ion images, mean spectra, annotation matching, or UMAP/KMeans tissue segmentation.

## Features

| Feature | Description |
|---|---|
| **Accounts & Permissions** | Registration, login, password recovery, profile editing. Admins can manage all users. |
| **Data Upload** | Upload paired .imzML/.ibd files with automatic deduplication, ZIP compression, chunked upload, and resume. |
| **Dataset Management** | Browse public datasets, manage your own, inspect metadata, share public pages, and download originals. |
| **Collections** | Group related public datasets into curated collections with academic metadata and an ordered member list. |
| **Preprocessing** | Compatible methods shown automatically based on your data's spectrum/storage mode: noise reduction, baseline correction, normalization, peak picking, peak alignment. |
| **Visualization** | Continuous mode: ion images + mean spectra. Processed mode: TIC images + per-pixel spectra. Adjustable range, gamma, colormap, TIC normalization, and transparent PNG export. |
| **Spatial Analysis** | UMAP/KMeans clustering, cluster filtering, rectangular/freeform ROIs, and multi-region comparison. |
| **Annotation Matching** | Import CSV annotation tables, match by m/z with ppm or Da tolerance, filter, export, and query PubChem. |

## Quick Start

### 1. Open the Platform

Click **Join to start** on the landing page.

![Landing page](https://cdn.neonexus.top/docs/20260907165610863.jpg_view)

### 2. Register & Sign In

First-time users: create an account (see [Account Management](./account-management) for details). Then click **Sign in**.

![Sign in](https://cdn.neonexus.top/docs/20260907165825552.jpg_view)

### 3. Find a Dataset

Search by name or use filters to narrow down results (see [Finding Datasets](./finding-datasets)).

**Example:** Filter for "Mouse Brain" data — click **Add filter**, set Organism to "Mouse" and Organism Part to "Brain", then click **Apply**.

![Filter example](https://cdn.neonexus.top/docs/20260907174909406.jpg_view)

### 4. Inspect & Download

Click any dataset row to view its metadata.

![Dataset info](https://cdn.neonexus.top/docs/20260907175815189.jpg_view)

The detail page shows biological info, acquisition parameters, and file details (see [Dataset Overview](./dataset-overview)). Use **Download** to get the raw files, or **Share** to copy the dataset's link.

![Download & Share](https://cdn.neonexus.top/docs/20260907180028501.jpg_view)

### 5. Visualize

Click **Visualize** on a dataset card to explore its data interactively (see [Data Visualization](./data-visualization)).

![Visualize button](https://cdn.neonexus.top/docs/20260908134626454.jpg_view)

![Visualization page](https://cdn.neonexus.top/docs/20260908135003414.jpg_view)

### 6. Upload Your Own Data

Click **Upload New Dataset** to add a dataset of your own.

![Upload button](https://cdn.neonexus.top/docs/20260908135743254.jpg_view)

Select your .imzML and .ibd files (they must share the same base filename), then fill in the required metadata (see [Upload Data](./upload-data)). Fields marked with \* are mandatory.

![Upload form](https://cdn.neonexus.top/docs/20260908140402663.jpg_view)

Once uploaded, your dataset appears under **Datahub > My Datasets**.

![My Datasets](https://cdn.neonexus.top/docs/20260908140630805.jpg_view)

### 7. Run an Analysis

Go to **Workspace > New Analysis**, pick a dataset, and choose preprocessing steps (see [Dataset Analysis](./dataset-analysis)).

**Example:** Select "Mouse_Kidney_MALDI_30_Negative_77bf5d" and enable denoising, baseline correction, normalization, peak picking, and peak alignment.

![New Analysis](https://cdn.neonexus.top/docs/20260908141557982.jpg_view)

Click **Start Analysis** to submit. You'll be redirected to the Workspace where you can track progress (see [Workspace](./workspace)).

![Workspace](https://cdn.neonexus.top/docs/20260908142155682.jpg_view)

## What's Next?

Pick a topic that matches your workflow:

| Guide | Covers |
|---|---|
| [Account Management](./account-management) | Registration, login, password recovery, profile editing, quotas |
| [Finding Datasets](./finding-datasets) | Search, filter, and sort public and personal datasets |
| [Dataset Overview](./dataset-overview) | Metadata fields, downloading, sharing links, making datasets public |
| [Data Visualization](./data-visualization) | Ion images, TIC plots, spectra, UMAP/KMeans, ROIs, region comparison, annotations |
| [Upload Data](./upload-data) | imzML/ibd upload flow, metadata form, deduplication, resume |
| [Dataset Analysis](./dataset-analysis) | Choosing compatible preprocessing methods, parameters, submission |
| [Workspace](./workspace) | Task dashboard, status tracking, viewing results |
| [Navigation](./navigation) | Navigation bar and floating nav ball |
| [Collections](./collections) | Browse, create, and share collections; manage ordered members |
