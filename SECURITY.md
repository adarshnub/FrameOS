# Security policy

FrameOS treats media, project JSON, transcripts, plugins, model output, and remote URLs as untrusted input.

- The daemon binds to loopback by default and requires a generated bearer token.
- Non-loopback binding is rejected unless TLS certificate/key paths and explicit API tokens are configured.
- Project identifiers are UUIDs and all filesystem paths are canonicalized beneath configured roots.
- Native media work occurs in a separate process; worker crashes become job failures.
- Raw MLT properties and unapproved plugins are disabled by default.
- Credentials are configuration-only and must never be stored in project bundles or logs.

See [the threat model](docs/security-threat-model.md) for trust boundaries, implemented controls, and remaining release gates.

Please report vulnerabilities privately to the repository owner. Do not include private media, tokens, or model credentials in public issues.
