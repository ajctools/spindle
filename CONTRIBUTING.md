# Contributing

Start with a small, focused change. Run `node --test test/*.test.mjs` before submitting it. There are no npm packages to install for the current application.

Use synthetic fixtures and fabricated credentials. Never commit `data/`, actual environment files, CLI configuration, private endpoints, serials, screenshots of an owner's device, or generated personal media. The release builder uses an explicit file manifest; update it deliberately when adding a distributable file.

Describe what changed, why, and how it was checked. For a model adapter, record request/response contracts in an isolated mock test. A passing mock does not establish hardware compatibility. If you share physical-device results, remove identifiers and distinguish observed output from advertised metadata.

Documentation screenshots must use the read-only demo and remain clearly labeled as synthetic. Do not present demo rates as Tiiny benchmarks.

Keep the security notices clear. Do not remove missing-data labels, silently fall back to plaintext storage under a secure-storage label, expose the helper to a network, or add telemetry without an explicit design discussion.

By submitting a contribution, you agree that your contribution is provided under this project's MIT license. Use private vulnerability reporting for sensitive security findings; see [SECURITY.md](SECURITY.md).
