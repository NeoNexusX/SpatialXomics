# Data Annotation

The annotation panel sits on the left side of the data visualization page and can be expanded or collapsed. This page covers matching, scoring, viewing, and exporting annotations for existing peaks. Back to [Data Visualization](./data-visualization).

**Author:** Chen Kejiang

**Feedback:** Found a bug or have a suggestion? Open a [GitHub Issue](https://github.com/NeoNexusX/SpatialXomics/issues) or email **jydong@xmu.edu.cn**.

Choose an annotation CSV, then click **Start annotation**. The panel matches the peaks against theoretical adduct ions from that file, scores the matches, estimates the FDR, and adds spatial scores for the top-ranked annotations in the background. One table row is one adduct ion: different adduct ions of the same molecule are separate rows that link to each other.

## Prerequisites

::: warning Prerequisites
Annotation requires aligned **centroid** data (continuous storage) and a mean spectrum matching the m/z axis. The database is either a user-provided CSV or one of the platform's reference databases (see [Database](./database)), imported directly from the panel.
:::

## Choose the Database CSV and Peaks

Click **Choose annotation CSV** to open a local file, or open the **Platform** dropdown to pick one of the platform's reference databases (see [Database](./database)). On Chromium browsers a Save dialog opens **defaulting to the system Downloads folder** (one click on Save; the button shows the download progress), the full CSV is saved as a local file, and then imported; importing again — even after clearing the current database — reuses the saved file without downloading it again, and only re-fetches when the file is deleted or the server copy changes. Firefox and Safari do not support file handles, so they still download and import in one step. Either way the database is read and saved in the current browser without being uploaded to a server. The panel can restore the last user-selected database, clear it, or open a replacement.

- The database template is `ID,Name,Formula,InChI,Mass`, one compound per row. `Formula` is required; `Mass` is the monoisotopic neutral mass in Da and is calculated from the formula when missing. Other columns are optional. Compounds sharing a formula are grouped as candidates.
- An optional `Origin` column labels where a compound comes from: `endogenous`, `expected` (expected endogenous), `unknown` or `exogenous`. Candidates of a formula are listed in that order, keeping the file order within a level, and the first one is the displayed name. Origin only sets this order and the labels; it is not part of the total score and does not change q-values. Without the column, candidates keep the file order.
- **Encoding**: UTF-8 (with or without BOM) and GBK/GB18030; the delimiter is detected automatically.
- Peaks come directly from the dataset's mean spectrum. Zero-intensity points are excluded; the slider drops the weakest 0–99% by intensity rank (default 0%). The percentage counts peaks and takes effect when the slider is released. Every retained peak has its original m/z-axis index for ion images and navigation.
- Click **Start** beside **Spatial scoring** to run annotation. Opening the panel, returning to a result, or changing the database, peak filter, tolerance, spatial percentage, score weights or adducts never starts matching automatically. Changed conditions clear the previous results and require another click. Each result remembers only its settings.

  **Example annotation result:**

  ![Annotation example](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127163049647.jpg_view)

## Conditions

The conditions card summarizes the settings used and collapses to a one-line summary after the first result.

### Dataset and Tolerance

- **Dataset**: polarity, ion source, matrix, analyzer and solvent from the dataset metadata. If the polarity is missing, choose it here.
- **Tolerance**: when left empty, the default comes from the analyzer (Orbitrap 5 ppm, FTICR 3 ppm, timsTOF/Q-TOF 10 ppm, TOF 20 ppm, 10 ppm if unknown). You can enter your own value in ppm or Da.

### Score Weights

Three inputs for mass : adduct fit : spatial, each at least 0.1 with decimals allowed; the three must add up to 10, defaulting to 4 : 2 : 4. Each total-score weight is its value divided by 10 (0.4 / 0.2 / 0.4 by default). Entries outside 0.1–9.8 are ignored; clearing an input restores its default, and the button beside the inputs restores 4 : 2 : 4. While the sum is not 10, the inputs are outlined in red and annotation cannot start. Click **Start** to rerun after changes; q-values are re-estimated from the new total scores.

### Adducts

Filtered by polarity, then each adduct gets a fit (0–1) from the ion source, matrix and solvent additives; adducts with fit 0 are not enabled. Expand the multi-select list to check or uncheck individual adducts. Automatic and manual selections retain their colors; each row shows its fit, with mass shift and conditions available on hover.

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

## Scoring & FDR

The total score of a row is a weighted sum of three parts. The weights can be changed under **Score weights** in Conditions (above); the table lists the defaults, and the detail card's score breakdown shows the weights used by the current run:

| Part | Default weight | Meaning |
| --- | --- | --- |
| Mass | 0.4 | Higher for smaller mass errors (1 at zero error, about 0.14 at the tolerance edge) |
| Adduct fit | 0.2 | How well the adduct suits the acquisition conditions |
| Spatial | 0.4 | 0.2 × spatial chaos + 0.8 × same-molecule co-localization (below) |

The FDR is estimated with a target-decoy approach: each formula is also paired with chemically implausible adducts (such as [M+Pt]⁺) as decoys, which go through the same matching and scoring. Each row gets a q-value; smaller is more credible.

## Spatial Scoring

By default, the panel loads ion images for every matched molecule group. In **Conditions**, **Spatial scoring** is a percentage, defaulting to 100%. For example, 20% selects the initial top 20% of matches (rounded up) and scores every ion in their molecule groups; 0% skips spatial scoring. After changes, click **Start** on the right to run annotation; settings are remembered per result page. It computes two parts:

- **Spatial chaos** (METASPACE's level-set method): coherent, blob-like distributions score high; scattered noise scores low. Every row in the selected scope gets it, with or without other adducts.
- **Same-molecule co-localization**: the panel computes Pearson correlation r between the molecule's adduct ion images, using pixels where either image is non-zero, and takes the largest correlation strictly greater than 0.1. Correlations at or below 0.1 contribute 0. The hover card hides sibling-ion rows with r < 0.1 and hides the section if no rows remain. Spatial = 0.2 × chaos + 0.8 × coloc. Missing or unavailable co-localization counts as 0, so a molecule with a single detected adduct has a maximum spatial score of 0.2.

Scores update in place while this runs; when it finishes, rows are re-ranked and q-values are updated. Click **re-rank now** to re-rank earlier. By default all target and decoy groups are scored; with a limit, decoys use the same initial score threshold. Unscheduled, pending or failed spatial scores count as 0 and add nothing to the total.

## Viewing and Filtering Results

### Table and Spectrum Linking

- Each row has two lines: the name (+N means N more candidate names for the same formula) and the q-value, colored by level (green ≤10%, yellow ≤20%, gray otherwise); then the adduct, observed m/z and mass error. Hover the q-value to see the total score.
- When the database has an `Origin` column, the small label after the name shows the origin of the displayed name: Endo, Expected or Exo (unknown is not shown). Exo means every candidate of that formula is exogenous.
- The small chips at the end of the second line are other adduct ions of the same molecule; click one to jump to its row. Hovering a row lightly highlights the other rows of the same molecule. The stacked layers icon indicates multiple annotation results for the same peak.
- **Click a row** to switch the ion image to its m/z and highlight the spectrum peak.

### Detail Card

**Hover a row** for about 1 s to open the detail card (it can be pinned). From top to bottom: q-value, total score with rank, and mass error; a score table listing raw scores, total-score weights and contributions for mass, adduct fit, spatial, and its chaos and co-localization components; observed and theoretical m/z to 6 decimal places and intensity sit immediately below the total; the other adduct ions of the molecule with their spatial r against this ion, each with a circular-arrow jump button, with a primary-color "Only this" button beside the section heading; other annotations on the same peak, ordered by origin and then rank, also with circular-arrow jump buttons; candidate compounds with their origin labels and database IDs (well-known IDs such as HMDB open the database page), InChI copy and PubChem lookup. Uncomputed spatial scores and their total-score contributions both read 0; uncomputed chaos and co-localization read "–".

### Filters and Sorting

- **q-value levels** (≤5% / ≤10% / ≤20% / All) sit above the table, each with its row count.
- **Filter**: the button next to the search box opens an adduct multi-select list, rows with sibling ions, and sorting (total score by default, q-value, spatial score, mass error, m/z, intensity, or origin with endogenous first and rank within a level, with a reverse button). Select multiple adducts to keep any of those ions, or clear the selection to show all. The button shows how many of these differ from the defaults. Search covers name, formula and m/z; the detail card also offers "Show only this molecule".

### PubChem Lookup

Click **PubChem** to open a lookup dialog that searches PubChem by compound name and shows the structure, CID, IUPAC name, SMILES, and InChIKey, with copy buttons and a link to the PubChem page.

<img src="https://cdn.neonexus.top/docs/20261009151838139.jpg_view" alt="PubChem lookup dialog" style="zoom: 50%;" />

## Exporting Annotations

The **Download** button exports the current table (filters and sort applied) as `<runId>_annotations.csv`: one row per ion with the origin of the displayed name (Origin), the candidate compounds and IDs, all scores, the q-value, the other adduct ions of the same molecule (with r), and other annotations on the same peak.