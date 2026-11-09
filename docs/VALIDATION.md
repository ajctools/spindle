# Validation

Run `node --test test/*.test.mjs` with Node.js 22 or newer. Tests use isolated local mock servers, temporary data directories, fabricated keys, and synthetic media. They do not connect to a real Tiiny or read its credentials.

Coverage includes all task adapters, workflow file handoffs and model restoration, connection setup without a CLI, audio normalization, token provenance, missing versus zero usage, media metadata, history persistence, filtering, exports, and repeatable text benchmarks.

Security checks cover anonymous private-data reads, host validation, cross-origin reads and writes, session bootstrap, rejected remote redirects, diagnostic secret/path redaction, hardware identifier filtering, CSV formula neutralization, and release allowlisting.

Public releases contain no owner-specific device validation logs, installed-model inventory, readiness history, prompts, generated media, screenshots, or personal benchmark results. Hardware readiness is recorded locally in the ignored data directory. Passing mock tests does not establish support for every firmware version or model.

Synthetic image fixtures contain generated graphics and sample document text. The speech fixture is synthesized speech, not a recording of a user.

Chat/search coverage includes split UTF-8 and CRLF stream frames, streamed reasoning, tagged reasoning, JSON responses, final usage, truncated/invalid streams, capability-gated thinking controls, source/HTML escaping, fixed provider destinations, credential separation, failure behavior, response limits, and live reasoning through the workflow bridge. Search providers are mocked in automated tests; live provider availability and every model/firmware combination are not guaranteed.
