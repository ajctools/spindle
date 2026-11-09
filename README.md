![Spindle — your local universe](docs/images/hero.svg)

# Spindle

**A creative companion for Tiiny AI.** One local workspace for chat, images, audio, video, documents, 3D, model discovery, repeatable workflows, and a dashboard that remembers how your work performed.

**Preview v0.5.0 · MIT license · Node.js 22+ · No Tiiny SDK required**

> [!CAUTION]
> **READ BEFORE CONNECTING — LOCAL, SINGLE-USER SOFTWARE**
>
> - **HTTP traffic is unencrypted.** With an HTTP Tiiny endpoint, your API key, prompts, files, and responses travel without TLS. Use a trusted private network or direct connection.
> - **Remembered API keys are plaintext in this release.** Leave “Remember on this computer” off for a session-only Spindle connection. OS keychain encryption is **not implemented**. Existing CLI/environment credentials are separate.
> - **Do not expose the helper server to the internet or other users.** There is no multi-user login. Docker packaging is **not implemented**.
> - **Data stays private only if you handle it privately.** Runs, media, inventories, and exports can contain sensitive information. Never publish `data/`, actual environment files, or CLI configuration.
>
> - **Web search is optional and external.** When enabled, the explicit search query (or current prompt) goes to DuckDuckGo or Brave over HTTPS. Search is off by default. Brave requires a separate API key, held only in server memory. Queries and results remain in local run history.
>
> Read [Security & privacy](docs/SECURITY.md). A local audit is not a guarantee that every vulnerability has been found.

## See the workspace

![Spindle dashboard with synthetic usage, throughput, and device metrics](docs/images/dashboard.jpg)

*Illustrative demo. All models, usage, hardware values, and performance numbers in these screenshots are synthetic. They are not Tiiny benchmark results or a list of available models.*

| Make something | Connect the steps |
| --- | --- |
| ![Workbench with task selection and contextual guidance](docs/images/workbench.jpg) | ![A sequential image-to-video workflow](docs/images/workflows.jpg) |
| Choose a task, pick a compatible downloaded model, and try a small input. | Pin model IDs, pass text or files between steps, and save a recipe. |

## Start in three steps

1. **Get the source.** Use GitHub’s **Code → Download ZIP**, extract it, and open a terminal in the folder containing `server.mjs`.
2. **Install Node.js 22 or newer**, then run:

   ```sh
   node server.mjs
   ```

3. **Open <http://127.0.0.1:8437>.** Enter your Tiiny endpoint and key, test the connection, and connect. After setup, Dashboard is the default view.

There is no `npm install` step. The Windows launcher `Start-Spindle.ps1` uses an installed Node runtime. A browser tab by itself, a single HTML file, or GitHub Pages cannot run the local helper.

![Connection setup with visible HTTP and plaintext-key warnings](docs/images/connection.jpg)

*The key is never returned to the form. Remembering is optional and off by default. The documentation address is a placeholder, not a real device.*

![How the browser, local helper, and Tiiny connect](docs/images/how-it-works.svg)

You need a reachable Tiiny device and its API key. The CLI and SDK are optional. Full functionality requires Tiiny’s native/management APIs as well as its OpenAI-compatible surface; a generic chat-only endpoint is not enough. Model downloads may require the device to access the internet.

## What it brings together

| Workspace | What you can do |
| --- | --- |
| Chat & vision | Stream replies, inspect model-provided thinking, optionally search the web, and ask about images |
| Images | Generate an image or use a supported reference-image model |
| Transcribe / Speech / Music | Convert recordings to text, synthesize speech, and generate music |
| Video | Generate a clip or animate a starting image, with job progress and saved output |
| Documents / 3D | Extract document text/layout or create shape artifacts from an image |
| Classify / Embed / Rerank | Evaluate structured questions, produce vectors, and rank candidate documents |
| Workflows | Connect compatible steps and save a sequential recipe |
| Models | Merge store, downloaded, and loaded inventories; discover new model IDs on refresh |

> [!WARNING]
> **Model listings are device-reported metadata, not a compatibility guarantee.** Firmware and runtimes change. Test small inputs first. Model switching unloads models and can affect other clients; restoration can fail after a disconnect or shutdown.

## Chat with thinking and web sources

Chat streams the response and separates returned reasoning into a collapsed **Thinking** panel. Thinking mode and effort controls follow the device’s reported model capabilities. Models that do not return reasoning show only their answer. Turn streaming off if your firmware rejects streaming requests.

Enable **Search the web before each message** to supply up to five search snippets to any compatible chat model. DuckDuckGo needs no key but may rate-limit or request browser verification; Brave Search uses a separate API key. The query is editable, sources are shown with links and retrieval time, and a failed search stops the run. Full pages are not fetched, citations are model-generated, and source claims need checking. No SDK is required.

![Thinking controls, source links, and the web-search privacy notice](docs/images/chat.jpg)

*Chat UI validation: synthetic model and answer, with a live public search query. The pictured response is not a device-generated answer.*

## A dashboard with context

Track reported input/output tokens, runtime decode and prefill t/s, median and p95 execution time, media counts, video generation rate, audio generation rate, and live device load. Filter by period, model, capability, or fixed text-benchmark samples. History persists locally, with CSV and JSON exports.

> [!IMPORTANT]
> **Missing usage is not zero.** Some media runtimes omit token totals. Spindle retains counts when supplied and marks missing measurements. It does not estimate media tokens from frames or pixels. Tiiny’s device-wide ledger is separate from Spindle’s observations and is never added to them. Synthetic screenshots are not performance promises.

[Learn how the measurements and workflows work →](docs/USAGE.md)

## Platform status — what ships today

| Platform / feature | Current status |
| --- | --- |
| Windows | Source launch and local development tested; Node.js 22+ required |
| macOS / Linux | Node-based source; automated CI is configured for these platforms. Physical-device and desktop launcher validation remain pending |
| Docker | **No supported image or Compose deployment yet.** Container networking and secret-file support remain planned |
| Remembered-key encryption | **Not implemented.** DPAPI, macOS Keychain, and Linux credential-store integration are planned |
| Standalone installers | **Not included.** The current release is source plus a Windows launcher |

No Spindle account, cloud inference subscription, external fonts, or animation service is required. Inference goes to the endpoint you configure. This community project is independent and is not an official Tiiny product.

## Explore, test, contribute

- [Detailed usage and configuration](docs/USAGE.md)
- [Security and privacy boundaries](docs/SECURITY.md) · [Private vulnerability reporting policy](SECURITY.md)
- [Validation scope](docs/VALIDATION.md) · [Contributing](CONTRIBUTING.md)

Run `node --test test/*.test.mjs` for isolated tests with fabricated credentials and synthetic fixtures. They do not use your hardware. Preview the illustrative interface without a device using `node scripts/preview-demo.mjs`, then open the printed loopback URL. The demo cannot run real inference.

Build a clean source release with `node scripts/release.mjs --out <new-directory>`. The builder copies an explicit manifest and checks known local identifiers and credential patterns. Publish only that clean folder or its archive.

MIT licensed. See [LICENSE](LICENSE). Current limitations include sequential workflows, no automatic branching/tool execution, a shape-stage 3D adapter, and no guarantee of model restoration after a terminated server.
