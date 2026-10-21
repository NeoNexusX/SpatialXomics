# Collections

Browse, create, and share collections — curated groups of public datasets with academic metadata and an ordered member list.

**Author:** Chen Kejiang

**Feedback:** Found a bug or have a suggestion? Open a [GitHub Issue](https://github.com/NeoNexusX/MassVision/issues) or email **jydong@xmu.edu.cn**.

## Open the Collections Page

Click **Datahub > Collections** in the navigation bar. The filter bars on the Public Datasets and My Datasets pages include a link to Collections, and the Collections page header includes buttons back to Public Datasets and My Datasets.

![8cdf16d5380095f9c84d8ed3bfb2e74c](https://cdn.neonexus.top/docs/20261008153852015.jpg_view)

## Browse & Find Collections

The list page shows collections from the whole platform by default; tick **My collections only** to see just the ones you created.

- **Search:** the search box matches collection names by keyword, across all pages.
- **Filter:** click **Add filter** to filter by collection name, title, journal, or creator username; **member type** and **collection type** are vocabulary multi-selects; vocabulary fields such as organism match collections that *contain* the value (multiple values within one field are OR-ed).
- **Sort:** the list is always ordered by last-updated time, newest first.

The list is paginated server-side; switch pages and page size at the bottom.

![13b1e2f9747350467b5909b9b7226cc7](https://cdn.neonexus.top/docs/20261008160300900.jpg_view)

## Collection Cards

Each card shows the cover image with organism chips, basic info (creator, created time, last updated), academic metadata such as DOI, title, journal, and access URL (collapsed into a "more" entry when long), and a **Public Collection** badge — every collection on the platform is public. To see only the collections you created, tick **My collections only** on the list page (see Browse & Find Collections).

Click **View Collection** to open the detail page in a new tab. **Share** copies the collection's public link (see Share below). Owners and admins can delete the collection (see Delete below).

![08d68cd0b3daf066d5a8050d5910ba95](https://cdn.neonexus.top/docs/20261008160355076.jpg_view)

## Create a Collection

Click **Create Collection** on the list page to start the four-step flow:

**Step 1 — Select datasets.** Pick members from completed public imzML datasets; search is supported, and selections persist across pages.

![image-20261008160500321](https://cdn.neonexus.top/docs/20261008160500400.jpg_view)

**Step 2 — Reorder.** Drag member cards or use the move up/down buttons to set the display order; remove a dataset to deselect it.

![9a30c6537827d8fbe01e8d5e3d3bee19](https://cdn.neonexus.top/docs/20261008160602518.jpg_view)

**Step 3 — Collection info.** Enter the collection **name** (required, max 80 characters) and **description** (optional, max 300 characters).

![image-20261008160820237](https://cdn.neonexus.top/docs/20261008160820287.jpg_view)

**Step 4 — Metadata.** Member type, collection type, and the sample/acquisition fields organism, organism part, sample stabilization, polarity, ionisation source, and analyzer are required. Sample and acquisition fields are auto-filled from the selected datasets; once you edit a field by hand it stops auto-updating, and **Reset to detected** restores the detected value. Citation fields (DOI, title, journal, access URL, publication time, citation, abstract) are all optional; a DOI must look like `10.1000/xyz123`, `doi:10.1000/xyz123`, or `https://doi.org/10.1000/xyz123`.

![A](https://cdn.neonexus.top/docs/20261008160932254.jpg_view)

![image-20261008161009263](https://cdn.neonexus.top/docs/20261008161009351.jpg_view)

::: warning
Collections are public as soon as they are created — the platform has no private collections. Leaving the creation flow mid-way prompts for confirmation; unsaved selections and entries will be lost.
:::

Click **Create Collection** to submit; you'll be redirected to the new collection's detail page.

## View & Edit a Collection

The detail page shows the name, description, full academic metadata, and the member list.

Owners and admins can click **Edit** to modify the name, description, and metadata in place, then click **Save Changes** to submit (only changed fields are sent). The name is required and capped at 80 characters; the description at 300.

![image-20261008161053722](https://cdn.neonexus.top/docs/20261008161053801.jpg_view)

![image-20261008161200282](https://cdn.neonexus.top/docs/20261008161200374.jpg_view)

## Manage Members

Owners and admins can manage members on the detail page:

- **Add Members:** pick public datasets and append them to the end of the list; datasets already in the collection are marked and cannot be selected again.

  <img src="https://cdn.neonexus.top/docs/20261008161234181.jpg_view" alt="image-20261008161234123" style="zoom:50%;" />

- **Remove Selected:** tick members and remove them; the toast reports how many were actually removed, and members already removed elsewhere are skipped with a separate note.

  ![e76d5da425ab50194ce54ed4ecee5868](https://cdn.neonexus.top/docs/20261008161347873.jpg_view)
- **Reorder:** in edit mode, drag members or use the move up/down buttons; if the order was changed elsewhere, the page shows a notice and refreshes to the latest order.
- **Limit:** a collection holds at most 300 datasets.
- **Download:** each member can be downloaded individually.

## Share a Collection

Click **Share** on the detail page to copy the collection's public link — an address starting with `/collections/` followed by the collection's public id. Anyone with the link can view a read-only page (member list and metadata) **without signing in**; if the collection does not exist or is no longer public, the page shows a unified notice.

Because collections are public upon creation, there is no separate visibility switch.

## Delete a Collection

Owners and admins can click **Delete** on the detail page and confirm the **Delete collection?** dialog. Deleting removes only the collection itself — the datasets inside are not affected.

![4f125424a255308135ef0e308677e516](https://cdn.neonexus.top/docs/20261008172114280.jpg_view)
