# Security policy

**Spindle is a local, single-user preview. Do not expose its helper server publicly.**

- HTTP device connections do not encrypt the API key, prompts, files or responses in transit.
- Remembered keys are stored in plaintext in this release. Leave remembering off for a session-only Spindle connection. Native OS keychain integration is not implemented.
- Existing Tiiny CLI credentials and environment variables have their own storage and lifecycle.
- This app does not protect against malicious software or administrators on the same computer.
- Runtime data and exports can contain private information. Review material before sharing it.

See [the full security and privacy notes](docs/SECURITY.md) for the threat model, browser boundaries and publication safeguards.

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** feature for private reports. Do not post API keys, real endpoints, personal logs, screenshots containing private data or exploitable details in public issues. Provide a minimal reproduction with fabricated credentials and synthetic data.

The current 0.4.x preview is the supported development line. There is no guaranteed response time or independent security certification.

## Optional external web search

Search is off by default. When explicitly enabled for a chat or workflow step, the query (or current prompt if no query is supplied) leaves the local setup over HTTPS to DuckDuckGo or Brave Search. No conversation history, attachments, or Tiiny key are sent to the search provider. Queries/results are saved in local run history. Brave credentials are separate, kept in helper memory only, never returned to the UI or written to runs/workflows. Forget the key or restart the helper to clear it. Search results are untrusted text, rendered escaped and supplied as evidence with instructions to disregard embedded commands. Models can still be misled by source content; review claims and citations. Full-page fetching and model-selected tool execution are not implemented.
