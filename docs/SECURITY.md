# Security and privacy

Spindle is a local, single-user companion. The server binds to `127.0.0.1`. It is not designed for public hosting, shared-server deployment, or untrusted users on the same computer.

## Credentials and local files

The device key stays on the local server and is not returned to the browser. Session-only connections are the default. Remembering a connection is optional and stores its key **unencrypted** in ignored local data. Session-only Spindle settings do not remove credentials already present in Tiiny CLI configuration or environment variables.

New private directories and files use restrictive POSIX permissions. Windows uses the permissions inherited from the selected data directory; POSIX mode flags do not establish a Windows ACL. Use a private OS account and folder. Disk encryption, backups, cloud-sync settings, browser extensions, and local administrator access are outside Spindle's protection.

The configured endpoint receives the device key and inference inputs. HTTP sends this traffic without TLS; use HTTPS where the device supports it, or a trusted private connection. Spindle does not bypass certificate validation or follow device redirects. Native and management URLs must share the configured endpoint's origin. A changed endpoint cannot silently reuse a saved key.

## Browser boundaries

Private APIs, catalog exports, measurement exports, and saved media require a server-session cookie. The cookie is HTTP-only and SameSite Strict. Origin, Fetch Metadata, and host checks reject browser requests from other origins; the cookie alone is not the only check. Same-origin resource policy and a restrictive content security policy reduce embedding and script-injection exposure.

These boundaries do not protect against a malicious process or administrator already running under the same OS account. There is no separate multi-user login or encrypted local database.

Hardware responses are reduced to an explicit numeric allowlist. Serials, hostnames, interface addresses, and unknown nested fields are not copied into the hardware view. CSV exports neutralize leading spreadsheet formulas. Diagnostics redact configured keys, common encoded key forms, and local user paths. User-authored prompts, outputs, model metadata and custom workflow content may themselves contain sensitive information; inspect them before sharing.

## Public release boundary

Publish only the generated release archive or its extracted source folder. Do not publish an entire development workspace. The release builder copies an explicit source manifest, rejects symlinks, checks known local identifiers and credentials without printing their values, scans for common secret and identifier patterns, and refuses owner-specific artifacts.

Excluded material includes `data/`, actual environment files, CLI configuration, logs, research, owner-specific screenshots, catalog exports, readiness reports, conversations, and generated media. The source `.gitignore` is a secondary guard. It does not remove files already committed to Git. If any private file was committed in a different repository, inspect and clean that repository's history separately and rotate exposed credentials.

There are no third-party runtime packages, analytics requests, external font downloads, or cloud animation services in this version. The Node.js runtime and operating system still need normal security updates.

An automated scan is not proof that every possible vulnerability or form of sensitive content has been identified. Manually review the release manifest and any new documentation or fixtures before publishing. Do not include real customer or device data in a vulnerability report.

References: [OWASP browser request isolation](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [Node filesystem permissions](https://nodejs.org/api/fs.html).

Approved documentation images use the synthetic read-only demo. They contain no owner device state, and all numerical values and model names are illustrative. Native credential-store encryption and Docker packaging remain unimplemented in this release.
