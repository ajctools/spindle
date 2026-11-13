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

Report issues against the current `main` branch or identify the tagged release you used. There is no guaranteed response time or independent security certification.

## Optional external web search

Search is on by default and the browser remembers the choice. The external-query notice remains visible beside Send when Chat options is collapsed. Standalone Chat sends either your explicit query or a query Tiiny generates from the current message to DuckDuckGo or Brave Search over HTTPS. Use a short, explicit query when the message contains sensitive details. Workflow steps that use shared input or a prior result require an explicit query. See [Security & privacy](docs/SECURITY.md#optional-external-web-search) for what search shares and stores.
