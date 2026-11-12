# Let the Tiiny build a museum app

The default museum workflow asks a downloaded Tiiny coding/chat model to write **all custom museum application code**: HTML, CSS, architecture, scene, lighting, materials, navigation, timeline, inspection panels and audio controls. It uses the standard [Three.js r187](https://github.com/mrdoob/three.js/tree/r187) rendering library and its standard environment-lighting/post-processing helpers, bundled offline with its MIT notice. Spindle supplies no custom gallery implementation.

Spindle supplies the workflow machinery: public-source capture, model sequencing, media handoffs, an inert data contract, isolated browser tests, exact application of Tiiny-written repairs, source hashes and offline packaging. Image, speech, music and 3D content also come from the Tiiny when those roles are enabled. No cloud AI account, Tiiny SDK or npm dependencies are required.

## Before you start

- Run Spindle with Node.js 22 or newer and connect your Tiiny.
- Download a coding/chat model. A dedicated coding model is preferred when discovered; selectors reflect the device's downloaded inventory.
- Install local Chrome or Edge for the automatic browser test-and-repair loop. Standard desktop locations are discovered; `SPINDLE_BROWSER` can identify another Chromium executable. The model never chooses an executable or shell command.
- Optional downloaded image, 3D, speech and music models add the creative media. A downloaded vision model can review the generated app's screenshot. A separate coding model can handle focused debugging while the application engineer handles the complete app and larger design changes. Repair requests enable thinking and low effort only when the selected model reports those controls.

## One-click path

1. Open **Workflows → TiinyVerse museum**.
2. Keep **Tiiny writes the entire museum app** checked and the supplied signature brief selected. Expand customization to select the application engineer, optional focused debugger and optional visual reviewer.
3. Read the build plan. Choose **Let Tiiny build the museum app · top six**, or import first and select your own projects.
4. Spindle retrieves a bounded public top-liked UseCase snapshot, captures static project evidence, and runs the selected local media stages.
5. The Tiiny plans and writes the complete custom application. A local code-review pass checks the actual implementation and sends concrete defects back for native repairs. Spindle compiles its scripts without executing them in Node, substitutes the inert data slot, then runs it in a separate browser profile with network access blocked.
6. Startup, real WebGL drawing, actual camera movement, timeline controls, reading content, phone layouts, audio-start behavior and resource requests are checked. Errors go back to the Tiiny. The optional vision model reviews a screenshot. Repairs are exact edits supplied by the Tiiny, with hashes linking each source version.
7. Open the accepted museum or download its self-contained HTML. The export includes links to the raw application source and an authorship/test record. You can inspect the model responses in saved step outputs.

A six-exhibit signature plan starts with at least **22 model stages** when all media and visual review are available: 18 content/media stages, an application plan, complete custom code, a native code review and a visual review. Repairs and repeat reviews add work. Repeated unchanged edits trigger a separate Tiiny diagnosis before another patch. Budget a long local run; time and success depend on the models, firmware and generated program. The app author is allowed five source attempts per run, and saved work can be resumed. Spindle never silently substitutes its template if the Tiiny's app fails.

## Continue existing work

**Let Tiiny write an app from these saved exhibits** reuses finished writing and media and asks the device to author a new application. This upgrades museums originally made with the supplied template. The old renderer and controls are not passed to the coding model.

**Resume saved work** keeps native outputs, source attempts, exact edit replies, private screenshots and failure evidence. An interrupted whole-app code stream can continue from its saved native prefix; a complete returned document can be recovered without generating it again. Continuation hashes record the prefix and native suffix separately. The Tiiny can continue repairing its app. Completed inference is not counted again in local usage history. Retained native 3D tasks are inspected after their runtime is loaded rather than automatically submitted twice.

**Repack saved gallery · no generation** never invokes a model. Tiiny-authored apps keep their original code; template galleries use the supplied engine. Media and captured facts are packed into a new offline file. An incompatible source is reported rather than repaired without a generation request.

**Rebuild with latest sources** captures public posts again. Unchanged exhibits retain generated media; changed posts receive fresh source text. Earlier exports remain saved. Offline exports are dated snapshots, not live web pages.

## What the Tiiny can generate

| Role | Signature recipe |
| --- | --- |
| Curator | Grounded labels, narration scripts, mural and sculpture ideas |
| Image model | Stone/walnut surfaces, one mural per exhibit and a solid hero-object reference |
| 3D model | A shape from the reference; compatible geometry is reduced while originals remain saved |
| Speech model | A guide voice for each exhibit |
| Music model | An instrumental soundscape |
| Application engineer | All custom application code and every repair, using the standard rendering library |
| Optional focused debugger | Short runtime and asset repairs; otherwise the application engineer handles these too |
| Optional vision reviewer | A critique of the generated app's actual screenshot |

Supplied prompts distinguish authentic screenshots from artistic interpretations. Dates mean **shared on TiinyVerse**, not an invented creation date. Author credit, source links, capture dates and unknown-versus-zero engagement remain attached. Public source content is untrusted data, not application instructions.

## Refine the result with your Tiiny

Expand **Ask Tiiny to refine this app** under a saved generated app. Keep the existing media and request a focused change, for example: “Brighten the exhibit walls while keeping the entrance atmospheric,” “Make the ceiling more celestial without slowing phones,” or “Frame each timeline stop so its authentic screenshot is easy to see.” The local model edits its source and repeats browser/visual checks. The earlier export remains saved. No external coding assistant is required.

## Template preview is a separate option

**Template preview · no inference** uses Spindle's existing gallery engine. Unchecking **Tiiny writes the entire museum app** also selects that engine for a media-generation workflow. These are labeled shortcuts; they do not meet the stronger claim that the Tiiny wrote the app. Previous template museums remain available and unchanged.

## Local execution and portability

The generated app uses inline custom code, the pinned standard Three.js library and embedded media, with no CDN, external scripts, fonts or inferred cloud service. The export includes the full third-party MIT notice. Source records distinguish Tiiny-written custom code from the standard library; its version, helper exports, primary-source module hashes, source URL and bundle SHA-256 are recorded. Its application code is tested in an isolated browser, not evaluated in Node. The preview has an opaque sandbox origin and a no-network content policy. Opening an original source link is an explicit user action in the exported app.

The helper accepts compatible GLB source geometry up to 96 MiB and 3,000,000 triangles, reduces it to the display budget, and provides positions/normals as data. It supplies no shader, scene or camera code to the author model. Optional FFmpeg creates smaller audio copies without inference. Unsupported geometry remains downloadable with an explanation.

Generated code can fail; software-browser checks are not performance benchmarks for every phone/GPU. Saved source, reports and screenshots make the result reviewable. Histories and generated artifacts stay in ignored local data and are excluded from source releases. See [Security & privacy](SECURITY.md) for HTTP and remembered-key limitations.

**Before sharing an export**, check the included source images, user-supplied screenshots, exhibit text, narration, and generated code. The self-contained HTML includes its media.
