# Data Visualization

Explore ion images, pixel spectra, and region comparison for a dataset that has been preprocessed and shows **Visualize**.

- Annotation panel: see [Data Annotation](./data-annotation).
- Toolbox: see [Visualization Toolbox](./visualization-toolbox).

**Author:** Chen Kejiang

**Feedback:** Found a bug or have a suggestion? Open a [GitHub Issue](https://github.com/NeoNexusX/SpatialXomics/issues) or email **jydong@xmu.edu.cn**.

## Dataset Status

Dataset cards show one of two actions:

| Action | Meaning |
|---|---|
| **Explore** | No preprocessed result exists yet. Click **Explore**, then **Generate** to create a direct-conversion task. |
| **Visualize** | A preprocessed result is ready. Click to open the visualization page. |

When you click **Explore > Generate**, the platform creates a task and redirects you to the [Workspace](./workspace) to track progress.

![Explore button](https://cdn.neonexus.top/docs/20260909211924161.jpg_view)

![Generate dialog](https://cdn.neonexus.top/docs/20260909212549240.jpg_view)

## Page Layout

The visualization page has five main areas:

1. **Ion intensity image** (center) — spatial heatmap of the selected m/z
2. **Pixel spectrum** (bottom) — mean spectrum or per-pixel spectrum
3. **Region comparison** (bottom panel) — compare two region groups
4. **[Toolbox](./visualization-toolbox)** (right sidebar) — dataset info, intensity, multi-ion overlay, clustering, ROIs, and masks
5. **[Annotation panel](./data-annotation)** (left rail) — annotation matching, scoring, filtering, and export

![Visualization page layout](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127160509530.jpg_view)

## Ion Intensity Image

Displays the spatial intensity distribution for the selected m/z value.

![Ion image](https://cdn.neonexus.top/docs/20260911153144287.jpg_view)

### Interaction

| Action | How |
|---|---|
| **Zoom** | Mouse wheel (centered on pointer), or use the `−` / `+` buttons in the bottom-right. |
| **Pan** | Click and drag when zoomed in. |
| **Pixel info** | Hover to see 1-based coordinates `(x, y)` and intensity. |
| **Select pixel** | Clicking a pixel loads its spectrum (works in both Continuous and Processed modes). |

### Toolbar

| Control | Description |
|---|---|
| **m/z search** | Continuous mode only. Enter a target m/z and press Enter or click Search to jump to the nearest peak. |
| **Tolerance ±** | m/z matching tolerance. Default 0.0001, range 1e-8–1. |
| **Colormap** | Viridis, Inferno (default), Magma, Hot, Gray. |
| **Intensity Scale** | Linear / Log / TIC. TIC normalization divides each pixel by its total ion current and needs pre-computed stats on Continuous data. |
| **Reset** | Restore all controls to defaults. |
| **JPG / PNG** | Export the current image. JPG (white background) is the default; hover the button to choose PNG (transparent, lossless). |

### Intensity Strip & Gamma

- **Intensity strip** — the vertical strip beside the image has two drag handles for Max and Min; the top button restores the default range. It is greyed out while the multi-ion overlay is active.
- **Intensity block** — Max / Min inputs and the Gamma control are in the Toolbox; see [Visualization Toolbox > Intensity](./visualization-toolbox#intensity).

## Pixel Spectrum

Content depends on the data mode:

| Mode | What's Shown | Interaction |
|---|---|---|
| **Continuous** | Mean spectrum of the entire dataset by default; switchable to the selected pixel's spectrum | Click anywhere to switch to the nearest m/z and refresh the ion image. |
| **Processed** | Spectrum of the selected pixel | Click a pixel in the TIC image first, then its spectrum loads here. |

- Centroid data renders as **bar peaks**; profile data as **continuous curves**.
- The currently selected m/z is highlighted with a **vertical marker**.
- Footer shows: Peaks, Intensity, Selected/Tolerance, or Pixel info.

## Region Comparison

::: tip Availability
Region comparison is only available for **Centroid** data.
:::

Compare spectral differences between two region groups (A vs. B). Regions can come from:

1. **KMeans clusters** (generated in the sidebar)
2. **User-drawn ROIs** (imported masks appear here too)

There must be at least 2 regions on the page before comparing. See [Visualization Toolbox](./visualization-toolbox) for creating clusters and ROIs.

The **Compare regions** panel at the bottom of the page works as follows:

1. Check members into group A and group B; a group can hold several regions, and one region cannot belong to both groups. Members of a group are combined (union) before comparing.
2. Set three parameters:
   - **Min detection rate** — 1%–50%, the minimum share of a group in which an ion must be detected.
   - **Intensity threshold** — 0%–20%, an intensity percentile used to filter noise.
   - **Enrichment ratio** — 1.1×–4×; a detection-rate ratio at or above it counts as enriched. It only re-labels results and does not require re-comparing.
3. Click **Compare** to scan; progress is shown and the scan can be cancelled. One row is listed per ion with each group's detection rate, mean intensity and their ratios, grouped into **A only**, **B only**, **A enriched**, **B enriched**, and **Shared**. Results can be filtered by category, sorted and paged; clicking a row switches the ion image and spectrum to that m/z.
4. Results are discarded when a region they were computed from is deleted or a KMeans run is repeated, so compare again after such changes.

Results can be exported: click **Export A/B only + enriched (annotated)** to save the annotated ions in A only / B only / A enriched / B enriched as a CSV (m/z, detection-rate ratio, intensity ratio, q-value, total score, candidate names) that opens in Excel. Run annotation first in [Data Annotation](./data-annotation).

![Compare regions](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127162723202.jpg_view)

### Using KMeans Clusters

1. First enable and run KMeans in [Visualization Toolbox > Clustering](./visualization-toolbox#clustering), choose the number of clusters, and get at least two clusters.

2. In **Compare regions**, check the two clusters into groups A and B, then click **Compare**.

   ![Comparison result](https://cdn.neonexus.top/docs/20260914161105137.jpg_view)

### Using ROIs for Comparison

First draw and save at least two ROIs in [Visualization Toolbox > Region of Interest (ROI)](./visualization-toolbox#region-of-interest-roi). Then in **Compare regions**, check ROI 1 into group A and ROI 2 into group B, and click **Compare**.

![ROI comparison](https://cdn.neonexus.top/docs/20260914161809308.jpg_view)