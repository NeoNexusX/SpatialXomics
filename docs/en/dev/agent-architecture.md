# SXO-Harness Agent Architecture

SXO-Harness runs in the browser. Vue consumes the `ctx.agent` facade; Cordis plugins supply model transport, tools, skills, context compaction, and local persistence. The backend continues to own authentication, datasets, and processing jobs. This repository does not implement a separate server-side agent scheduler.

The production composition is `src/features/agent/bundles/base.ts`. For user operations, see [SXO-Harness Agent](../guide/sxo-harness); for verification, see [Testing and E2E](./testing).

<ArchDiagram name="agent.architecture" title="Agent architecture" />

## Entry and composition

`Navbar.vue` statically imports the lightweight `FloatingAgent.vue` shell for visibility, dragging, and resizing. `AgentWorkspace.vue` is an async component, also prefetched during browser idle time. Async splitting therefore does not imply that downloading waits for a click. `whenAgentReady()` lazily creates and caches the module-level runtime singleton. Closing the panel does not dispose the runtime or stop its active turn.

`bootstrap.ts` creates a Cordis root context and installs the production bundle with `ctx.plugin()`. Row order is not dependency order: class plugins use `static inject`, and module plugins use `inject`. Readiness waits for every fiber to become active, reports failing plugin IDs, and disposes the root fiber during HMR.

<ArchDiagram name="cordis-relationships.architecture" title="Cordis and the project" />

| Layer | Modules | Responsibility |
| --- | --- | --- |
| Page bridge | `bridge/analysisContext.ts`, `datasetBinding.ts` | Dataset, ion, cluster, pixel, and annotation state without importing Cordis or plugins |
| UI | `components/`, `composables/` | Render service snapshots and invoke commands |
| Application facade | `plugins/agent` | Admission, session transitions, snapshots, instructions, cancellation |
| Turn driver | `plugins/agent-loop` | Implements `AgentDriver`; coordinates steps, attempts, and tool round trips |
| Facts and read models | `session`, `session-projection`, `session-transcript` | Commit events, maintain model-visible history, derive UI and statistics |
| Storage | `session-persistence`, `session-persistence-opfs`, `attachments`, `session-archive` | Storage contract, OPFS implementation, artifact references, ZIP migration |
| Models and policies | `connection`, `llm`, `llm-anthropic`, `model-catalog`, `llm-retry`, `token-meter`, `compaction` | Connection resolution, protocol isolation, vision probing, retries, budgets |
| Prompt and analysis binding | `system-prompt`, `persona`, `agent-instructions`, `analysis-binding` | Compose the system prompt and session instructions; capture and verify the dataset binding |
| Domain capabilities | `tools`, `tool-*`, `skill`, `skill-bundled` | Registration, execution pipeline, result archives, skill catalog and text |

## Facade and turn driver

`AgentRuntime` owns the active session and driver. UI consumers depend on the `Agent` contract. `AgentLoop` installs `LoopDriver` through `setDriverFactory()`, allowing execution strategies to change without moving loop responsibilities into UI or storage.

The lifecycle of `send(text, images)` is:

1. Reject empty input, concurrent admission, transitions, and disposed state. Capture the connection, dataset identity, and analysis selection.
2. Await restoration, reject read-only storage, save image artifacts, and build a `TurnPlan` with the system prompt.
3. Resolve the model and budget. Commit `turn/start`, the user message, and context supplied by `agent/pre-turn`. Only then acknowledge acceptance so the composer can clear its submitted draft.
4. Commit `step/start` and `request/context`, run pre-request policies, hydrate attachments, commit `attempt/start`, and start streaming.
5. Overlay uncommitted text, reasoning, and tool arguments through `live`. Commit successful model messages; failed attempt output does not enter subsequent model history.
6. If tools were requested, commit the calls, execute them sequentially, archive results and image references, then begin another step. Otherwise finish the turn.
7. Cancellation, invalid bindings, and errors close outstanding work. Late responses after cancellation cannot commit as successful messages.

There is no fixed step limit. Tool execution defaults to 15 seconds; the model stream idle timeout is 600 seconds. A turn ends when the model stops invoking tools, an unrecoverable error or context limit occurs, or the user stops it. Closing the panel and stopping a turn are separate operations.

Phases are `restoring`, `idle`, `preparing`, `generating`, `executing-tools`, `compacting`, `stopping`, `storage-error`, and `disposed`. Storage modes (`persistent`, `temporary`, `read-only`) are independent of phase: an idle read-only conversation still cannot send.

## Events and projections

`Session.commit()` is the write boundary for session facts. It assigns continuous sequence numbers, IDs, and timestamps, validates surface operations, and constructs a checksummed batch. Only after `storage.append()` succeeds does it publish the immutable log, model surface, projections, and subscriber notifications. Failed writes retain the exact batch for retry and expose `storage-error`.

| Representation | Source | Purpose |
| --- | --- | --- |
| Durable event log | `session.events` | Facts about turns, attempts, tools, compactions, and instructions; recovery and export |
| Model-visible surface | `Session.nodes` / `deriveMessages()` | Messages actually replayed to the model; regeneration and compaction can change this selection |
| UI and statistics | `sessionProjections` | Read models including `transcript`, `instructions`, `tokenUsage`, and `contextPressure` |

Plugins register pure `init/apply/view` projections. Restoration uses `reset()` to rebuild them; committed events use incremental `push()`. Live streaming overlays the transcript without becoming a durable fact prematurely. `useAgent()` initially displays the latest 100 UI messages; loading earlier adds 50. This does not truncate persisted or model-visible history.

Regeneration starts from the original turn's `baseSurface`, uses `surface/reset` to establish model history, and replaces the old turn in the visible transcript. Original events remain auditable. Compaction similarly changes the model surface while preserving the original conversation for display.

## Persistence and recovery

`session-persistence` defines storage and catalog contracts plus batch validation. `session-persistence-opfs` implements them:

- Sessions are scoped to a dataset, with at most three conversations per scope. Blank sessions can be reused or vacated for imports. With no dataset open, the empty dataset scope is used.
- OPFS stores a version header, `active.json`, segmented `events-N.jsonl`, and independent artifact files. Checksums detect corruption; they are not authentication signatures.
- Browser locks coordinate writers. A second tab opening an occupied conversation receives read-only storage and cannot send.
- Unavailable OPFS or required browser capabilities falls back to memory, with a reload-loss notice. Actual corruption must not silently become an empty conversation.
- Recovery validates batches, sequence numbers, and surface operations. Unfinished attempts, steps, compactions, and turns are marked interrupted. Outstanding tools receive `TOOL_NOT_STARTED` or `TOOL_OUTCOME_UNKNOWN`; potentially consequential actions are not automatically repeated.

`attachments` stores user and tool images as artifacts and retains references in events. Requests hydrate those references immediately before transport. `session-archive` lazily loads `fflate` to export logs and referenced artifacts as ZIP. Imports validate batches, continuity, surfaces, and attachment references in memory before writing.

## Analysis binding

Result pages register providers through the lightweight bridge and use `setAgentDataset()` / `markAgentDatasetReady()` to expose identity and loading generation. `analysis-binding` captures `datasetId`, `generation`, page state, and selection at submission, then contributes dataset prompt sections and turn context.

`agent/guard` checks dataset identity, generation, and readiness at turn start, each step, and before and after tools. Tool-specific checks also protect selected ions, pixels, clusters, and annotation weights. Dataset changes stop the turn and open the new dataset's latest conversation. Regeneration preserves selections on the same dataset while rebasing generation; a conversation imported from another dataset captures the current binding instead.

## Connections and model transport

`connection` is the only runtime source for user settings and deployment defaults. A user key selects the user's address/key pair; without it, the deployment pair is selected. Credentials from one pair are never combined with the other address. User keys are plaintext in local `localStorage` and are not included in session ZIPs.

`llm` defines normalized messages, schemas, stream events, and failures. `llm-anthropic` is the only current protocol adapter. It posts to a normalized versioned base URL, defaulting to `https://api.anthropic.com/v1/messages`, and owns AI SDK conversion, reasoning replay, and endpoint compatibility adjustments. Other plugins cannot directly import `ai` or `@ai-sdk/*`.

Development deployment defaults use `/llm-proxy`; BYOK uses `/llm-relay` with the target origin in `x-llm-target`. Production uses the configured address, which may point at a deployment proxy. `model-catalog` lists models and probes vision using a green test image. Settings only save models that pass. The initial allowance is ten models, with four concurrent probes; users explicitly request further batches.

`llm-retry` applies the adapter's retry policy at step boundaries and resets its counter for each step. Permanent failures such as authentication errors end the turn. Adapter-level protocol compatibility adjustments are separate from loop-level transport retries.

Deployment `VITE_LLM_*` keys enter the browser bundle. Exa search uses its own optional `VITE_EXA_API_KEY`, sent as `x-api-key` only to `https://mcp.exa.ai/mcp`; without it, search uses the anonymous allowance.

## Budgets, compaction, and result archives

`token-meter` derives cumulative provider usage and context pressure from the same committed log. Context limits prefer a user's per-endpoint/model setting, then endpoint metadata, then the 256,000-token default. Loop output reservation is `min(MAX_OUTPUT_TOKENS, floor(W/4))`. Estimation happens before image hydration and is calibrated with provider usage when available.

`compaction` attaches policy through events:

- Before requests, compact at `floor(min(0.8W, W − O − min(65536, floor(W/4))))` estimated input tokens, normally retaining `floor(0.16 × (W − O))` recent tokens.
- A confirmed endpoint context overflow permits one overflow recovery per turn. Manual compaction ignores the threshold.
- Regions preserve tool call/result pairs and protect the active turn. Summary requests replay the original system prompt, tools, and message prefix, then append compaction instructions.
- Success replaces the old model surface region with a structured checkpoint. Summary failure keeps the original history; cancellation and storage failures retain their respective interruption and save semantics.

Separately, `tool-archive` persists successful tool text. Default result limits are 4,000 characters, commonly 12,000 for evidence tools. Truncated results carry a `read_archived_result` reference so the model can retrieve windows by offset. Archiving is independent of conversation compaction.

## Extension points

| Event | Mode | Production use |
| --- | --- | --- |
| `agent/guard` | bail | Reject stale analysis bindings |
| `agent/pre-turn` | waterfall | Append context in the turn's initial commit |
| `agent/pre-request` | serial | Check pressure, compact, and refresh request snapshots |
| `agent/request-error` | waterfall | Try overflow recovery before retry policy |
| `agent/tool-result` | waterfall | Archive full output and prepare model-visible content |
| `tools/pre-execute` | serial | Return `{ kind: 'deny' }` to reject execution |
| `tools/post-execute` | waterfall | Transform results |
| `tools/result` | emit | Observe results |

Tool domains cover backend APIs, page context, ion images, chemistry, biology, literature, web search, and skill loading. Bundled `SKILL.md` files live under `plugins/skill-bundled/skills/`; a skill is an on-demand workflow instruction, not a separate execution process. Evidence tools include citation conventions in their schemas; Markdown links render through `MarkdownLink.vue` and `InlineCitation.vue`.

To add a tool, register a `defineTool()` definition in its domain plugin and add any new plugin to the bundle. A new protocol implements `LlmAdapter`, registers with `ctx.llm`, and extends endpoint types and profiles. Prompt contributions use deterministic `ctx.systemPrompt.section()` keys and ordering to preserve stable bytes for endpoint caching.

ESLint enforces plugin public entry points, prohibits plugin-to-UI imports, isolates SDK imports to the adapter, and keeps the bridge runtime-free. Refactors should also run `behaviorLock.test.ts`, which compares events, model requests, UI state, and prompt bytes. Browser coverage is described in [Testing and E2E](./testing).
