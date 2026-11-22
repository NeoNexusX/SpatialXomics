# SXO-Harness Agent

SXO-Harness is the conversational data-analysis agent built into SpatialXomics. It runs in the browser and answers questions about the dataset you have open: it reads ion images, statistics, annotations, clustering, and the current page selection, calls compound, pathway, literature, and web-search tools, and renders external sources as citation cards.

The agent only reads existing data and results. It does not start preprocessing, edit annotations, or run new clustering; use [Dataset Analysis](./dataset-analysis) and [Data Visualization](./data-visualization) for those operations.

## Open the panel

After signing in, open the nav ball in the bottom-right corner of a page that shows it (Home, the dataset visualization page, and other full-screen pages), then click the SXO icon. Pages that use the top navigation bar currently have no agent entry; open it from Home or the visualization page instead.

Drag the title bar to move the panel, drag any edge to resize it, and use the close button in the top-right corner to hide it. Closing the panel does not delete saved conversations.

## Configure a connection

With no usable connection, the panel opens directly on its **Connection** settings. There are only three things to fill in: the endpoint's **API address**, **API key**, and **model**.

Protocol is the first gate: the agent supports the Anthropic Messages protocol (`/v1/messages`) only. Any endpoint that implements it can be tried, regardless of model vendor; an address that offers only the OpenAI-style `/chat/completions` cannot be used directly (DeepSeek's default `https://api.deepseek.com` is one of these — see the example at the end of this section).

### Address and key

- **API address**: the endpoint's base address, such as `https://api.anthropic.com` or a relay address. Do not include a version segment or a request path; a trailing `/` and an accidentally included `/messages` are removed, and `/v1` is appended when no version segment is present. The resolved request URL is shown below the field so you can check it before saving.
- **API key**: stored only in this browser's `localStorage`, never sent to the platform backend. The address and key work as one pair: an address without a key is ignored, while a key with an empty address falls back to the official address `https://api.anthropic.com/v1`.
- A deployment can also provide defaults (`VITE_LLM_PROXY_URL` / `VITE_LLM_API_KEY` / `VITE_LLM_MODEL`). With deployment defaults in place you can chat immediately; filling in your own key switches to your own pair, and the deployment key is never sent to the address you enter.
- Once settings are saved, a **Clear** button appears; click it twice within 3 seconds to confirm.

### Choose a model

The agent only accepts models that can see images, so every model must pass a multimodal probe before it can be saved: it is sent a small image and must name its color. Two ways to do this:

- **Fetch models**: reads the endpoint's model list (`{API address}/models`) and tests the first 10 by default; click **Test more** for the rest, or **Test again** at any time.
- **Enter a model ID**: **Test** checks that single model directly against `/v1/messages`. Use this when the endpoint does not implement a model-list API (fetching the list returns 404).

Probe results fall into three cases: models that pass appear in the selectable list; **does not support images** means the endpoint rejects image input; **unavailable** means the probe could not finish, usually because of the key, quota, rate limiting, a server error, or a timeout — the UI does not show the specific cause.

After saving, the chat opens. Use the model menu on the left of the composer to switch between tested models, or open the connection settings again.

### Context limit and instructions

The bottom of the connection settings has two more fields:

- **Context limit**: the model's context window, 256,000 tokens by default. It is saved per endpoint and model and applies from the next turn.
- **Conversation instructions**: import a `.md` / `.txt` file (for example `AGENTS.md`, up to 64 KiB). Its text is added to the system prompt verbatim. Instructions belong to the current conversation and affect only that conversation.

### Example: DeepSeek

DeepSeek offers an Anthropic-compatible endpoint, so you can use it with your own DeepSeek quota:

1. Create an API key in the DeepSeek platform and make sure the account has a usable balance.

   ![DeepSeek platform API keys page](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261119160525696.jpg_view)

2. Set **API address** to `https://api.deepseek.com/anthropic`. Do not use `https://api.deepseek.com`: that is the OpenAI-compatible address, and requests land on a non-existent `/v1/messages` and return 404.
3. Set **API key** to the key from step 1.
4. Once the address and key are entered, models previously tested with the same pair are restored automatically; if `deepseek-flash` already appears in the selectable list, just select and save it.

   <img src="https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261119160734217.jpg_view" alt="Connection settings with the DeepSeek address, key, and deepseek-flash selected" style="zoom:80%;" />

5. If it does not appear, do not click **Fetch models**: DeepSeek's compatibility layer implements only `/v1/messages` and has no model-list endpoint, so this always returns 404. Enter `deepseek-flash` in the manual field, click **Test**, then select and save it once the probe passes. Once saved, the Harness Agent is ready to use.

   <img src="https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261119161017989.jpg_view" alt="SXO Harness Agent chat with deepseek-flash selected" style="zoom:80%;" />
6. `deepseek-flash` accepts image input and is the only DeepSeek model that passes the probe; `deepseek-v4-pro` is text-only and is reported as not supporting images.
7. This model's context window is 1,048,576 tokens; you can raise **Context limit** from its 256,000 default, and it applies from the next turn.

If the connection fails, the error carries an HTTP status:

| Symptom | Meaning | Fix |
| --- | --- | --- |
| Chat reports "invalid key (HTTP 401)"; manual test shows "unavailable" | The key is wrong, deleted, or lacks permission | Create a new key and test again |
| Chat reports "quota exhausted"; manual test shows "unavailable" | The account balance is insufficient | Top up and test again |
| "Address or model not found (HTTP 404)" | The address is missing `/anthropic`, or **Fetch models** was used | Check steps 2 and 5 |
| Chat reports "too many requests or quota exhausted (HTTP 429)" | Rate limited | Retry later |
| Manual test shows "unavailable" with none of the errors above | Server error, network problem, or probe timeout | Test again later; if it still fails, check your network and proxy |

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
| Compounds and pathways | PubChem compound and formula lookup, ChEBI, HMDB, KEGG pathway details and member compounds, plus the KEGG pathway map image; read lipid candidates generated in the annotation panel |
| Literature and web | Europe PMC and PubMed search with keywords built from the claim being checked, falling back to Exa web search when both are unavailable |
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
