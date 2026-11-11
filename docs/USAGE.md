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

Once connected, Spindle opens **Chat & create** with Chat & vision selected, including after a fresh reload. Use the workspace picker for images, audio, video, and the other creation modes. On phones, the menu button opens navigation to Dashboard, Workflows, Library & runs, Models, Device, and Connection.

**Dashboard** shows Spindle usage, daily activity, all 11 capabilities, hardware load, model comparisons, and expandable measurement records.

- Filter local history by 7/30/90 days or all time, capability, model, and benchmark samples. CSV and JSON exports contain the full filtered history; the screen shows the latest 50 detailed records.
- Track input/output/total tokens from response bodies, runtime timings, JSON usage headers, or individual token headers. Image and video tokens are retained when supplied, alongside media counts, dimensions, frames, and durations. Unreported token usage stays missing; media counts are never treated as tokens.
- Compare median and p95 execution times, runtime decode/prefill t/s, video generation frames/s, and audio output seconds per processing second. Spindle measures execution separately from model preparation and restoration. First-token latency is not yet recorded. Web-enabled execution times include the search request; compare benchmarks with web search disabled.
- Run the **Spindle text v1** benchmark with 1, 3, or 5 sequential samples on an already loaded chat model. Its fixed prompt, output-token cap, temperature, seed, model/version, and timing data are recorded. The text-baseline chart preserves a speed timeline. Prompt caching and concurrent device work can affect results.
- Read actual NPU activity, CPU, RAM, NPU memory, storage, and model reservation. A compact NPU/CPU/RAM strip remains visible across workspaces, sampling every five seconds while the tab is visible. Missing readings show a dash and failed refreshes mark previous readings stale. Samples retain up to 24 hours / 3,000 points, checkpointed approximately every minute. Missing intervals are not connected in the trace.
- TiinyOS’s weekly device counter is shown as a **separate ledger**, with previous-week navigation. It can overlap Spindle records and may exclude media; its totals are never added to Spindle totals.

Measurements persist in ignored `data/metrics.ndjson`. The append journal deduplicates steps across restarts and can enrich older records from local files. Older runs retain reported usage; only single-step runs without model switching have a usable legacy duration. Older device attribution and removed input-file presence are unknown and labeled accordingly. This history covers Spindle requests, not every request from other clients.

The measurement guide explains coverage, timing, and fair comparisons. An exact reported zero is displayed as zero; a dash means not reported or not measured. Some device runtimes omit image/video token usage. Spindle captures it when available, but cannot reconstruct token totals the runtime never returned.

### Cloud-price comparison

**Estimated cloud cost** applies standard API text rates to the full selected period and filters, beyond the latest 50 displayed records. The 7-, 30- and 90-day windows include today and roll forward at local midnight. Open **Daily breakdown** to see which days contributed input tokens, output tokens and costs. Only completed text-only chat steps with both token counts qualify. Image input, unknown legacy input, missing counts, failed work and other media are excluded. A reported zero stays zero. A dash means no qualifying counts were available. The calculation uses reported output, which already includes reasoning tokens, and covers Spindle's own history.

**Lifetime local chat tokens** adds reported input and output from all qualifying steps in Spindle's retained history for this connection, including eligible legacy records. The counter stays the same when you change dashboard filters and grows as Spindle records more qualifying chats.

The presets link to [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing), [Google pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.5-flash-lite) and [OpenRouter pricing for Qwen3.5-27B](https://openrouter.ai/qwen/qwen3.5-27b), checked on November 10, 2026. Expand **Rates & assumptions** to edit USD prices per million input/output tokens or restore the published snapshot. Edits remain in this tab; rates are not automatically refreshed. The OpenRouter preset uses the published Alibaba Cloud route; other routes can have different rates, and [credit purchase fees](https://openrouter.ai/pricing) are excluded. No provider receives your usage or prompts.

This estimates potential API spend avoided. Providers tokenize differently and models differ in capability. It is not an equivalent-result quote or net savings after hardware/electricity. Uncached input and output rates exclude cache discounts, batch pricing, tools, subscriptions, taxes and long-context premiums. Check the linked provider terms before using a comparison for purchasing decisions.

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

**Compact composer.** Send sits directly beneath the prompt, with the effective allowance and web-search state beside it. Replies appear in the conversation above the composer. New chat is in the workspace header; starting points and Tips & examples prepare inputs without running them. Chat options is collapsed initially. Open it for response length, search, thinking, attachments, advanced JSON, model switching, and workflow tools.

**Create with defaults.** Each media workspace starts with its prompt or required file and a Create action. A downloaded compatible model is chosen automatically, preferring a loaded model. Optional voice, lyrics, reference images, preview settings, and advanced parameters stay inside that workspace’s collapsed options. Video keeps its short-preview default. Transcription, document reading, and 3D expose their required file directly; ranking exposes candidate documents. Results and playback appear above the composer.

The compact prompt grows to a bounded height as you type. Send stays directly beneath it, with search state and response allowance visible. Completed answers start at their beginning when you were following the result; reading earlier content is not forcibly interrupted. Required-file sections collapse after an accepted submission and can be reopened to choose another input.

**3D preview.** Compatible saved GLB artifacts display an inline geometry viewer in results and Library. Drag/touch to orbit, scroll or use +/− to zoom, use Reset, or choose Expand for a larger dialog. Arrow keys orbit, +/− zoom and R resets when the canvas is focused. Escape closes the expanded viewer. Spindle prepares dense originals locally with a 96 MiB / 3,000,000-triangle source limit, reducing to at most 100,000 triangles and a 20 MiB browser limit. Original files stay unchanged and downloadable. No model is called for a preview, external GLB resources are never fetched, and unsupported/compressed geometry or unavailable WebGL is explained. This previews static geometry and base colors, not a generated texture/animation pipeline. Idle viewers do not redraw continuously.

**Maximum response tokens** defaults to **Ample · up to 32,768 tokens**. For a smaller reported context window, Spindle reduces Ample to half that window to reserve room for input. This is not a measurement of actual remaining space; a long conversation can still exhaust context. It is a ceiling for device workload rather than a paid token allowance, and does not force the model to produce that many tokens. Reasoning can share it with the final answer. Other presets cover 4,096, 8,192, 16,384, and 32,768 tokens; Custom accepts a positive whole number. Runtime default / Advanced JSON sends no Spindle cap unless your JSON supplies one. Explicit selections override JSON token limits. Response choice, custom value, streaming choice, search on/off, and provider persist in this browser; prompts, explicit search queries, and API keys are not written to these preferences. Fixed benchmark and capability-check caps remain 128 and 100 tokens respectively.

**Thinking mode** uses the Tiiny `chat_template_kwargs.enable_thinking` control when a model reports a toggle. **Reasoning effort** lists only reported levels. Model default sends no override. Returned `reasoning_content`, `reasoning`, `thinking`, and `<think>` blocks appear separately in a collapsed Thinking panel, including while streaming. These are model-provided text, not a guarantee that all internal reasoning is exposed. Reasoning and source cards remain in local run history. Only the answer is passed onward to workflow steps.

**Show the response as it arrives** is on by default. The helper decodes SSE and retains usage/timings from final stream events. JSON responses are also accepted. If firmware rejects the stream request, turn this option off; Spindle does not automatically repeat a request that might have already run. A partial response remains visible after a stream failure. A token-limit notice shows the requested cap when known and recommends a larger visible limit or asking to continue.

**Search the web before each message** is on by default, and its on/off choice and provider are remembered across reloads in this browser. The notice beside Send stays visible while Chat options is collapsed. Turn it off in Chat options for local-only inference. Enabling it sends only the explicit search query—or the current prompt when the query field is blank—to the chosen provider. Use an explicit, short query to keep sensitive material out of searches. Conversation history, image attachments, and the Tiiny key are not sent to the search provider. Search-enabled workflow steps use these same settings; saved workflows keep the choice and query, never the Brave key.

- **DuckDuckGo:** keyless, best-effort HTML search over HTTPS. It may return no results, rate-limit requests, change its markup, or require a browser verification. Spindle stops the run with an actionable error; it does not bypass verification.
- **Brave Search:** configure a separate Brave Search API key in the chat controls ([provider documentation](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started)). It is held in the local helper’s memory until **Forget search key** or restart, shared only within this single-user helper. No disk or browser-storage persistence. API quotas or charges depend on your Brave account.
- Each answer can use up to five snippets. Sources display titles, links, snippets, query, provider, and retrieval time. For weather queries, Spindle can look up up to two U.S. National Weather Service forecasts. The forecast request sends only the city and state, ZIP code, or public coordinates from a search result. It carries no keys, full prompt, or chat history. The source card shows the issue time and forecast periods. Other results supply snippets. Model citations such as `[1]` can be wrong; verify the corresponding source.
- Search requests use fixed HTTPS destinations, no Tiiny credentials, no redirects, bounded response sizes, and timeouts. A failed search stops the run rather than producing an answer without the requested evidence.
- Search queries and snippets are saved locally with the run. Internet access is required only when searching. Inference continues to use your configured Tiiny endpoint and its HTTP/TLS limitations.

## Guidance that stays close to the task

The Field guide explains each workspace, suggests ways to improve results, and covers model states, NPU capacity, context, steps, and seeds. Tips & examples and the optional start strip in the guide help first-time owners get one useful result.

Example prompts and synthetic sample files prepare inputs without starting inference. Undo restores the previous prompt or sample. Contextual recovery cards explain useful next steps and keep the original technical error available in a disclosure. Workflow preflight checks catch missing or mismatched file handoffs before running.

## Models and workflows

### Video → repair soundtrack

Open the built-in **Repair soundtrack** recipe, or choose **Repair soundtrack** beside a saved video. Select a downloaded transcription model to extract and transcribe the original audio. Review that rough transcript and write the actual words you want spoken; generated gibberish may not transcribe meaningfully. A downloaded speech model then creates the replacement voice.

You can add a WAV/MP3 music file, including one made in the Music workspace. Background music loops and ducks beneath speech. The original-audio level defaults to zero, removing both original dialogue and ambience; increasing it retains both because source separation is not implemented. Voice offset controls when speech begins. Optional timing adjustment speeds speech by at most 1.35×; longer scripts stop with a request to shorten them. This workflow does not perform lip synchronization.

FFmpeg/FFprobe extract a mono 16 kHz PCM WAV for transcription and mix the new soundtrack locally. The remixed video copies the original video stream and is checked for the same frame count. The original video, extracted soundtrack, generated voice, optional background upload, and new MP4 remain separate assets. A stopped replacement run can resume mixing its saved voice, including updated volume/offset/timing options. To change the script or voice model, generate a new replacement.

### TiinyVerse → a walkable 3D museum

Open the **TiinyVerse museum** recipe and import the public [UseCase topic](https://www.tiinyverse.com/topics/usecase). The helper fetches two pages, up to 40 posts, from TiinyVerse's anonymous `top-liked` topic feed. It sends no Tiiny key, local prompts, or conversation history. Only published/public posts are accepted. Author display names, publication dates, public excerpts, likes, comments, and source links are retained; account IDs, bios, avatars, permissions, and private/operational fields are discarded.

Review the selection, initially the six most-liked fetched entries, and choose 1–24 exhibits. Ranking means top liked within that dated, bounded snapshot; the export states when additional posts exist. Timeline dates mean when a post was shared, not the project's creation date. Missing engagement counts remain unknown. The topic includes experiences as well as applications, so selection is reviewable rather than silently filtering categories.

Choose a suggested brief: **The Chrono Vault · signature** (the default), **The luminous archive**, **The signal observatory**, or **The invention conservatory**. See the [complete museum guide](MUSEUM.md) for the one-click signature path. Each supplies an editable design direction. Start with six exhibits. **Build a quick museum** packages public text, source images, and procedural sculptures without inference. **Build with my selected projects** uses downloaded models for the selected curation, textures, wall interpretations, sculpture and audio stages. Source images take priority on walls; generated art is labeled separately. Signature mode can add a locally generated instrumental soundscape and a guided timeline tour. Model steps have external web search off. Generated exhibit data cannot replace attribution, source dates, or engagement metrics.

Source refresh starts enabled. During a build, Spindle retrieves the full public post text (up to 6,000 characters), allowlisted static PNG/JPEG/WebP images, and a linked GitHub README as plain text (up to 4,000 characters). No project scripts, bundles, executable embeds, or arbitrary linked pages are fetched or run. Capture dates and content hashes identify changes, including changed image contents at the same URL. Failed captures carry a visible warning. You can supply a screenshot of your own, up to 8 MiB per exhibit. Images from posts are labeled as source images because the API does not distinguish screenshots from photos.

Signature mode generates an immersive mural for every exhibit, displayed separately from authentic source images. Lightweight mode can generate art **only when a source image is missing**. Optional narration adds one speech step per exhibit. The optional hero sculpture adds two steps for one selected project: an image model makes a broad, solid, freestanding object reference, then a downloaded image-to-3D model processes its `shape` stage. The suggested object prompt avoids lettering, thin wires, transparent parts, and disconnected components. Spindle embeds compatible, uncompressed GLB triangle geometry as a bronze display, accepting source files up to 96 MiB and 3,000,000 triangles in the helper, then reducing dense geometry locally to at most 100,000 triangles for export. Original artifacts remain saved. It does not request a generated texture stage. Unsupported artifacts remain downloadable and the museum uses a procedural sculpture. These sequential steps can take a long time; saved work is resumable.

**Tiiny creates stone and timber textures** starts enabled for the generated museum. It adds two image steps using editable, supplied material prompts: a flat, seamless stone albedo and natural walnut albedo. The selected style changes the stone prompt. These are gallery surface materials, separate from authentic project images and from a 3D model's texture stage. Expect several minutes of device work. Quick builds use procedural materials. Saved textures survive resume and source-only rebuilds.

The separate template viewer maps materials at a consistent world scale, derives subtle surface relief, and shades them with roughness, metallic highlights, and tone mapping. Recessed exhibits, timber ribs, visible track fixtures, and coffer lights give the room depth. Auto graphics uses cached shadow maps and enables floor reflections within its frame budget; High enables both, while Battery saver disables those passes and shape rotation. Mobile defaults use a smaller render scale and omit floor reflections in Auto. An unchanged scene stops submitting frames; view changes, new textures, quality changes, and optional sculpture animation trigger redraws. No network or third-party renderer is required.

**Rebuild with latest sources** refreshes the same collection without inference. Unchanged exhibits retain their generated media and curated descriptions; changed posts use new source-text labels. The earlier export remains saved. An offline HTML file is always a dated snapshot and does not silently fetch updates.

With **Tiiny writes the entire museum app** checked (the default), a downloaded coding/chat model writes all custom HTML/CSS/JavaScript application code and its repairs, using the standard Three.js r187 library bundled offline with its MIT notice. Spindle supplies source data, assets, isolated browser tests and packaging, not gallery code. The optional visual reviewer receives an actual app screenshot. A separate template preview uses Spindle’s original renderer. Textured stone and timber, brass arches, exhibit lighting, source-image walls, and distinct sculptures form the gallery. Export embeds its media in one HTML file, with a 60 MiB media limit. It loads no CDN, external libraries, external fonts, or remote images; the standard rendering library is embedded. Source links access the internet only when clicked. WASD walks, arrows move/turn, dragging or mouse look changes the view, and E inspects. An index, mobile controls, and a reading view without WebGL are included. Auto graphics adjusts resolution; High and Battery saver are available. The browser renders 3D; exploring the downloaded file needs no helper, device, account, or network.

Generated HTML is served as an attachment. Spindle's preview uses a sandboxed, isolated-origin page with network access blocked by Content Security Policy. Museum generation and exports remain in ignored local data and are excluded from source releases. Completed model steps survive interruption and can be resumed without counting reused inference again. Uploaded/source/generated project media is not published automatically.

**Idea → image → film** is the built-in workflow shown first in Workflows. A phrase goes through `Qwen/Qwen-Image-2.1-PE-T2I`; an image plus an editing instruction goes through `Qwen/Qwen-Image-2.1-PE-I2I`. Their rewritten prompt is extracted from the returned JSON before `Qwen/Qwen-Image-2.1` creates or edits the image. Model IDs are resolved against the discovered catalog and can be changed in Workflow options. The workflow never downloads models implicitly or uses web search.

Review the resulting image before continuing. Another editing instruction uses that exact result as the next reference. **Animate this image** in Chat & create, and **Edit / animate image** in Library & runs, select the saved image directly instead of regenerating it. Uploaded PNG, JPEG, and WebP images can also go straight to video without an image generation step.

The film stage uses the selected MiniMax H3 runtime. Choose 1–60 whole seconds, defaulting to 15. Above 30 seconds, a visible warning and acknowledgement are required. Once the model is loaded, Spindle reads its reported frame rate, step options, canvases, and native frame options when available. It aims for clips contributing up to five seconds each; shorter supported counts produce more segments. H3 firmware that omits frame-count metadata uses the gateway's documented `seconds` interface for short segments instead of guessing a model-specific frame-count rule. The device still validates each request. Missing frame rate, canvas, or step information stops the run before generation. The capability response is kept with the local film record for diagnosis. Generation and final playback length can differ because extra boundary frames are trimmed locally.

Each clip is downloaded immediately, normalized to a common canvas and frame rate, and trimmed to its contribution to the final duration. The next clip uses the last frame of that processed segment. Later segments omit their first boundary frame. All clips are stitched into an H.264/AAC MP4 of the requested duration, to frame precision. Source audio is retained where available; silent clips receive a silent track for consistent stitching. Identity, movement, and audio continuity are not guaranteed.

Film processing requires FFmpeg and FFprobe on the helper computer's PATH, with `libx264` and AAC encoding. `SPINDLE_FFMPEG` and `SPINDLE_FFPROBE` may specify executable paths. Image creation remains available without these optional tools. Processes run locally without a shell and can be stopped with the workflow. No FFmpeg binary, OS service, or npm dependency is installed automatically.

Completed segments, original device clips, film starting images, and the final MP4 are retained in ignored `data/assets/`. **Resume from saved segments** creates a new run, reuses completed work, and continues the missing steps; a clip that returned too few frames is retried. Local processing or stitching failures can be retried without regenerating usable clips. After a helper restart, a recorded device job is checked first: a still-running segment blocks duplicate submission, and a completed retained result is downloaded and reused. Reused outputs are marked with their original run and excluded from new inference measurements, including after a restart. The assembled export is not counted as another device generation. Resume requires the original device connection and downloaded models. Draft text and image selection stay in this tab's memory; generated images and interrupted films can be recovered from local run history after reloading.

Refresh merges the store, downloaded inventory, and loaded models. New IDs appear without a code update. Types, descriptions, versions, inputs/outputs, NPU reservations, and sizes are retained. CSV and JSON exports are available in Models. A new task protocol or architecture may still require an adapter update. Store metadata does not independently establish model quality or working support for every advertised mode.

Workflows pin exact model IDs. Steps can use starting text, the preceding text result, an initial file, or the preceding image/audio artifact. Add, reorder, remove, save, and reuse steps. Starter recipes include meeting-to-brief, image-to-motion, read-to-explain, and idea-to-voice.

The image/film workflow, soundtrack repair, museum and custom sequential editor each have an expandable section. Open only the workflow you need. Selecting a saved/custom recipe opens the editor; sending a saved image into animation opens the image/film workflow.

Spindle queues one run at a time. Opt-in model switching waits for readiness and attempts to restore the original models after completion, failure, or cancellation. Runs never download models implicitly. On firmware without active-task listing, Spindle checks idle NPU activity before switching; this cannot establish whether another application has pending work. Use switching on an idle device.

Completed media and run records remain in `data/`. Video is downloaded immediately before gateway retention expires. Uploaded source files are removed from run records after completion; text, parameters, model IDs, and generated outputs are retained.

## Visual experience

Canvas generates rotating light threads, orbiting particles, aurora lighting, and pointer parallax on your computer. Glass surfaces, responsive task tiles, transitions, and activity feedback complete the interface.

While Spindle is working, the globe breathes, the brand and activity star rotate, and a light sweep crosses the hardware strip. The run name, phase and reported percentage remain visible; small screens expand the activity indicator while a run is active. A missing native percentage is not invented.

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

Workflows are sequential; branching, tool execution, parallel branches, and a freeform node canvas are not implemented. The Transcribe workspace accepts browser-decodable recordings up to 15 minutes per file. Meeting Desk accepts up to 30 minutes and queues minute-long chunks. The 3D workspace submits the shape stage; a full generated texture pipeline is not implemented. The museum can display a bounded subset of embedded GLB geometry.

Runs and outputs survive server restarts. Active/queued runs become interrupted and require explicit rerunning. A terminated server cannot guarantee model restoration. No OS startup service or scheduled job is installed.

References: [Model management](https://dev.tiiny.ai/#/concepts-model-management), [OpenAI-compatible inference](https://dev.tiiny.ai/#/inference-openai), [native multimodal APIs](https://dev.tiiny.ai/#/inference-tiiny-sdk).

## Rough cuts, library, and device power

In **Workflows → Recording → rough cut**, upload an MP4, WAV, or MP3 (up to two minutes and 40 MiB), or pick one from your library. Leave a short pause before each retake. Spindle uses FFmpeg to split takes at pauses, transcribes them on Tiiny, and asks a decision model which earlier takes may be expendable. Play each take and change any cut before exporting a separate file.

**Library & runs** can move individual outputs to the local `data/trash` folder while retaining run history. Spindle blocks deletion when a saved workflow depends on the output.

**Device → Power & recovery** offers restart, shutdown, and automatic power on after AC power returns. Spindle checks for active work before sending a power action.
