# Security model

This guide elaborates on `PIDE.md`. If anything here conflicts with `PIDE.md`, `PIDE.md` wins.

Pide launches shells, reads and writes workspace files, runs formatters, controls language servers, and interprets terminal escape sequences. Each boundary validates input before acting on it.

## Boundaries

1. **IPC boundary:** only commands registered in `src-tauri/src/lib.rs` and allowed by `src-tauri/capabilities/default.json` are available to the webview.
2. **Workspace boundary:** PTY spawn, Git operations, filesystem access, language servers, and formatter commands are scoped through the workspace environment and authorization registry.
3. **Process boundary:** PTYs, formatters, and language servers use bounded lifecycle management and platform-specific child cleanup.
4. **Terminal boundary:** OSC sequences are parsed for cwd, prompt, and coding-agent state, but raw terminal output never directly mutates application state.
5. **Preview boundary:** preview content remains isolated from privileged Tauri APIs.

## Workspace authorization registry

`WorkspaceRegistry` in `src-tauri/src/modules/workspace.rs` tracks directories that process and Git commands may use.

- `workspace_authorize` adds a user-selected directory.
- `authorize_spawn_cwd` rejects a spawn cwd outside an authorized root.
- `authorize_user_spawn_cwd` registers a user-selected cwd as a new root.
- Startup authorizes the launch directory and the user's home directory.

Any new command that spawns a process or accesses paths outside the active workspace must use this registry rather than trusting a frontend path.

## Filesystem and Git commands

Filesystem and Git operations live in Rust. Frontend code passes the current workspace environment with each request. Rust canonicalizes or validates paths at the command boundary and rejects unauthorized repository operations.

New mutation commands must:

- accept an explicit workspace environment;
- validate the target against authorized roots;
- avoid following untrusted path assumptions from the webview;
- return structured errors rather than exposing internal process state.

## Process execution

Interactive terminals use `portable-pty`. One-shot formatter execution uses `shell_run_command`, which validates cwd, caps captured output, applies a timeout, and runs off the Tauri async thread.

Language servers are started only for resolved project roots, have bounded session counts, and are terminated as process groups or Windows Job Objects. PTY sessions use the same platform-specific process cleanup principles.

## OSC trust gating

The terminal parses these OSC sequences from the PTY stream:

- **OSC 7** updates the terminal cwd.
- **OSC 133 A/B/C/D** marks prompt and command boundaries.
- **OSC 777** reports supported coding-agent CLI state transitions.

The detector in `src-tauri/src/modules/pty/agent_detect.rs` is armed by command-boundary information or an installed self-arming hook. It emits `pide:agent-signal` events from recognized OSC markers only. Repainting TUI output cannot produce state transitions by matching plain text.

## Tauri capabilities

A new plugin API requires all of the following:

1. A Cargo dependency.
2. Plugin initialization in `src-tauri/src/lib.rs`.
3. The narrowest required permission in `src-tauri/capabilities/default.json`.

Do not grant broad plugin permissions speculatively.

## Invariants

- The webview does not access the filesystem, Git, PTYs, or process APIs directly.
- Process cwd values remain inside authorized workspace roots.
- New IPC commands validate every untrusted argument.
- New plugin APIs require explicit capability entries.
- Agent status is driven by recognized OSC markers, never raw terminal text.
- Preview content does not gain privileged Tauri access.

## See also

- [`PIDE.md`](../../PIDE.md)
- [`docs/README.md`](../README.md)
- [Two-process model](two-process-model.md)
- [PTY shell integration](pty-shell-integration.md)
