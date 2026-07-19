# Security

Pide runs shells, reads and writes files, launches language servers, and interprets terminal output. If you find a security issue, report it privately before posting publicly.

## Reporting

Email **security@pide.app** with:

- What the issue is and what it allows
- Reproduction steps or a small proof of concept
- Version, operating system, and architecture

Please do not open a public GitHub issue for security reports.

## Supported versions

Until `1.0.0`, only the latest minor release receives security fixes. See `package.json` or the Releases page for the current version.

## In scope

- Rust backend behavior in `src-tauri/`, including PTY, filesystem, process, IPC, and plugin boundaries
- Frontend handling of untrusted terminal output, paths, and file content
- Workspace authorization and coding-agent OSC hook processing
- Release artifacts and the auto-updater

## Out of scope

- Vulnerabilities in upstream dependencies, which should be reported upstream first
- Issues requiring an already compromised machine or local shell access
- Unsupported old releases

## Security controls

- The webview has no Node.js access and reaches the host only through registered Tauri commands.
- Process cwd values are checked against the workspace authorization registry.
- One-shot formatter output is capped and execution is timed out.
- PTY and language-server child processes use platform-specific lifecycle cleanup.
- Coding-agent status accepts recognized OSC markers rather than matching raw terminal text.
- Updates are verified before installation.
- No telemetry or user account is required.

## Limitations

Pide is a terminal and runs commands with the current user's permissions. Review commands and scripts before executing them, especially in untrusted repositories.
