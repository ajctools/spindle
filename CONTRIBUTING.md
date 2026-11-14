# Contributing

Start with a small, focused change. Run `npm run regression` before submitting it. Add `-- --browser` for the synthetic browser checks. There are no npm packages to install. See [Validation](docs/VALIDATION.md#running-the-regression-suite) for the commands and optional tools.

Use synthetic fixtures and fabricated credentials. Never commit `data/`, actual environment files, CLI configuration, private endpoints, serials, screenshots of an owner's device, or generated personal media. The release builder uses an explicit file manifest; update it deliberately when adding a distributable file.

Describe what changed, why, and how it was checked. For a model adapter, record request/response contracts in an isolated mock test. A passing mock does not establish hardware compatibility. If you share physical-device results, remove identifiers and distinguish observed output from advertised metadata.

When adding features, exercise the existing workflows that share their capture, model, storage, or playback paths. Cover failure and recovery as well as success. Record security boundaries, device workload, and the browser or hardware combinations actually checked in [Validation](docs/VALIDATION.md).

Capture documentation screenshots with `node scripts/preview-demo.mjs` and a fresh browser profile. Use synthetic data, label it in the docs, and review the visible content and image metadata before committing. Keep README screenshots aligned with the current default branch.

For a release, bump the version in `package.json`. Use a patch for compatible fixes and a minor version for new capabilities. The helper banner, browser footer, and release manifest read this value. Tag the verified release commit as `v<version>`, and include the version in the source archive filename. GitHub Actions checks that the tag and package version match.

Before publishing, build the allowlisted source in a new directory with `node scripts/release.mjs --out <new-directory>`. Check the Windows, macOS, and Linux GitHub Actions jobs. Attach an archive from the clean build and publish release notes that list the user-facing changes.

Keep the security notices clear. Do not remove missing-data labels, silently fall back to plaintext storage under a secure-storage label, expose the helper to a network, or add telemetry without an explicit design discussion.

By submitting a contribution, you agree that your contribution is provided under this project's MIT license. Use private vulnerability reporting for sensitive security findings; see [SECURITY.md](SECURITY.md).
