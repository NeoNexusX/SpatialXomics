# Database

The **Database** entry in the top navigation bar opens the platform's built-in reference databases. Browsing requires signing in — visitors are redirected to the sign-in page first and returned here afterwards.

**Author:** Chen Kejiang

**Feedback:** Found a bug or have a suggestion? Open a [GitHub Issue](https://github.com/NeoNexusX/MassVision/issues) or email **jydong@xmu.edu.cn**.

::: tip When the annotation service is down
Page data comes from the backend annotation service. When the service is unavailable, the page shows an error message — click **Retry** to reload; once the service recovers, retrying brings back the full database.
:::

## Search and Filters

The toolbar offers a keyword search plus two filters; all conditions combine with AND.

- **Keyword**: submit with **Search** or Enter. The keyword is matched against a single field, chosen by its shape: text starting with `HMDB` searches the **ID**; an element-symbols-with-counts pattern (e.g. `C7H11N3O2`) searches the **formula**; anything else searches the **name**. There is no cross-field search.
- **Origin**: pick Endogenous / Expected / Unknown / Exogenous from the dropdown; the search reruns immediately.
- **Mass**: enter a min / max mass (Da) as a closed interval; either side can be left empty. It takes effect on **Search** or Enter. Rows without a mass are excluded while a mass filter is active.

When any condition is set, a **Clear** button appears and resets the keyword and filters at once.

## Table

The current source is **HMDB 4.0 Metabolites**. Columns: ID, formula, name, InChI, mass, origin, PubChem, and HMDB.

- Mass keeps 4 decimal places and shows "—" when missing; origins display as Endogenous / Expected / Unknown / Exogenous.
- Long names and InChIs are truncated; the inline copy button copies the full value.
- The **PubChem** column opens a PubChem lookup dialog by compound name; the **HMDB** column opens the HMDB entry page in a new tab.
- The pagination footer switches pages and page size.

![Database page overview](https://cdn.neonexus.top/docs/20261021194635111.jpg_view)

## Using the Database for Annotation

This database plugs into annotation in [Data Visualization](./data-visualization) directly:

- **Direct import**: pick it from the **Platform** dropdown in the annotation panel — the full CSV is saved as a local file (the Chromium Save dialog defaults to the Downloads folder) and imported; importing again reuses the saved file instead of downloading it again.
- **Manual import**: the **Download full CSV** button on the right of the toolbar downloads the complete database (about 38.5 MB). Its header row is `ID,Name,Formula,InChI,Mass,Origin`, which matches the annotation-database template and can be imported as an annotation CSV.
