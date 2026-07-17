# Roadmap

This fork is a fast, lightweight terminal-first development workspace for people who run coding-agent CLIs directly in their terminals.

## Product principles

1. **Lightweight always.** Keep the installed application and runtime footprint small. Every dependency must justify its cost.
2. **Terminal-first.** PTY fidelity, shell behavior, TUI compatibility, and command completion are non-negotiable.
3. **Coding-agent CLI friendly.** Detect supported agents running inside terminals and surface status without replacing their own interfaces.
4. **Cross-platform parity.** Support macOS, Linux, Windows, and WSL without platform-exclusive core features.
5. **Security by default.** Validate IPC, filesystem, process, workspace, and terminal escape-sequence boundaries.

## Shipped

### Terminal

- [x] Multi-tab terminal with WebGL renderer
- [x] Native PTY backend for zsh, bash, pwsh, fish, and cmd
- [x] Split panes
- [x] Shell integration for cwd and prompt boundaries
- [x] Shell-history suggestions, command completion, and path completion
- [x] Inline search, link detection, and true color
- [x] Private ephemeral terminal tabs
- [x] WSL workspace environments

### Editor and workspace

- [x] Multi-language CodeMirror editor
- [x] Vim mode and editor themes
- [x] External format-on-save support
- [x] File explorer with fuzzy search and keyboard navigation
- [x] Source control, per-file diffs, and Git history graph
- [x] Local development server preview
- [x] Markdown, image, and PDF preview

### Coding-agent CLI integration

- [x] Terminal activity detection for supported coding-agent CLIs
- [x] Per-tab working and attention status
- [x] Header notifications and attention navigation
- [x] Optional hooks for Claude Code, Codex, and Gemini CLI

### Platform integration

- [x] macOS, Linux, Windows, and WSL
- [x] Auto-updater
- [x] Windows Explorer integration
- [x] No telemetry or account requirement

## Planned

### Near term

- [ ] SSH support, starting with PTY authentication and known-host handling
- [ ] Terminal and UI customization improvements
- [ ] Drag and drop files into terminals as correctly quoted paths
- [ ] Persistent terminal sessions and stronger layout restoration
- [ ] Preview improvements for images and Markdown
- [ ] More PTY, shell-integration, and cross-platform tests

### Longer term

- [ ] Release automation
- [ ] Measured bundle and startup optimization
- [ ] Live filesystem updates in the explorer and editor
- [ ] Selective TypeScript-to-Rust migration only where profiling proves value

## Out of scope

- A built-in AI chat, model-provider layer, or agent runtime
- Heavy IDE features that duplicate a full editor or debugger
- Notebook and document workspaces
- Package-manager and toolchain dashboards
- Full browser features in the preview pane
- Telemetry, analytics, and user accounts
- A large extension marketplace

Use coding-agent CLIs, compilers, package managers, and other developer tools through the terminal rather than rebuilding them into the application.
