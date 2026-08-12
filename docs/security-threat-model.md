# Security threat model

FrameOS processes adversarial files and model output through high-complexity native libraries. Its primary trust boundaries are the client-to-daemon API, allowed media roots, project bundles, provider APIs, the daemon-to-worker IPC boundary, and dynamically discovered plugins.

| Threat                                   | Current control                                                                                      | Remaining release work                                                          |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Spoofed API caller                       | Constant-time bearer comparison; loopback install token; named scoped tokens in remote mode          | Rotation/revocation endpoint and OS credential-store integration                |
| Unauthorized edit/render                 | Separate read, project-write, render, agent, MCP, and admin scopes; agent approval policy persisted  | Enforce operation/time/cost budgets during the full execution loop              |
| Project/history tampering                | Strict schemas, UUID paths, atomic snapshots, append-only NDJSON, immutable render revision          | Signed provenance manifests and optional bundle integrity tree                  |
| Path traversal or symlink escape         | Absolute paths are realpath-canonicalized beneath explicit roots                                     | Platform conformance/fuzz corpus for junctions and network shares               |
| SSRF through media URI                   | Transactions reject non-file schemes; downloads require a future approved service                    | Hardened downloader with DNS/IP revalidation and size limits                    |
| Malicious media/plugin crash             | Native/model work is out of process, killable, and bounded by job and manifest limits                | OS sandbox profiles, hard memory/CPU/disk quotas, crash dump redaction          |
| Plugin/license expansion                 | Explicit manifests pin executable/model/resource hashes and licenses; packaged modules use allowlist | Signed manifests and SBOM verification against packaged hashes on each platform |
| Prompt injection in metadata/transcripts | Provider prompt labels project state as untrusted; model can only plan in current wave               | Structured tool policy, approval gates, evals, and taint-aware context assembly |
| Credential disclosure                    | Headers are redacted; analyzer children receive a clean environment without provider credentials     | OS credential stores and automated secret scanning                              |
| Denial of service                        | Body/WebSocket limits, rate limit, 200-operation transaction cap, provider timeout                   | Per-token quotas, worker resource limits, disk reservation, upload limits       |

Remote mode is disabled unless TLS paths and at least one scoped token are configured. MCP has its own scope because an MCP session exposes both read and mutation tools. Operators should issue it only to principals authorized to edit projects.
