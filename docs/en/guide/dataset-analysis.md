# Dataset Analysis

Choose preprocessing methods that are compatible with your data's spectrum/storage mode, configure their parameters, and submit an analysis task.

**Author:** Chen Kejiang

**Feedback:** Found a bug or have a suggestion? Open a [GitHub Issue](https://github.com/NeoNexusX/MassVision/issues) or email **jydong@xmu.edu.cn**.

## Open the Analysis Page

Go to **Workspace > New Analysis**.

![Navigation](https://cdn.neonexus.top/docs/20260909164518653.jpg_view)

## Page Overview

The page is a two-step wizard — pick a data source, then build the pipeline. Around the wizard you will also find the navigation bar and an upload shortcut.

![Page layout](https://cdn.neonexus.top/docs/20260909152647040.jpg_view)

| Section | Purpose |
|---|---|
| **Data source** (step 1) | Pick a personal or public dataset |
| **Preprocessing pipeline** (step 2) | Choose methods and set parameters |
| **Summary panel** | Review the selected dataset and methods |
| **Start Analysis** | Submit the task |

## Select a Dataset

Browse **My Datasets** or **Public Datasets** and select the one you want to analyze.

![Dataset selection](https://cdn.neonexus.top/docs/20260909151822747.jpg_view)

Haven't uploaded your data yet? Click **Upload New Dataset** in the top-right corner (see [Upload Data](./upload-data)).

![Upload shortcut](https://cdn.neonexus.top/docs/20260909153324475.jpg_view)

Once a dataset is selected, a notice reports its spectrum and storage modes and only the compatible methods are listed.

## Choose Preprocessing Methods

### 1. Noise Reduction

#### Savitzky–Golay Smoothing

Fits a polynomial to a local window, which preserves peak shape well.

| Parameter | Default | Notes |
|---|---|---|
| Window | 5 | Positive integer. Larger windows smooth more but can blur narrow peaks. |
| Polyorder | 3 | Polynomial order. Must be lower than Window. Lower orders smooth more; higher orders preserve peaks better. |
| Derivative | 0 | Keep at 0 for smoothing. Higher values output the derivative rather than the original intensity. |
| Delta | 1.0 | Sampling interval used when computing derivatives. |

![Savitzky–Golay](https://cdn.neonexus.top/docs/20260909160244980.jpg_view)

#### Gaussian Smoothing

Weights nearby points by a Gaussian kernel, which gives a natural-looking smooth.

| Parameter | Default | Notes |
|---|---|---|
| Window | 5 | Positive integer. |
| Sigma | 2.0 | Standard deviation (σ) of the Gaussian kernel. Larger values smooth harder and widen peaks. |

![Gaussian](https://cdn.neonexus.top/docs/20260909160302194.jpg_view)

#### Moving Average

Replaces each point with the average of its neighbours. Simple and effective, but large windows can flatten narrow peaks.

| Parameter | Default | Notes |
|---|---|---|
| Window | 5 | Positive integer. |

![Moving average](https://cdn.neonexus.top/docs/20260909160416905.jpg_view)

### 2. Baseline Correction

| Method | Best For |
|---|---|
| **SNIP** | Dense peaks and variable backgrounds. Iteratively estimates the baseline while preserving peak shape. |
| **Local Minimum** | General-purpose use. Estimates the baseline from locally low signal points. |

![Baseline correction](https://cdn.neonexus.top/docs/20260909163548562.jpg_view)

### 3. Intensity Normalization

#### TIC (Total Ion Current)

Scales each spectrum so its total intensity equals a target value.

| Parameter | Default | Notes |
|---|---|---|
| Scale | 1.0 | Multiplier applied after normalization. Common values are 1000 or 10000. |

![TIC normalization](https://cdn.neonexus.top/docs/20260909163744460.jpg_view)

#### RMS (Root Mean Square)

Scales each spectrum so its RMS equals a target value.

| Parameter | Default | Notes |
|---|---|---|
| Scale | 1.0 | Multiplier applied after normalization. |

![RMS normalization](https://cdn.neonexus.top/docs/20260909163810520.jpg_view)

#### Reference Peak (REF)

Scales each spectrum so a specific m/z peak matches a target value.

| Parameter | Default | Notes |
|---|---|---|
| Scale | 1.0 | Multiplier applied after normalization. |
| Ref m/z | (auto) | Target internal-standard m/z. Leave blank to pick one automatically. |
| Ref Tolerance | 0.1 | Matching window around the reference peak, in Da. For example, `Ref m/z=500` and `Ref Tolerance=0.1` searches 500 ± 0.1 Da. |

![REF normalization](https://cdn.neonexus.top/docs/20260909163851707.jpg_view)

### 4. Peak Picking

The method is labelled **Standard Peak Detection**.

| Parameter | Default | Notes |
|---|---|---|
| **Method** | diff | Noise estimation: `diff` (Differential), `sd` (Std Dev), `mad` (MAD), or `quantile` (Quantile). `mad` is the most robust choice for data with large peaks. |
| **SNR** | 2.0 | Signal-to-noise threshold. Candidates below `SNR × noise` are discarded. Lower values keep more (noisier) peaks; higher values keep fewer, more confident peaks. |
| **Return** | height | `height` (peak-top intensity) or `area` (integrated area). Height suits most workflows. |
| **Width** | 5 | Half-width of the local-maximum detection window. Larger values merge nearby peaks; smaller values retain more of them. |

![Peak picking](https://cdn.neonexus.top/docs/20260909164354471.jpg_view)

### 5. Peak Alignment

| Parameter | Default | Notes |
|---|---|---|
| **Bin Function** | min | How values inside a bin are aggregated: `min`, `median`, `mean`, or `max`. `median` is the most robust; `min` keeps the finest resolution. |
| **Min Frequency** | 0.01 | Minimum occurrence rate across spectra. 0.01 means a peak must appear in at least 1% of spectra. Range [0, 1]. |

![Peak alignment](https://cdn.neonexus.top/docs/20260909165322419.jpg_view)

## Compatibility Matrix

Not every method works with every data mode:

| Spectrum Mode | Storage Mode | Noise Reduction | Baseline Correction | Normalization | Peak Picking | Peak Alignment |
|---|---|---|---|---|---|---|
| profile | continuous | ✓ | ✓ | ✓ | ✓ | ✓ |
| profile | processed | ✓ | ✓ | ✓ | ✓ | ✓ |
| centroid | continuous | ✗ | ✗ | ✓ | ✗ | ✗ |
| centroid | processed | ✗ | ✗ | ✓ | ✗ | ✓ |

**Rules:**

- In profile mode, **peak alignment requires peak picking to be enabled first**.
- In centroid + continuous mode, peaks already share one m/z axis, so peak alignment does not apply and **only normalization is available**.

## Submit

Click **Start Analysis** to submit.

![Start Analysis](https://cdn.neonexus.top/docs/20260909170806890.jpg_view)

You'll be redirected to the [Workspace](./workspace) to track progress.

![Workspace redirect](https://cdn.neonexus.top/docs/20260909170958484.jpg_view)
