<div align="center">
  <img src="public/logo.png" width="144" height="144" alt="Pide" />
  <h1>Pide</h1>

  <p><strong>Lightweight terminal-first dev workspace, built on <a href="https://github.com/crynta/terax-ai">Terax</a>.</strong></p>

  <p>
    <img src="https://img.shields.io/github/v/release/pirayan20/pide?label=version&color=blue" alt="version" />
    <img src="https://img.shields.io/github/downloads/pirayan20/pide/total?label=downloads&color=blue" alt="downloads" />
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey" alt="platform" />
    <img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="license" />
  </p>

  <p>
    <a href="https://github.com/pirayan20/pide/releases/latest">Download</a>
    ·
    <a href="docs/README.md">Docs</a>
    ·
    <a href="https://github.com/pirayan20/pide/issues">Issues</a>
  </p>
</div>

---

Pide is a lightweight open-source terminal workspace built on Tauri 2 + Rust and React 19. It combines a native PTY backend and WebGL renderer with a code editor, file explorer, source control, Git graph, web preview, and status integration for coding-agent CLIs. About 7-8 MB on disk. No telemetry. No account.

## How it relates to Terax

[Terax](https://github.com/crynta/terax-ai) by Crynta is the base: the Tauri 2 shell, the PTY backend, the WebGL terminal, the CodeMirror editor, the theme engine, and the workspace security model. Pide is a fork, not a plugin, so the whole thing is one codebase rather than a dependency.

Pide is **Terax minus the built-in AI chat, plus provider quota tracking, a source-control panel that replaces GitHub Desktop, richer file previews, and Python interpreter selection.**

What the fork adds:

- **Plan usage in the status bar** - live quota for Claude and Codex with its own OAuth (PKCE, loopback callback, tokens in the OS keychain) and a Settings > Accounts panel, rather than borrowing the CLIs' credentials. Shows the most constrained window, warns as you approach the cap, and backs off when a provider is failing.
- **Source control as a GitHub Desktop replacement** - publish a branch, open the GitHub PR form with the compare URL derived from the real tracking remote, and inspect any commit inline: full message, changed files, and lazy read-only diffs, in a resizable pane over the commit graph.
- **Rich file previews** - Jupyter notebooks, CSV with an RFC-4180 parser, Mermaid diagrams, SVG and HTML, plus zoom, pan, and fit for images and diagrams.
- **Python interpreter selection** - discovers interpreters, remembers one per project, feeds it to pyright over `workspace/configuration`, and exposes it in the command palette.
- **Inline Git change markers** in the editor gutter, against both HEAD and the index.
- **Wider coding-agent support** - Pi alongside Claude Code, Codex, and Gemini CLI, with agent-aware tab icons, per-PTY agent tracking, OSC window titles, and error notifications.
- **Project hierarchy (Spaces)** - ordered spaces and projects that pin the explorer, source control, and new terminals.
- **No built-in AI chat.** Terax bundles one; Pide removes it. The terminal is where the agent lives, so the editor stays a terminal workspace instead of a second chat window.

Fixed in the fork: the UI froze for up to ~40s every 5 minutes because the quota poll ran synchronously on the main thread, where Tauri runs non-async commands.

Pide tracks Terax for upstream fixes. Everything here is Apache-2.0, same as the original. See [NOTICE](NOTICE).

## Features

### Terminal

- xterm.js with WebGL renderer, multi-tab with background streaming
- GPU-accelerated block-based terminal with editor-like command input
- Native PTY backend via `portable-pty` (zsh, bash, pwsh, fish, cmd)
- Split panels (horizontal and vertical)
- Inline search, link detection, true-color
- Per-tab workspace environments on Windows (Local, or any installed WSL distro)

### Code editor

- CodeMirror 6 (supports all popular languages - TS/JS, Rust, Python, Go, C/C++, Java, HTML/CSS, JSON, Markdown, etc.)
- Vim mode
- Ten built-in editor themes: Atom One, Aura, Copilot, GitHub Dark / Light, Gruvbox Dark, Nord, Tokyo Night, Xcode Dark / Light

### Source control

- Stage / unstage hunks, commit (Cmd+Enter / Ctrl+Enter), push with upstream awareness
- Branch display including detached HEAD state
- Git history pane with a real commit graph (lane rendering for merges and branches)
- Commit search and filter, click through to the remote commit page

### File explorer

- Catppuccin icon theme
- Fuzzy search, keyboard navigation, inline rename, context actions

### Web preview

- Auto-detects local dev servers and opens them in a preview tab
- External URL preview via a native child webview

### Themes and customization

- Custom themes built in-app, switch between bundled presets and your own
- Create your own themes, share them or import from the community
- Background images with adjustable opacity and blur
- Editor theme is independent from the app theme

### Coding-agent CLI integration

- Detects supported coding-agent CLIs running in terminal sessions
- Tab status badges and attention notifications
- Optional hooks for Claude Code, Codex, and Gemini CLI
- Plan usage in the status bar for Claude and Codex, read from the CLI's own credentials. Nothing is sent anywhere; the app talks to the provider directly and caches the result.

## Install

Latest installers are on the [Releases](https://github.com/pirayan20/pide/releases/latest) page. Pide auto-updates from there.

### macOS notes

- Pick the build that matches your Mac: `aarch64` for Apple Silicon (M1 and later), `x64` for Intel.
- Pide is not yet notarized by Apple, so the first launch is blocked. macOS reports this as **"Pide is damaged and can't be opened"**, which is misleading: it means unnotarized, not corrupt. Clear the download quarantine flag once:

  ```sh
  xattr -dr com.apple.quarantine /Applications/Pide.app
  ```

  Then open it normally. Alternatively, open **System Settings > Privacy & Security**, scroll to the blocked-app notice, and choose **Open Anyway**.

### Windows notes

- On first launch Windows shows "Windows protected your PC" because Pide isn't code-signed yet. Click **More info** then **Run anyway**.
- Default shell detection: `pwsh.exe` (PowerShell 7+) -> `powershell.exe` (Windows PowerShell 5.1) -> `cmd.exe`.
- WSL is a first-class workspace environment, not a wrapped subprocess.

### Linux notes

- **NixOS / Nix**: use the official flake - `nix profile install github:pirayan20/pide` (non-NixOS), or import the flake and add `inputs.pide.packages.${pkgs.system}.pide` to `environment.systemPackages` (NixOS). The `nixosModules.pide` output is also available for a simpler setup.
- **AppImage:** needs FUSE. Without it: `./Pide_*.AppImage --appimage-extract-and-run`. On Wayland with rendering glitches, try `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Otherwise the `.deb` / `.rpm` packages link against the system GTK stack and tend to be smoother.

## Build from source

**Prerequisites**
- Rust (stable), https://rustup.rs
- Node 20+ and [pnpm](https://pnpm.io)
- Tauri prerequisites for your platform, https://tauri.app/start/prerequisites/

**Run**
```bash
pnpm install
pnpm tauri dev          # development
pnpm tauri build        # production bundle
```

**Checks**
```bash
pnpm lint
pnpm check-types
pnpm test
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings   # Rust lint (matches CI)
cd src-tauri && cargo nextest run --locked                           # or: cargo test --locked
```

## Tech stack

Tauri 2, Rust, `portable-pty`, React 19, TypeScript, Vite, xterm.js, CodeMirror 6, Tailwind v4, shadcn/ui, Zustand.

## Contributing

Issues and PRs are welcome! Feel free to open issues, suggest features, or submit pull requests. See [CONTRIBUTING.md](CONTRIBUTING.md) and the [architecture docs](docs/README.md) for more details.

## License

Pide is licensed under the Apache-2.0 License. For more information on our dependencies, see [Apache License 2.0](LICENSE).

Pide began as a fork of [Terax](https://github.com/crynta/terax-ai) by Crynta, also Apache-2.0. See [NOTICE](NOTICE).

## Star history

<div align="center">
  <a href="https://www.star-history.com/#pirayan20/pide&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=pirayan20/pide&type=Date&theme=dark" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=pirayan20/pide&type=Date" />
      <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=pirayan20/pide&type=Date" />
    </picture>
  </a>
</div>
