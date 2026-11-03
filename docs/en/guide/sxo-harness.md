# SXO-Harness Agent

SXO-Harness is the conversational data-analysis agent built into SpatialXomics. It runs in the browser and answers questions about the dataset you have open: it reads ion images, statistics, annotations, clustering, and the current page selection, calls compound, pathway, literature, and web-search tools, and renders external sources as citation cards.

The agent only reads existing data and results. It does not start preprocessing, edit annotations, or run new clustering; use [Dataset Analysis](./dataset-analysis) and [Data Visualization](./data-visualization) for those operations.

## Open the panel

After signing in, open the nav ball in the bottom-right corner of a page that shows it (Home, the dataset visualization page, and other full-screen pages), then click the SXO icon. Pages that use the top navigation bar currently have no agent entry; open it from Home or the visualization page instead.

Drag the title bar to move the panel, drag any edge to resize it, and use the close button in the top-right corner to hide it. Closing the panel does not delete saved conversations.

## Configure a connection

With no usable connection, the panel opens directly on its **Connection** settings. The agent currently supports only endpoints that speak the Anthropic Messages protocol (`/v1/messages`); OpenAI Chat Completions and other protocols cannot be used directly.

### Address and key

- **API address**: an endpoint that offers `/v1/messages`, such as `https://api.anthropic.com` or a relay address. A trailing `/v1` is optional, an accidentally included `/messages` is removed, and the resolved request URL is shown below the field.
- **API key**: stored only in this browser's `localStorage`, never sent to the platform backend. The address and key work as one pair: an address without a key is ignored, while a key with an empty address falls back to the protocol's official address.
- A deployment can also provide defaults (`VITE_LLM_PROXY_URL` / `VITE_LLM_API_KEY` / `VITE_LLM_MODEL`). With deployment defaults in place you can chat immediately; fill in your own address and key to use your own quota.
- Once settings are saved, a **Clear** button appears; click it twice within 3 seconds to confirm.

### Choose a model

Click **Fetch models** to list the endpoint's models and send each a small image to probe multimodal support. The agent needs a model that can see images, so only models that pass the test can be selected and saved.

- The first 10 models are tested by default; click **Test more** for the rest, or **Test again** at any time.
- You can also enter a model ID manually and click **Test** to check that model alone.
- Models reported as not supporting images, or unavailable, never appear in the selectable list.
- After saving, the chat opens. Use the model menu on the left of the composer to switch between tested models, or open the connection settings again.

### Context limit and instructions

The bottom of the connection settings has two more fields:

- **Context limit**: the model's context window, 256,000 tokens by default. It is saved per endpoint and model and applies from the next turn.
- **Conversation instructions**: import a `.md` / `.txt` file (for example `AGENTS.md`, up to 64 KiB). Its text is added to the system prompt verbatim. Instructions belong to the current conversation and affect only that conversation.

## Chat

### Input and images

- Press `Enter` to send and `Shift + Enter` for a new line. An Enter that confirms an IME candidate does not send.
- Click the image button or paste a screenshot to attach PNG, JPEG, or WebP images — up to 4 per message. Images whose longest edge exceeds 1,568 px are scaled down first.
- Replies support Markdown, formulas, code blocks, and expandable tool steps. Source links render as citation cards and open in a new tab.

### Run, stop, and retry

After you submit, the panel shows the reasoning and each tool call. You can stop a running turn; the last answer can be retried, and a retry keeps the original page selection.

### Context usage

The percentage chip at the bottom-right of the composer shows how much of the context window is in use. Open it to see cumulative input/output tokens for the conversation and to **Compact context** manually. As the limit approaches, earlier turns are compacted into a summary automatically; the UI keeps the original messages, but the model then sees only the summary.

## Dataset context

When the panel is opened on the dataset visualization page, it connects to the current dataset automatically. Each question captures the selected ion, clusters, pixel, and annotation selection at submission time, and the model uses them for the page tools. If you change the selected ion, pixel, or clusters after asking, the old question keeps its old selection; ask again to capture the new one.

You can also chat on pages without a dataset context, such as Home. In that case general answers, file and quota lookups, compound/literature lookups, and web search still work; tools that depend on the page have no dataset to read.

## Capabilities

### Tools

| Area | What it can do |
| --- | --- |
| Page and data | Read the current page state and selection, dataset overview, one or many ion images (up to 9 m/z values, returned separately or as a montage), ion images for annotation rows, ion-intensity statistics, top mean-spectrum peaks, a pixel spectrum, KMeans/UMAP summaries, and the annotation list or details |
| Files and account | List public/personal files, read file metadata, list processing tasks, and check user quota |
| Compounds and pathways | PubChem compound and formula lookup, ChEBI, HMDB, KEGG pathways and pathway rollups; read lipid candidates generated in the annotation panel |
| Literature and web | PubMed, Europe PMC, OpenAlex, and Exa web search |
| Conversation | Read archived tool results that were shortened, and load skill instructions on demand |

Web search uses Exa's hosted MCP and the anonymous allowance by default; a deployment can set `VITE_EXA_API_KEY` for a higher allowance. Search results contain URLs and excerpts, not full-text reads.

### Skills

An empty conversation offers **Annotation review** and **MSI analysis** shortcuts. The model also loads bundled skill instructions as needed:

- `annotation-review`: review, compare, and rank existing annotations
- `msi-analysis`: analyze the current dataset, assess data quality, or write an analysis report
- `ion-image-interpretation`: interpret ion images and spatial patterns
- `adduct-isotope-analysis`: assess adduct and same-formula ion evidence
- `metabolite-biology`: explain metabolites with HMDB, KEGG, and literature
- `literature-evidence`: retrieve and grade published evidence
- `web-research`: search the web for current information and official documentation

## Conversation management

The conversation menu in the title bar keeps conversations per dataset, with at most 3 per dataset. You can switch, start a new one, delete, export, and import:

- **Export** creates a ZIP with the conversation log and image attachments; exporting works while a turn is running.
- **Import** writes a ZIP into the current dataset after validating file integrity and image references.
- While a conversation is running you cannot switch, create, or delete; stop the current answer first.
- The same conversation opened in another tab is read-only there, so two tabs never write at once.
- If the browser does not support OPFS (some private-browsing modes), the agent uses a temporary conversation and warns that a reload will not restore it.

## Privacy and limitations

- Conversations, images, and the connection key stay in this browser; model requests go directly to the endpoint you configure. Tools send the necessary queries (for example annotations, compounds, literature, or search terms) to their respective services.
- A deployment's `VITE_LLM_API_KEY` and `VITE_EXA_API_KEY` are compiled into the browser bundle and must be restricted sub-keys only.
- Never put private sample identifiers, unpublished data, or credentials into a question or a web search.
- The model can be wrong. Citations should only use sources actually returned by a tool, and you should still verify the original paper or database entry.
