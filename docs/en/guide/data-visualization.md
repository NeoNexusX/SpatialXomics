# Data Visualization

Explore ion images, TIC plots, and spectra interactively. Covers UMAP/KMeans clustering, ROI selection, region comparison, and annotation matching.

**Author:** Chen Kejiang

**Feedback:** Found a bug or have a suggestion? Open a [GitHub Issue](https://github.com/NeoNexusX/MassVision/issues) or email **jydong@xmu.edu.cn**.

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

![Page layout](https://cdn.neonexus.top/docs/20260911150203309.jpg_view)

1. **Ion intensity image** (center) — spatial heatmap of the selected m/z
2. **Pixel spectrum** (bottom) — mean spectrum or per-pixel spectrum
3. **Region comparison** (bottom panel) — compare two regions side by side
4. **Info & controls** (right sidebar) — metadata, display settings, clustering, ROIs
5. **Annotation panel** (left rail) — CSV-based annotation matching

## Right Sidebar Controls

### Info

Shows dataset metadata: Polarity, Analyzer, Ionisation Source, Pixel Size, Resolving Power, Matrix, Matrix Application, Solvent, Spectrum Mode, Storage Mode.

Below it, **Biological & Sample Info** shows the sample details entered at upload: organism, organism part, condition, growth conditions, stabilization, and tissue modification.

These come from the source dataset, so they also appear for preprocessed results. Fields left empty at upload are not shown.

### Display Range

- Enter Min/Max values directly.
- The current values are shown as percentiles (e.g., "95.23%").

### Statistic

- **Intensity histogram** — visualizes the intensity distribution; red lines mark the current Min/Max.
- **Dimensions** — image size (e.g., 100 × 80).
- **Non-zero** — number of pixels with non-zero intensity.
- **TIC** — total ion current.

### Preprocessing

Lists the processing methods applied to this result (e.g., "Direct conversion (no preprocessing)").

### Visualization Controls

Gamma correction is always available; UMAP / KMeans clustering is only available for continuous data.

| Control | Description |
|---|---|
| **Gamma** | Brightness/contrast curve. Range 0.5–1.5, default 1.0. |
| **Enable UMAP/KMeans** | First use requires confirmation; triggers a backend UMAP task. |
| **UMAP** | Overlay showing UMAP dimensionality reduction. |
| **KMeans** | Run KMeans on the UMAP embedding (k = 2–20). Runs locally in the browser. |
| **Opacity** | Adjust overlay transparency for UMAP and for KMeans separately. |
| **Export UMAP PNG / Export KMeans PNG** | Download the corresponding overlay as a PNG image. |
| **Clusters** | Toggle individual clusters on and off. |

### Region of Interest (ROI)

| Tool | Description |
|---|---|
| **Rect** | Drag to draw a rectangular ROI. |
| **Lasso** | Draw a freeform outline for an irregular ROI. |
| **Confirm / Cancel** | Finalize or discard the current draft. |
| **ROI only / Show all** | Toggle between showing only ROI pixels or the full image. |
| **ROI stats** | Each ROI shows: Pixels, Mean, Std, Min, Max. |
| **Delete / Clear all** | Remove individual ROIs or clear everything. |

### Mask Import & Export

Export ROI masks and KMeans clusters as a binary mask file, or import one and use it as a display filter.

| Control | Description |
|---|---|
| **Format** | Choose the mask file format. |
| **ROI masks / KMeans clusters** | Pick which regions to include. Checked regions are merged into a single binary mask. |
| **Export mask** | Download one mask file. Each file embeds the dataset name, shape, pixel size, and a SHA-256 digest over the pixel payload. |
| **Import mask** | Load a mask and apply it as a filter on the ion image. |
| **Apply Mask / Show Original** | Re-apply the imported mask, or suspend it and show the full image (appears after importing a mask). |
| **Clear imported mask** | Remove the imported mask. |

![Mask import & export](https://cdn.neonexus.top/docs/20261008182213629.jpg_view)

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
| **PNG** | Export the current image with a transparent background. |

### Display Range & Gamma (Right Strip)

- **Min/Max sliders** — drag to adjust contrast.
- **Gamma slider** — range 0.5–1.5, default 1.0.

## Multi-Ion Overlay

Continuous data can overlay several ions at once as separate colour channels. Enable **Overlay mode**, then add the current m/z as a channel — or use **Batch add m/z** and click peaks straight on the spectrum.

- Up to **10 channels**. Each channel is normalized on its own range and added as a colour.
- Per-channel controls cover visibility, colour, and opacity.
- Display Range, Colormap, and Gamma do not apply while an overlay is active; their controls are greyed out.

![Multi-ion overlay](https://cdn.neonexus.top/docs/20261008180949956.jpg_view)

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

Compare spectral differences between two regions (A vs. B). Regions can come from:

1. **KMeans clusters** (generated in the sidebar)
2. **User-drawn ROIs**

Set a minimum detection rate and an intensity threshold, then click **Compare**. Results are grouped into **A only**, **B only**, **A enriched**, **B enriched**, and **Shared**, with detection rates and mean intensities for both sides. Members of a group are combined (union) before comparing.

### Using KMeans Clusters

1. Open the **Visualization** section in the right sidebar and enable KMeans.

   ![KMeans controls](https://cdn.neonexus.top/docs/20260914160650461.jpg_view)

2. Choose the number of clusters.

   ![Cluster result](https://cdn.neonexus.top/docs/20260914160834781.jpg_view)

   ![Cluster overlay](https://cdn.neonexus.top/docs/20260914160853673.jpg_view)

3. Select two clusters to compare.

   ![Comparison result](https://cdn.neonexus.top/docs/20260914161105137.jpg_view)

### Using ROIs

1. Click **Rect** in the ROI section, draw a region, then click **Confirm** to create ROI 1.

   ![ROI 1](https://cdn.neonexus.top/docs/20260914161347733.jpg_view)

2. Click **ROI only** to reset the view, then draw another region to create ROI 2.

   ![ROI 2](https://cdn.neonexus.top/docs/20260914161613765.jpg_view)

3. Select both ROIs for comparison.

   ![ROI comparison](https://cdn.neonexus.top/docs/20260914161809308.jpg_view)

## Annotation Panel

Choose an annotation CSV in the collapsible left-side panel, then click **Start annotation**. The panel matches the peaks against theoretical adduct ions from that file, scores the matches, estimates the FDR, and adds spatial scores for the top-ranked annotations in the background. One table row is one adduct ion: different adduct ions of the same molecule are separate rows that link to each other.

::: warning Prerequisites
Annotation requires aligned **centroid** data (continuous storage) and a mean spectrum matching the m/z axis. The database is either a user-provided CSV or one of the platform's reference databases (see [Database](./database)), imported directly from the panel.
:::

### Choose the Database CSV and Peaks

Click **Choose annotation CSV** to open a local file, or open the **Import from platform** dropdown to pick one of the platform's reference databases (see [Database](./database)) — it fetches the full CSV online (the button shows the download progress) and imports it through the same parsing pipeline. Either way the database is read and saved in the current browser without being uploaded to a server. The panel can restore the last user-selected database, clear it, or open a replacement.

- The database template is `ID,Name,Formula,InChI,Mass`, one compound per row. `Formula` is required; `Mass` is the monoisotopic neutral mass in Da and is calculated from the formula when missing. Other columns are optional. Compounds sharing a formula are grouped as candidates.
- An optional `Origin` column labels where a compound comes from: `endogenous`, `expected` (expected endogenous), `unknown` or `exogenous`. Candidates of a formula are listed in that order, keeping the file order within a level, and the first one is the displayed name. Origin only sets this order and the labels; it is not part of the total score and does not change q-values. Without the column, candidates keep the file order.
- **Encoding**: UTF-8 (with or without BOM) and GBK/GB18030; the delimiter is detected automatically.
- Peaks come directly from the dataset's mean spectrum. Zero-intensity points are excluded; the slider drops the weakest 0–99% by intensity rank (default 0%). The percentage counts peaks and takes effect when the slider is released. Every retained peak has its original m/z-axis index for ion images and navigation.
- Click **Start** beside **Spatial scoring** to run annotation. Opening the panel, returning to a result, or changing the database, peak filter, tolerance, spatial percentage, score weights or adducts never starts matching automatically. Changed conditions clear the previous results and require another click. Each result remembers only its settings.

### Conditions

The conditions card summarizes the settings used and collapses to a one-line summary after the first result.

- **Dataset**: polarity, ion source, matrix, analyzer and solvent from the dataset metadata. If the polarity is missing, choose it here.
- **Tolerance**: when left empty, the default comes from the analyzer (Orbitrap 5 ppm, FTICR 3 ppm, timsTOF/Q-TOF 10 ppm, TOF 20 ppm, 10 ppm if unknown). You can enter your own value in ppm or Da.
- **Score weights**: three inputs for mass : adduct fit : spatial, each at least 0.1 with decimals allowed; the three must add up to 10, defaulting to 6 : 1 : 3. Each total-score weight is its value divided by 10 (0.6 / 0.1 / 0.3 by default). Entries outside 0.1–9.8 are ignored; clearing an input restores its default, and the button beside the inputs restores 6 : 1 : 3. While the sum is not 10, the inputs are outlined in red and annotation cannot start. Click **Start** to rerun after changes; q-values are re-estimated from the new total scores.
- **Adducts**: filtered by polarity, then each adduct gets a fit (0–1) from the ion source, matrix and solvent additives; adducts with fit 0 are not enabled. Expand the multi-select list to check or uncheck individual adducts. Automatic and manual selections retain their colors; each row shows its fit, with mass shift and conditions available on hover.

| Adduct | Default fit | Conditions |
| --- | --- | --- |
| [M+H]⁺ | 1.0 | Any ion source |
| [M+Na]⁺ | 0.8 | 0.9 for MALDI/LDI; 1.0 with a sodium salt in the solvent |
| [M+K]⁺ | 0.6 | 0.9 for MALDI/LDI |
| [M+NH₄]⁺ | — | 0.8 with ammonium in the solvent |
| [M+Li]⁺ | — | 0.9 with lithium in the solvent |
| [M+Ag]⁺ | — | 1.0 with a silver-nanoparticle matrix or silver salt in the solvent |
| [M−H]⁻ | 1.0 | Any ion source |
| [M+Cl]⁻ | 0.7 | 0.8 for ESI-type sources; 0.9 with chloride in the solvent; 1.0 with NEDC matrix |
| [M+HCOO]⁻ | — | 0.8 with formate in the solvent |
| [M+CH₃COO]⁻ | — | 0.8 with acetate in the solvent |

[M+H−H₂O]⁺, [M−H−H₂O]⁻ and similar adducts are never enabled automatically; turn them on manually.

### Scoring & FDR

The total score of a row is a weighted sum of three parts. The weights can be changed under **Score weights** in Conditions (above); the table lists the defaults, and the detail card's score breakdown shows the weights used by the current run:

| Part | Default weight | Meaning |
| --- | --- | --- |
| Mass | 0.6 | Higher for smaller mass errors (1 at zero error, about 0.14 at the tolerance edge) |
| Adduct fit | 0.1 | How well the adduct suits the acquisition conditions |
| Spatial | 0.3 | 0.2 × spatial chaos + 0.8 × same-molecule co-localization (below) |

The FDR is estimated with a target-decoy approach: each formula is also paired with chemically implausible adducts (such as [M+Pt]⁺) as decoys, which go through the same matching and scoring. Each row gets a q-value; smaller is more credible.

### Spatial Scoring

By default, the panel loads ion images for every matched molecule group. In **Conditions**, **Spatial scoring** is a percentage, defaulting to 100%. For example, 20% selects the initial top 20% of matches (rounded up) and scores every ion in their molecule groups; 0% skips spatial scoring. After changes, click **Start** on the right to run annotation; settings are remembered per result page. It computes two parts:

- **Spatial chaos** (METASPACE's level-set method): coherent, blob-like distributions score high; scattered noise scores low. Every row in the selected scope gets it, with or without other adducts.
- **Same-molecule co-localization**: the panel computes Pearson correlation r between the molecule's adduct ion images, using pixels where either image is non-zero, and takes the largest correlation strictly greater than 0.1. Correlations at or below 0.1 contribute 0. The hover card hides sibling-ion rows with r < 0.1 and hides the section if no rows remain. Spatial = 0.2 × chaos + 0.8 × coloc. Missing or unavailable co-localization counts as 0, so a molecule with a single detected adduct has a maximum spatial score of 0.2.

Scores update in place while this runs; when it finishes, rows are re-ranked and q-values are updated. Click **re-rank now** to re-rank earlier. By default all target and decoy groups are scored; with a limit, decoys use the same initial score threshold. Unscheduled, pending or failed spatial scores count as 0 and add nothing to the total.

### Table & Detail Card

- Each row has two lines: the name (+N means N more candidate names for the same formula) and the q-value, colored by level (green ≤10%, yellow ≤20%, gray otherwise); then the adduct, observed m/z and mass error. Hover the q-value to see the total score.
- When the database has an `Origin` column, the small label after the name shows the origin of the displayed name: Endo, Expected or Exo (unknown is not shown). Exo means every candidate of that formula is exogenous.
- The small chips at the end of the second line are other adduct ions of the same molecule; click one to jump to its row. Hovering a row lightly highlights the other rows of the same molecule. The stacked layers icon indicates multiple annotation results for the same peak.
- **Click a row** to switch the ion image to its m/z and highlight the spectrum peak.
- **Hover a row** for about 1 s to open the detail card (it can be pinned). From top to bottom: q-value, total score with rank, and mass error; a score table listing raw scores, total-score weights and contributions for mass, adduct fit, spatial, and its chaos and co-localization components; observed and theoretical m/z to 6 decimal places and intensity sit immediately below the total; the other adduct ions of the molecule with their spatial r against this ion, each with a circular-arrow jump button, with a primary-color "Only this" button beside the section heading; other annotations on the same peak, ordered by origin and then rank, also with circular-arrow jump buttons; candidate compounds with their origin labels and database IDs (well-known IDs such as HMDB open the database page), InChI copy and PubChem lookup. Uncomputed spatial scores and their total-score contributions both read 0; uncomputed chaos and co-localization read "–".
- **q-value levels** (≤5% / ≤10% / ≤20% / All) sit above the table, each with its row count.
- **Filter**: the button next to the search box opens an adduct multi-select list, rows with sibling ions, and sorting (total score by default, q-value, spatial score, mass error, m/z, intensity, or origin with endogenous first and rank within a level, with a reverse button). Select multiple adducts to keep any of those ions, or clear the selection to show all. The button shows how many of these differ from the defaults. Search covers name, formula and m/z; the detail card also offers "Show only this molecule".

Click **PubChem** to open a lookup dialog that searches PubChem by compound name and shows the structure, CID, IUPAC name, SMILES, and InChIKey, with copy buttons and a link to the PubChem page.

<img src="https://cdn.neonexus.top/docs/20261009151838139.jpg_view" alt="image-20261009151838061" style="zoom: 50%;" />

### Export

The **Download** button exports the current table (filters and sort applied) as `<runId>_annotations.csv`: one row per ion with the origin of the displayed name (Origin), the candidate compounds and IDs, all scores, the q-value, the other adduct ions of the same molecule (with r), and other annotations on the same peak.
