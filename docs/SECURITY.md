# Security and privacy

Spindle is a local, single-user companion. The server binds to `127.0.0.1`. It is not designed for public hosting, shared-server deployment, or untrusted users on the same computer.

## Credentials and local files

The device key stays on the local server and is not returned to the browser. Session-only connections are the default. Remembering a connection is optional and stores its key **unencrypted** in ignored local data. Session-only Spindle settings do not remove credentials already present in Tiiny CLI configuration or environment variables.

New private directories and files use restrictive POSIX permissions. Windows uses the permissions inherited from the selected data directory; POSIX mode flags do not establish a Windows ACL. Use a private OS account and folder. Disk encryption, backups, cloud-sync settings, browser extensions, and local administrator access are outside Spindle's protection.

The configured endpoint receives the device key and inference inputs. HTTP sends this traffic without TLS; use HTTPS where the device supports it, or a trusted private connection. Spindle does not bypass certificate validation or follow device redirects. Native and management URLs must share the configured endpoint's origin. A changed endpoint cannot silently reuse a saved key.

## Browser boundaries

Private APIs, catalog and measurement exports, saved media, and installed local HTML require a server-session cookie. The cookie is HTTP-only and SameSite Strict. Origin, Fetch Metadata, and host checks reject browser requests from other origins. Same-origin resource policy and a restrictive content security policy reduce embedding and script-injection exposure.

These boundaries do not protect against a malicious process or administrator already running under the same OS account. There is no separate multi-user login or encrypted local database.

Hardware responses are reduced to an explicit numeric allowlist. Serials, hostnames, interface addresses, and unknown nested fields are not copied into the hardware view. CSV exports neutralize leading spreadsheet formulas. Diagnostics redact configured keys, common encoded key forms, and local user paths. User-authored prompts, outputs, model metadata and custom workflow content may themselves contain sensitive information; inspect them before sharing.

## Public release boundary

Publish only the generated release archive or its extracted source folder. Do not publish an entire development workspace. The release builder copies an explicit source manifest, rejects symlinks, checks known local identifiers and credentials without printing their values, scans for common secret and identifier patterns, and refuses owner-specific artifacts.

Excluded material includes `data/`, actual environment files, CLI configuration, logs, research, owner-specific screenshots, catalog exports, readiness reports, conversations, and generated media. The source `.gitignore` is a secondary guard. It does not remove files already committed to Git. If any private file was committed in a different repository, inspect and clean that repository's history separately and rotate exposed credentials.

Spindle has no npm runtime dependencies, analytics requests, external font downloads, or cloud animation services. The museum bundles a pinned copy of Three.js with its MIT license. The Node.js runtime and operating system still need normal security updates.

An automated scan is not proof that every possible vulnerability or form of sensitive content has been identified. Manually review the release manifest and any new documentation or fixtures before publishing. Do not include real customer or device data in a vulnerability report.

References: [OWASP browser request isolation](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [Node filesystem permissions](https://nodejs.org/api/fs.html).

Documentation screenshots use the synthetic demo, with a fresh browser profile and no live device or web queries. The demo serves synthetic data and blocks writes, inference jobs, and live public-source imports.

## Optional external web search

General headline requests in standalone Chat may fetch fixed public BBC News and CBS News feeds over HTTPS. Those feed requests carry no prompt, query, attachments, or credentials. Spindle treats feed entries as untrusted evidence and filters them locally by publication time.

For automatic general search, Tiiny prepares both queries before seeing search results. Tiiny reviews the excerpts locally and selects existing source numbers. Spindle may try the alternate query and read text from up to two public HTTPS result pages. Page requests use the returned hostname and path, omit query strings and credentials, reject redirects, and pin a validated public IPv4 address. Spindle does not execute page scripts or load page resources.

A standalone request to read a supplied HTTPS URL can fetch that page directly. The destination receives the URL path. Use **Send to Tiiny only** when the link or path is private.

Search is on by default and the on/off choice is remembered in this browser. The external-query notice remains visible beside Send even when Chat options is collapsed. In standalone Chat, Spindle can extract a query from a short lookup, or Tiiny can draft one from the current prompt. An explicit query overrides both. Only the resulting query goes to DuckDuckGo or Brave Search over HTTPS. Workflow search can use an eligible step prompt directly. No conversation history, attachments, or Tiiny key are sent to the search provider. Workflow steps that insert shared input or a prior result require an explicit search query. Queries/results are saved in local run history. Brave credentials are separate, kept in helper memory only, never returned to the UI or written to runs/workflows. Forget the key or restart the helper to clear it. Search results are untrusted text, rendered escaped and supplied as evidence with instructions to disregard embedded commands. Models can still be misled by source content; review claims and citations. Searches planned by Tiiny may read bounded page excerpts under the restrictions above.

### Eyewall feeds and model review

Eyewall reads a bounded local cache in `data/eyewall-reports.json`. Refresh sends fixed HTTPS requests to public feed and discovery providers. Reports are treated as untrusted text, and opening a source link is a separate browser navigation. Feed requests carry no saved leads, private workspace content, or device credentials.

An optional headline review uses the selected loaded Tiiny chat model or configured local OpenAI-compatible endpoint. Only public headlines and their batch indexes are sent as input. Inference uses the selected endpoint's normal authentication and transport. The helper accepts only recognized topic and relevance labels and never turns model output into search requests or verification.

## Local search, attachments, and exports

**Search Spindle** searches the local data loaded in your browser. Search terms stay in that view. **Attach from Vault** sends the selected excerpt to the configured Tiiny along with your next prompt. Spindle keeps the raw excerpt out of the saved request and drops raw runtime fields from that run. The model can still quote the excerpt in its saved answer or reasoning. Use **Send to Tiiny only** to skip web search for a sensitive prompt.

**Project memory** stores explicitly saved replies, briefs, and cached embeddings in the helper's private `data/` directory. It uses `projects.sqlite` when Node supports it, with secure deletion enabled, or private JSON storage on older compatible Node versions. These files are unencrypted and excluded from release packages along with database journals. When semantic recall is available, the configured Tiiny receives the current prompt and any briefs that need embeddings. Recalled briefs are sent to Tiiny as reference for the answer. Web providers receive no automatically recalled project context. Text you type into a search-enabled prompt can still shape its query. Removing a checkpoint removes its stored project copy and cached vector. Copies in original chat runs, exports, or backups have their own retention.

Uploaded text and long-paste attachments are sent to the selected chat endpoint as conversation context and saved in local run history. For Tiiny chats, web search pauses on a turn with text attachments unless you provide a separate query.

Custom and cloud endpoints receive the current prompt, prior turns, and attached text for chats using their models. Cloud endpoint profiles require HTTPS and are selected explicitly in Chat. Spindle sends only that endpoint’s key, if supplied. A remembered key is stored in plaintext in the private data folder. An unremembered key stays in server memory. These chat endpoints do not use Spindle’s web search, Vault, or project recall. Eyewall model review is limited to Tiiny and eligible local custom endpoints.

Chat recovery stores the last accepted run ID in the browser. The authenticated helper supplies the saved turns and attachments when you return. **New chat** clears the remembered run ID. Previous runs remain in the local library.

Meeting Desk recordings and transcripts, saved review edits, run prompts and replies, and workflow source assets can all contain private data. Meeting Desk retains only audio from a shared tab and releases the browser’s capture tracks when recording ends. The draft stays in browser memory until you download or submit it. Optional live preview sends audio clips to Tiiny, with queued clips and preview text held temporarily in the browser. A hotword match prepares an editable query. Submitting that query sends it to DuckDuckGo. Facsimile Book prepares scans in the browser and sends text for requested translation or narration. Its HTML export embeds reviewed scans and text, plus narration when selected. Review the contents of minutes, cut sheets, and booklets before sharing.

**Settings → Security & Privacy** offers a session-only, opt-in trace of Tiiny chat and search requests. It records destinations, transport and response metadata rather than prompts, bodies, keys, or cookie values. The trace export strips Tiiny addresses and internal run IDs. Review exports before sharing.

## Offline museum exports

The in-app 3D preview reads only saved GLB assets behind the local session boundary. It uses a bundled bounded geometry reader, rejects external resource URIs and leaves originals unchanged. Preview preparation and rendering do not submit inference or fetch a CDN. The dashboard's cloud-price comparison is local arithmetic on filtered text-usage counters. Its provider links are opened only by an explicit click; usage and prompts are not sent for pricing.

The museum importer reads a fixed public TiinyVerse topic endpoint without device credentials, browser authentication, local prompts, or conversation history. Only public/published entries and a narrow metadata allowlist are retained. Public project source text is untrusted input; model curation is parsed as bounded exhibit data, with attribution, dates, and source links retained from the input rather than the model.

The template-preview path uses a bundled renderer. The default Tiiny-author path executes model-generated HTML/JavaScript only in an isolated browser and sandboxed preview, never in the Node helper. Source scripts are compiled without host execution. Browser network requests are blocked, and no device address/key, helper session or owner identifiers are included in app data. Exact code edits come from the Tiiny; raw responses, source hashes and checks remain saved locally. The export embeds Tiiny-written custom application source, inert media/data, a restrictive content policy and the pinned standard Three.js r187 rendering library with its MIT notice. The library integrity hash is checked before packing and credited separately in provenance; no custom host gallery implementation is inserted. Exported JSON escapes HTML delimiters and executable media types are rejected. Exported files contain selected public source facts and explicitly generated local media; they do not contain the Tiiny key or device address. They are private local artifacts until the user shares them. Spindle serves HTML downloads as attachments and previews with an isolated-origin sandbox plus a no-network content policy. A downloaded museum has embedded images/narration and makes no external requests during exploration; clicking a source link intentionally opens that public page.

Refresh fetches fixed public post JSON endpoints, allowlisted TiinyVerse raster-image paths, and GitHub's repository README endpoint as plain text. Redirects are rejected; responses have time and byte limits. Raster media requires a supported MIME type and matching signature. Scripts and fenced code are stripped from captured text. No project scripts, bundles, executable embeds, or arbitrary linked pages are requested. Captured text is escaped in the viewer. Source/image hashes are compared locally; no model prompt, local screenshot, history, device credential, or owner identifier is sent to these public sources. Optional GLB geometry must be embedded, uncompressed, bounded triangles with no external resource URI; unsupported shapes fall back to procedural displays.
