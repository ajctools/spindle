# Spindle

**Your local universe.** A multimodal companion for Tiiny AI: chat, vision, images, audio, music, video, documents, 3D, and workflows in one local workspace.

Spindle runs on your computer and connects to your Tiiny. No Spindle account, external animation service, CDN, package install, or cloud inference service is required.

## Start

Requirements: Node.js 22 or newer, a Tiiny device, and its API key.

```sh
node server.mjs
```

Open **http://127.0.0.1:8437**. On Windows, `Start-Spindle.ps1` also starts it using your installed Node.js runtime.

The first screen for a new owner is **Connection**. Enter a device URL such as `http://192.0.2.10`, or an OpenAI-compatible base URL ending in `/v1`. Paste the key from TiinyOS **Settings → API Key**, test the connection, then connect.

- Leave **Remember on this computer** off for a connection held in server memory until shutdown.
- Turn it on to save settings in `data/connection.json`. This file contains the unencrypted key and is excluded from Git. Windows uses the selected folder’s inherited permissions; use a private folder.
- Advanced routing supports native and management base URLs on the same origin, plus Tiiny virtual-host routing.
- An existing key can be retained for the same endpoint. Changing endpoints requires entering that endpoint's key explicitly.

Configuration precedence: environment overrides, a Spindle session connection, saved Spindle settings, then the existing Tiiny CLI configuration. The CLI is optional.

Optional environment variables: `TIINY_HOST`, `TIINY_KEY`, `TIINY_CONFIG`, `SPINDLE_PORT`, and `SPINDLE_DATA_DIR`. For an environment file, copy `.env.example` to `.env`, edit it, and run `node --env-file=.env server.mjs`.

## Dashboard & performance history

Once connected, **Dashboard** is the default landing view, including after a fresh reload. It shows Spindle usage, daily activity, all 11 capabilities, hardware load, model comparisons, and expandable measurement records.

- Filter local history by 7/30/90 days or all time, capability, model, and benchmark samples. CSV and JSON exports contain the full filtered history; the screen shows the latest 50 detailed records.
- Track input/output/total tokens from response bodies, runtime timings, JSON usage headers, or individual token headers. Image and video tokens are retained when supplied, alongside media counts, dimensions, frames, and durations. Unreported token usage stays missing; media counts are never treated as tokens.
- Compare median and p95 execution times, runtime decode/prefill t/s, video generation frames/s, and audio output seconds per processing second. Spindle measures execution separately from model preparation and restoration. First-token latency is not yet recorded. Web-enabled execution times include the search request; compare benchmarks with web search disabled.
- Run the **Spindle text v1** benchmark with 1, 3, or 5 sequential samples on an already loaded chat model. Its fixed prompt, output-token cap, temperature, seed, model/version, and timing data are recorded. The text-baseline chart preserves a speed timeline. Prompt caching and concurrent device work can affect results.
- Read actual NPU activity, CPU, RAM, NPU memory, storage, and model reservation. Live polling runs while the dashboard is open and visible. Samples retain up to 24 hours / 3,000 points, checkpointed approximately every minute. Missing intervals are not connected in the trace.
- TiinyOS’s weekly device counter is shown as a **separate ledger**, with previous-week navigation. It can overlap Spindle records and may exclude media; its totals are never added to Spindle totals.

Measurements persist in ignored `data/metrics.ndjson`. The append journal deduplicates steps across restarts and can enrich older records from local files. Older runs retain reported usage; only single-step runs without model switching have a usable legacy duration. Older device attribution and removed input-file presence are unknown and labeled accordingly. This history covers Spindle requests, not every request from other clients.

The measurement guide explains coverage, timing, and fair comparisons. An exact reported zero is displayed as zero; a dash means not reported or not measured. Some device runtimes omit image/video token usage. Spindle captures it when available, but cannot reconstruct token totals the runtime never returned.

## Workspaces

| Workspace | Purpose |
| --- | --- |
| Chat & vision | Conversation, writing, code, and image understanding |
| Images | Text-to-image generation and reference-image editing |
| Transcribe | Audio-to-text; audio is converted locally to mono 16 kHz PCM WAV |
| Speech | Text-to-speech with local playback and downloads |
| Music | Description/lyrics to music with model-aware generation modes |
| Video | Text-to-video and image-guided video, job progress, saved MP4s |
| Read documents | OCR and document layout extraction |
| 3D objects | Image-to-shape, downloadable artifacts, and GLB previews where provided |
| Classify & route | Structured choices, scores, and probabilities |
| Embeddings | Vector generation with dimensions and a compact preview |
| Rank documents | Ordered candidates and relevance scores |

Advanced JSON exposes model-specific parameters. Runtime info reads the selected running model's own capabilities and defaults. Short video previews use supported canvases and step options when available.

**Test capability** runs a real sample and records its result under **Device → Capability readiness**. Some models take several minutes to load or generate. Preparation, execution, progress, and restoration are shown separately.

## Chat controls and web search

**Compact composer.** Send sits directly beneath the prompt; Chat options is collapsed initially. Open it for response length, search, thinking, attachments, examples, advanced JSON, model switching, workflow tools, and New chat. The summary beside Send shows the effective allowance and web-search state.

**Maximum response tokens** defaults to **Ample · up to 32,768 tokens**. For a smaller reported context window, Spindle reduces Ample to half that window to reserve room for input. This is not a measurement of actual remaining space; a long conversation can still exhaust context. It is a ceiling for device workload rather than a paid token allowance, and does not force the model to produce that many tokens. Reasoning can share it with the final answer. Other presets cover 4,096, 8,192, 16,384, and 32,768 tokens; Custom accepts a positive whole number. Runtime default / Advanced JSON sends no Spindle cap unless your JSON supplies one. Explicit selections override JSON token limits. Response choice, custom value, streaming choice, search on/off, and provider persist in this browser; prompts, explicit search queries, and API keys are not written to these preferences. Fixed benchmark and capability-check caps remain 128 and 100 tokens respectively.

**Thinking mode** uses the Tiiny `chat_template_kwargs.enable_thinking` control when a model reports a toggle. **Reasoning effort** lists only reported levels. Model default sends no override. Returned `reasoning_content`, `reasoning`, `thinking`, and `<think>` blocks appear separately in a collapsed Thinking panel, including while streaming. These are model-provided text, not a guarantee that all internal reasoning is exposed. Reasoning and source cards remain in local run history. Only the answer is passed onward to workflow steps.

**Show the response as it arrives** is on by default. The helper decodes SSE and retains usage/timings from final stream events. JSON responses are also accepted. If firmware rejects the stream request, turn this option off; Spindle does not automatically repeat a request that might have already run. A partial response remains visible after a stream failure. A token-limit notice shows the requested cap when known and recommends a larger visible limit or asking to continue.

**Search the web before each message** is on by default, and its on/off choice and provider are remembered across reloads in this browser. The notice beside Send stays visible while Chat options is collapsed. Turn it off in Chat options for local-only inference. Enabling it sends only the explicit search query—or the current prompt when the query field is blank—to the chosen provider. Use an explicit, short query to keep sensitive material out of searches. Conversation history, image attachments, and the Tiiny key are not sent to the search provider. Search-enabled workflow steps use these same settings; saved workflows keep the choice and query, never the Brave key.

- **DuckDuckGo:** keyless, best-effort HTML search over HTTPS. It may return no results, rate-limit requests, change its markup, or require a browser verification. Spindle stops the run with an actionable error; it does not bypass verification.
- **Brave Search:** configure a separate Brave Search API key in the chat controls ([provider documentation](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started)). It is held in the local helper’s memory until **Forget search key** or restart, shared only within this single-user helper. No disk or browser-storage persistence. API quotas or charges depend on your Brave account.
- Each answer can use up to five snippets. Sources display titles, links, snippets, query, provider, and retrieval time. Spindle does not fetch the full result pages or run model-selected tools. Model citations such as `[1]` can be wrong; verify the corresponding source.
- Search requests use fixed HTTPS destinations, no Tiiny credentials, no redirects, bounded response sizes, and timeouts. A failed search stops the run rather than producing an answer without the requested evidence.
- Search queries and snippets are saved locally with the run. Internet access is required only when searching. Inference continues to use your configured Tiiny endpoint and its HTTP/TLS limitations.

## Guidance that stays close to the task

The Field guide explains each workspace, suggests ways to improve results, and covers model states, NPU capacity, context, steps, and seeds. A dismissible start strip helps first-time owners get one useful result.

Example prompts and synthetic sample files prepare inputs without starting inference. Undo restores the previous prompt or sample. Contextual recovery cards explain useful next steps and keep the original technical error available in a disclosure. Workflow preflight checks catch missing or mismatched file handoffs before running.

## Models and workflows

Refresh merges the store, downloaded inventory, and loaded models. New IDs appear without a code update. Types, descriptions, versions, inputs/outputs, NPU reservations, and sizes are retained. CSV and JSON exports are available in Models. A new task protocol or architecture may still require an adapter update. Store metadata does not independently establish model quality or working support for every advertised mode.

Workflows pin exact model IDs. Steps can use starting text, the preceding text result, an initial file, or the preceding image/audio artifact. Add, reorder, remove, save, and reuse steps. Starter recipes include meeting-to-brief, image-to-motion, read-to-explain, and idea-to-voice.

Spindle queues one run at a time. Opt-in model switching waits for readiness and attempts to restore the original models after completion, failure, or cancellation. Runs never download models implicitly. On firmware without active-task listing, Spindle checks idle NPU activity before switching; this cannot establish whether another application has pending work. Use switching on an idle device.

Completed media and run records remain in `data/`. Video is downloaded immediately before gateway retention expires. Uploaded source files are removed from run records after completion; text, parameters, model IDs, and generated outputs are retained.

## Visual experience

Canvas generates rotating light threads, orbiting particles, aurora lighting, and pointer parallax on your computer. Glass surfaces, responsive task tiles, transitions, and activity feedback complete the interface.

**Still mode** stops ambient motion. System reduced-motion preferences are respected. Animation pauses in hidden tabs. No external visual assets, tracking, or fonts are fetched.

## Public source

The source package excludes runtime data and credentials. `.gitignore` excludes `data/`, environment files, logs, and temporary test data. Included capability fixtures are synthetic samples.

Do not add `data/` or an actual `.env` to a public repository. Runtime data includes conversations, media, inventories, readiness reports, and optionally the saved key. `.env.example` has placeholders only.

The server binds to loopback. Private reads and writes require an HTTP-only session cookie, with origin, Fetch Metadata, and host checks. Keys are not returned to the browser or catalog exports. Remote multi-user hosting and public server exposure are outside this version's scope.

## Build a public release

Use `node scripts/release.mjs --out <new-directory>` to create a clean source folder using an explicit manifest. The output directory must not already exist. The builder scans source content and fixture metadata, and compares it with locally configured device credentials and OS identifiers without printing their values. No local configuration is copied.

Publish that extracted source folder or an archive made from it. Do not upload the development workspace, owner-specific screenshots, catalog exports, or runtime data. See [Security and privacy](docs/SECURITY.md) for the local trust boundary, plaintext HTTP and saved-key limitations, and handling files already committed elsewhere.

## Tests

```sh
node --test test/*.test.mjs
```

Tests use isolated mock devices and temporary data. They cover durable measurement history, token provenance and missing values, filtered exports, benchmark execution, MP4 metadata, all task contracts, audio envelopes, OCR selectors, video/3D artifacts, setup without the CLI, endpoint/key isolation, cross-origin writes, workflow handoffs, model switching, and restoration. They never use your Tiiny credentials or change your hardware.

Physical-device checks, when run, are recorded separately in the local readiness report. Mock tests are not represented as successful hardware checks.

## Boundaries

Chat renders after completion rather than streaming. Workflows are sequential; branching, tool execution, parallel branches, and a freeform node canvas are not implemented. Transcription supports browser-decodable recordings up to 15 minutes per file. The 3D workspace submits the shape stage; full texture/export pipelines and an embedded 3D viewer are not implemented.

Runs and outputs survive server restarts. Active/queued runs become interrupted and require explicit rerunning. A terminated server cannot guarantee model restoration. No OS startup service or scheduled job is installed.

References: [Model management](https://dev.tiiny.ai/#/concepts-model-management), [OpenAI-compatible inference](https://dev.tiiny.ai/#/inference-openai), [native multimodal APIs](https://dev.tiiny.ai/#/inference-tiiny-sdk).
