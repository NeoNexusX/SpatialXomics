# Visualization Toolbox

The Toolbox sits on the right side of the data visualization page. It stays collapsed as a narrow strip until you click **Toolbox**; sections inside it are collapsed by default and expand when you click their headings. The ⓘ icon next to a heading or parameter shows its help text (press Esc to close).

Back to [Data Visualization](./data-visualization).

**Author:** Chen Kejiang

**Feedback:** Found a bug or have a suggestion? Open a [GitHub Issue](https://github.com/NeoNexusX/SpatialXomics/issues) or email **jydong@xmu.edu.cn**.

## Info

Shows dataset metadata: Polarity, Analyzer, Ionisation Source, Pixel Size, Resolving Power, Matrix, Matrix Application, Solvent, Spectrum Mode, Storage Mode.

Below it, **Biological & Sample Info** shows the sample details entered at upload: organism, organism part, condition, growth conditions, stabilization, and tissue modification.

These come from the source dataset, so they also appear for preprocessed results. Fields left empty at upload are not shown. **Preprocessing** at the end of the block lists the processing methods applied to this result (e.g., "Direct conversion (no preprocessing)").

![Info](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127160527037.jpg_view)

## Intensity

- **Intensity histogram** — visualizes the intensity distribution; red lines mark the current Min/Max.
- **Dimensions** — image size (e.g., 100 × 80).
- **Non-zero** — number of pixels with non-zero intensity.
- **TIC** — total ion current.
- **Max / Min** — enter values directly; the current percentile is shown alongside (e.g., "95.23%").
- **Gamma** — brightness/contrast curve. Range 0.5–1.5, default 1.0.

The intensity strip beside the image is described in [Data Visualization > Ion Intensity Image > Intensity Strip & Gamma](./data-visualization#intensity-strip-gamma).

![Intensity](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127160548178.jpg_view)

## Multi-Ion Overlay

Continuous data can overlay several ions at once as separate colour channels. Enable **Overlay mode**, then add the current m/z as a channel — or use **Batch add m/z** and click peaks straight on the spectrum.

- Up to **10 channels**. Each channel is normalized on its own range and added as a colour.
- Per-channel controls cover visibility, colour, and opacity.
- Display Range, Colormap, and Gamma do not apply while an overlay is active; their controls are greyed out.

![Multi-ion overlay](https://cdn.neonexus.top/docs/20261008180949956.jpg_view)

## Clustering

UMAP / KMeans clustering is available for continuous data; the first time you enable it you are asked to confirm, and a backend UMAP task is created.

Save an ROI (or import a mask) first, then pick it under **Scope** in the Clustering block: KMeans clusters only the pixels inside it; choose **All pixels** to cluster the whole image. A scope with fewer than 2 clusterable pixels cannot be run.

| Control | Description |
|---|---|
| **Enable UMAP/KMeans** | First use requires confirmation; triggers a backend UMAP task. |
| **UMAP** | Overlay showing UMAP dimensionality reduction. |
| **KMeans** | Run KMeans on the UMAP embedding (k = 2–20). Runs locally in the browser. |
| **Scope** | With an ROI selected, only pixels inside it are clustered; **All pixels** clusters the whole image. An ROI with fewer than 2 pixels cannot be clustered and a message is shown. |
| **Opacity** | Adjust overlay transparency for UMAP and for KMeans separately. |
| **Export UMAP PNG / Export KMeans PNG** | Download the corresponding overlay as a PNG image. |
| **Clusters** | Toggle individual clusters on and off. |

Enable and run KMeans in the Clustering section, then choose the number of clusters:

![KMeans controls](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127162239718.jpg_view)

![Cluster result](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127162317073.jpg_view)

![Cluster overlay](https://cdn.neonexus.top/docs/20260914160853673.jpg_view)

**UMAP overlay:**

![UMAP overlay](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127160627242.jpg_view)

**KMeans overlay:**

![KMeans overlay](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127160720811.jpg_view)

After clustering, compare clusters in [Data Visualization > Region Comparison](./data-visualization#region-comparison).

## Region of Interest (ROI)

An ROI is built in a draft from one or more shapes, then saved to the ROI list.

| Tool | Description |
|---|---|
| **Rect / Ellipse** | Drag on the ion image to draw a rectangle or an ellipse (hold Shift for a circle). Before confirming, drag a corner to resize or the center to move. |
| **Segments** | Click to place vertices. Click the first point or press Enter to close. |
| **Freehand** | Drag to trace. Release to pause and resume from the endpoint. Click the first point or press Enter to close. |
| **Collect** | Select the pixels with or without signal in the current ion image, or all acquired pixels. |
| **Add / Subtract / Intersect** | How the next shape combines with the draft. |
| **Use an existing region** | Add a saved ROI or a KMeans cluster to the draft as a shape. |
| **Confirm shape / Discard shape** | Apply the current shape to the draft, or drop it. |
| **Undo / Redo** | Step back or forward through the draft (Ctrl/⌘+Z, Shift+Ctrl/⌘+Z). |
| **Save ROI / Cancel draft** | Save the draft as an ROI, or discard the whole draft. |
| **ROI list** | Checked ROIs are filled in their colors on the image and included in the exported mask. Each ROI has its own opacity and shows its pixel count, Mean, Std, Min and Max. |
| **ROI only / Show all** | Toggle between showing only ROI pixels or the full image. |
| **Delete / Clear all** | Remove individual ROIs or clear everything. |

**Four ROI drawing tools** — pick whichever suits the region (you can also collect pixels with or without signal, or all acquired pixels, from the current ion image):

![ROI tools](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127160910260.jpg_view)

Drawn shapes can also be combined: **Add, Subtract or Intersect** them, then save the result as one ROI. For example, the ROI below subtracts the ellipse on the right from the rectangle on the left:

![ROI combination before saving](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127161821957.jpg_view)

Once saved:

![ROI combination saved](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127161855527.jpg_view)

After saving ROIs, compare them in [Data Visualization > Region Comparison](./data-visualization#region-comparison).

## Region Masks

Export ROI masks and KMeans clusters as a binary mask file, or import mask files as ROIs.

| Control | Description |
|---|---|
| **Format** | Choose the mask file format (.npz / .csv). |
| **To export** | The ROIs checked in the ROI list, plus the checked clusters while KMeans is shown. They are merged into a single binary mask. |
| **Export mask** | Download one mask file. Each file embeds the dataset name, shape, pixel size, and a SHA-256 digest over the pixel payload. |
| **Import mask** | Load mask files. Each one becomes an entry in the ROI list (tagged “Imported”) and works like a drawn ROI. |

Check the ROIs and/or clusters to export; the example below selects ROI 2, Cluster 2 and Cluster 3:

![Mask export selection](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127162130003.jpg_view)