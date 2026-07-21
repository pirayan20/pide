# Pull Request Review Flow Design

## Goal

Let Pide create or find a GitHub pull request after the current branch is fully committed and pushed, then provide one blue **Review PR** button that opens the pull request in the system browser.

## Scope

This feature belongs in the Source Control panel and supports GitHub repositories through the authenticated GitHub CLI, `gh`.

Included:

- Detect whether the clean, synchronized branch already has an open pull request.
- Create a pull request with `gh pr create --fill` when none exists.
- Show a blue **Review PR** button once a pull request URL is available.
- Open the pull request URL with Tauri's existing opener plugin.
- Explain missing CLI, missing authentication, invalid branch, and command failures in the existing Source Control feedback area.

Excluded:

- Built-in GitHub OAuth or token storage.
- GitLab, Bitbucket, or other hosting providers.
- A custom pull request title or description editor.
- Automatic browser opening immediately after creation.
- Pull request merge, close, review, or status management.

## User Experience

The pull request action appears in the Source Control panel only when:

- A Git repository is loaded.
- The working tree and index are clean.
- HEAD is attached to a named branch.
- The branch has an upstream.
- The branch is neither ahead of nor behind its upstream.

While Pide checks for an existing pull request, the action is disabled and displays a concise loading label.

If no pull request exists, Pide shows a blue **Create PR** button. Selecting it runs `gh pr create --fill` for the current branch. Pide does not open the browser automatically after creation.

If a pull request exists or creation succeeds, Pide shows a blue **Review PR** button. Selecting it opens the exact pull request URL in the system browser.

The button remains a single primary action. Pide does not add a menu, dialog, title field, body field, or provider settings.

## Architecture

### Rust functional core

The Git module gains a pull request operation that executes the GitHub CLI inside the authorized repository root.

The operation first runs:

```text
gh pr list --head <branch> --state open --json url --limit 1 --jq '.[0].url'
```

Outcomes:

- Exit code 0 with an HTTPS URL means an existing open pull request was found.
- Exit code 0 with empty output means no open pull request exists.
- Missing `gh`, unauthenticated `gh`, unsupported remote, or other command failures return a user-readable error.

Creation runs:

```text
gh pr create --fill
```

The operation extracts and validates the HTTPS pull request URL from stdout. It returns the URL to the frontend. The backend remains responsible for process execution, bounded output, timeout handling, repository authorization, and URL validation.

### Tauri command shell

A thin Tauri command exposes pull request lookup and creation. It follows the existing Git command pattern:

- Accept `repoRoot` and the current workspace environment.
- Resolve the path through the workspace authorization registry.
- Run blocking process work outside the async runtime.
- Return a serialized result with the pull request URL or `null` for lookup.

### Frontend state

The Source Control panel hook owns:

- The current pull request URL.
- Whether lookup or creation is running.
- The current pull request error.

Lookup runs when the panel is open and the current status becomes eligible. A repository root and branch identity key prevents stale lookup results from another repository or branch from being displayed.

The hook clears the stored URL when the repository, branch, cleanliness, upstream, ahead count, or behind count makes the branch ineligible.

### UI shell

The Source Control panel renders the existing primary `Button` component with its default blue primary styling.

States:

- Checking: disabled **Checking PR…** button.
- No pull request: enabled **Create PR** button.
- Creating: disabled **Creating PR…** button.
- Pull request available: enabled **Review PR** button.

The browser action uses `openUrl` from `@tauri-apps/plugin-opener`, which is already installed and permitted.

## Eligibility Rules

Pull request lookup and creation are allowed only when all conditions are true:

```text
repository exists
working tree is clean
HEAD is not detached
upstream exists
ahead == 0
behind == 0
```

These rules guarantee all local file changes are committed and the current branch is fully pushed before Pide offers pull request creation.

Pide does not attempt to create a pull request from the repository's default branch. GitHub CLI reports that case and Pide presents its error without adding separate default-branch discovery.

## Security and Reliability

- Repository paths remain gated by the existing workspace authorization registry.
- No shell command string is constructed. Executable and arguments are passed separately.
- Process output is bounded.
- Lookup and creation use a network timeout consistent with existing Git network operations.
- Returned URLs must parse as HTTPS and use a GitHub host before reaching the opener.
- Stale async results must not update a different repository or branch.
- No GitHub credentials are read, stored, logged, or returned by Pide.

## Error Handling

Errors appear through the existing Source Control feedback component.

Expected messages cover:

- GitHub CLI is not installed.
- GitHub CLI is not authenticated.
- The remote is not supported by GitHub CLI.
- Pull request creation from the current branch is invalid.
- GitHub CLI timed out or returned malformed output.
- The browser opener rejected the URL.

A failed lookup or creation does not hide Git status, modify files, or retry continuously. A later status refresh or explicit button action can retry.

## Testing

### Rust tests

Pure parsing tests cover:

- Extracting a valid GitHub HTTPS pull request URL.
- Rejecting non-HTTPS URLs.
- Rejecting non-GitHub hosts.
- Treating the no-pull-request CLI result as `None`.
- Converting missing executable, authentication, timeout, and malformed output cases into stable errors.

Operation tests use a controlled fake `gh` executable or the existing process seam so tests never require network access or a real GitHub account.

### Frontend tests

A dependency-light pure function derives the pull request action state. Tests cover:

- Hidden when the tree is dirty.
- Hidden when detached or missing an upstream.
- Hidden when ahead or behind.
- **Create PR** when eligible and no URL exists.
- Disabled loading labels during lookup and creation.
- **Review PR** when a URL exists.

The browser click passes the exact returned URL to the opener.

### Verification

Run:

```text
pnpm lint
pnpm check-types
pnpm test
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings
cd src-tauri && cargo nextest run --locked
```
