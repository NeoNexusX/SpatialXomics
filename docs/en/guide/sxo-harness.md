# SXO-Harness Agent

SXO-Harness is the conversational data-analysis agent built into SpatialXomics. Open it after signing in from a page that shows the nav ball, such as the dataset visualization page, and ask about the current dataset. It reads ion images, statistics, annotations, clustering, and the current page selection, calls compound, pathway, literature, and web-search tools, and shows external sources as citation cards.

The agent only reads existing data and results. It does not start preprocessing, edit annotations, or run new clustering; see [Dataset Analysis](./dataset-analysis) for preprocessing, [Data Annotation](./data-annotation) for annotations, and [Visualization Toolbox](./visualization-toolbox) for clustering.

## Open the panel

After signing in, open the nav ball in the bottom-right corner of a page that shows it (for example, the dataset visualization page), then click the SXO icon.

![SXO entry in the nav ball](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261119160338194.jpg_view)

Drag the title bar to move the panel, drag any edge to resize it, and use the close button in the top-right corner to hide it. Closing the panel does not delete saved conversations.

## Configure a connection

With no usable connection, the panel opens directly on its **Connection** settings. Fill in three fields: **API address**, **API key**, and **model**. The connection must support the Anthropic Messages protocol.

<img src="https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261119160442614.jpg_view" alt="API address, API key, and model fields in the connection settings" style="zoom: 80%;" />

### Address and key

- **API address**: enter the full address, for example `https://api.deepseek.com/anthropic`.
- **API key**: stored only in this browser and never sent to the platform backend.
- After saving, **Clear** appears at the bottom left; click it twice within 3 seconds to confirm.

### Choose a model

The agent accepts multimodal models only. Before a model can be saved, it must pass an image-input test: the agent sends an image, and the model must name its color.

- **Fetch models**: reads the endpoint's model list and tests the first 10 by default; click **Test more** for the rest, or **Test again** at any time.
- **Enter a model ID**: **Test** checks only that model. Use this when fetching the list returns 404.

Results fall into three cases: models that pass appear in the selectable list; **does not support images** means the endpoint rejects image input; **unavailable** means the test did not finish, usually because of the key, balance, rate limiting, a server error, or a timeout.

Select a model and click **Save**. Afterwards, use the model menu at the left of the composer to switch to another tested model, or reopen the connection settings.

### Context limit and preset instructions

The bottom of the connection settings has two more fields:

- **Context limit**: set the context window according to the model's official documentation. It is saved per endpoint and model and applies from the next turn. If you do not set it, the product default is used.
- **Preset instructions** (currently labeled **Conversation instructions** in the interface): optional and not imported by default. To customize how the agent answers, import a `.md` or `.txt` file (up to 64 KiB). Its content applies only to the current conversation.

### Example: DeepSeek

1. Create an API key in the DeepSeek platform and make sure the account is usable.

   ![API keys page in the DeepSeek platform](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261119160525696.jpg_view)

2. Set **API address** to `https://api.deepseek.com/anthropic`.
3. Set **API key** to the key from step 1. Models previously tested with the same address and key are restored automatically, so there is no need to test them again.
4. Enter a model ID in the manual field, for example `deepseek-flash`, and click **Test**. Check DeepSeek's official model list for the model IDs available to you; the model must support image input.
5. Once the test passes, select the model. In **Context limit**, enter the value from the model's official documentation (for example, `1000000` if it documents a 1M-token context window), then click the **Save** button next to it.

   <img src="https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261119160734217.jpg_view" alt="Connection settings with the DeepSeek address, key, and deepseek-flash selected" style="zoom:80%;" />

6. Click **Save** at the bottom of the panel to open the chat.
7. Start asking questions.

   <img src="https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261119161017989.jpg_view" alt="SXO-Harness chat with deepseek-flash selected" style="zoom:80%;" />

If the connection fails, check the HTTP status in the error:

| Symptom | Meaning | Fix |
| --- | --- | --- |
| Chat reports "invalid key (HTTP 401)"; manual test shows "unavailable" | The key is wrong, deleted, or lacks permission | Create a new key and test again |
| Chat reports "quota exhausted"; manual test shows "unavailable" | The account balance is insufficient | Top up and test again |
| Chat reports "address or model not found (HTTP 404)" | The API address or model ID is incorrect | Check that the API address is `https://api.deepseek.com/anthropic`, and verify the model ID |
| Fetching models returns HTTP 404 | The endpoint does not provide a model-list API | Enter the model ID manually, then click **Test** |
| Chat reports "too many requests or quota exhausted (HTTP 429)" | Rate limited | Retry later |
| Manual test shows "unavailable" with none of the errors above | Server error, network problem, or test timeout | Test again later; if it still fails, check your network and proxy |

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

When you open the panel on a page without a dataset context, general answers, file and quota lookups, compound/literature lookups, and web search still work; tools that depend on the page have no dataset to read.

## Capabilities

### Tools

| Area | What it can do |
| --- | --- |
| Page and data | Read the current page state and selection, dataset overview, one or many ion images (up to 9 m/z values, returned separately or as a montage), ion images for annotation rows, ion-intensity statistics, top mean-spectrum peaks, a pixel spectrum, KMeans/UMAP summaries, and the annotation list or details |
| Files and account | List public/personal files, read file metadata, list processing tasks, and check user quota |
| Compounds and pathways | PubChem compound and formula lookup, ChEBI, HMDB, KEGG pathway details and member compounds, plus the KEGG pathway map image; read lipid candidates generated in the annotation panel |
| Literature and web | Europe PMC and PubMed search with keywords built from the claim being checked, falling back to web search when both are unavailable |

Web search returns page links and excerpts; it does not read full texts.

### Skills

An empty conversation offers **Annotation review** and **MSI analysis** shortcuts. During a conversation, the agent selects an appropriate analysis workflow for the question, such as ion-image interpretation, adduct and isotope assessment, metabolite biology, or literature evidence.

## Conversation management

The conversation menu in the title bar keeps conversations per dataset, with at most 3 per dataset. You can switch, start a new one, delete, export, and import:

- **Export** creates a ZIP with the conversation log and image attachments; exporting works while a turn is running.
- **Import** writes a ZIP into the current dataset after validating file integrity and image references.
- While a conversation is running you cannot switch, create, or delete; stop the current answer first.
- The same conversation opened in another tab is read-only there, so two tabs never write at once.
- If the browser lacks the required local-storage capability (some private-browsing modes), the agent uses a temporary conversation and warns that a reload will not keep it.

## Data and storage

Conversations, images, and the connection key stay in this browser; model requests go directly to the endpoint you configure. Tools send the necessary queries (for example annotations, compounds, literature, or search terms) to their respective services.
