# Source Control Pull Request and History Design

## Goal

Improve the Source Control workflow in two related ways:

1. Offer a blue **Create PR** action when the current GitHub branch is clean and fully synchronized.
2. Turn the existing commit graph into a complete **History** workflow where a commit can be inspected without leaving the history tab.

## Scope

Included:

- Rename the Source Control **Commit Graph** entry to **History**.
- Keep the existing graph as the default History view.
- Replace the small commit popover with an in-tab commit inspector.
- Show a linear commit list, commit details, changed files, and an inline file diff in inspector mode.
- Preserve graph search and scroll state when returning from the inspector.
- Add a separate blue **Create PR** button for eligible GitHub branches.
- Open GitHub's pull request form in the system browser.

Excluded:

- Creating pull requests inside Pide.
- GitHub CLI, OAuth, token storage, or API calls.
- Detecting an existing pull request. GitHub handles an existing pull request for the same source and base branches.
- Pull request title or description fields inside Pide.
- GitLab or Bitbucket pull request creation.
- A second History tab or a Commit Graph versus History picker.
- Pull request merge, review, close, or status management.

## User Experience

### Create PR

A separate primary blue **Create PR** button appears in the Source Control header when all of these conditions are true:

- A repository is loaded.
- HEAD is attached to a named branch.
- The working tree and index are clean.
- The branch has an upstream.
- The branch is not ahead of its upstream.
- The branch is not behind its upstream.
- The configured remote resolves to a GitHub repository.

The action stays hidden when these conditions are not met. Existing Fetch, Pull, and Push controls remain unchanged, so they naturally guide the branch toward eligibility.

Selecting **Create PR** opens this repository URL in the system browser:

```text
https://github.com/<owner>/<repo>/compare/<encoded-branch>?expand=1
```

GitHub chooses the repository's default branch as the initial base and lets the user review the changes, base branch, title, and description before creating the pull request. If the same source and base branches already have an open pull request, GitHub directs the user to that existing pull request instead of creating a duplicate.

If the browser opener fails, Pide shows an error toast. The action performs no Git mutation.

### History entry

The Source Control row currently labeled **Commit Graph** becomes **History**. Selecting it opens or focuses the existing repository history tab. There is no intermediate picker.

### Graph mode

The History tab initially renders the existing commit graph table, search behavior, pagination, graph rail, and commit metadata.

Selecting a commit switches the same mounted tab into inspector mode. It does not open a popover or another tab.

### Inspector mode

Inspector mode follows the workflow of the supplied GitHub Desktop reference without copying its application chrome:

- A clear **Back to Commit Graph** action returns to graph mode.
- A dense linear commit list remains available on the left.
- The selected commit's subject, full message, author, timestamp, SHA, and change totals appear in the detail area.
- The selected commit's changed files appear beside the details.
- Selecting a file displays its read-only diff inline in the remaining pane.
- Selecting another commit updates the details, files, and initial file selection without returning to the graph.

The layout uses Pide's existing colors, typography, spacing, controls, and editor diff rendering. It adapts at narrow widths by reducing or stacking panes rather than introducing horizontal page scrolling.

Returning to graph mode preserves the previous graph search query and scroll position because both modes remain state owned by the same History pane.

## Architecture

### Pull request URL

Reuse the existing remote URL parser in `src/modules/git-history/lib/remoteWebUrl.ts`, exposed through the module's public barrel if needed. Add a pure helper that returns a compare URL only when:

- The parsed provider is GitHub.
- The branch name is non-empty.

The branch is encoded with `encodeURIComponent` before interpolation. Source Control loads the existing authorized `git_remote_url` value and derives the URL on the frontend. Browser opening uses the already installed `openUrl` function from `@tauri-apps/plugin-opener`.

No Rust command, process, dependency, credential, or network request is added.

### Pull request eligibility

A dependency-light pure function derives whether the action is visible from:

- Repository availability.
- Branch and detached state.
- Changed-file count.
- Upstream presence.
- Ahead and behind counts.
- Parsed GitHub compare URL availability.

The Source Control panel remains the UI shell. Remote loading must guard against stale results when the repository or branch changes.

### History state

The existing `GitHistoryPane` remains the owner of commit loading, pagination, filtering, graph layout, and graph viewport state. It gains a small view state:

```text
graph
inspect(selectedCommitSha, selectedFilePath?)
```

A focused inspector component renders the split layout. It receives the loaded commit list and selected commit identity, then uses existing native methods:

- `git_commit_files` for the changed-file list.
- `git_commit_file_diff` for inline diff content.
- Existing commit web URL helpers for optional browser links.

The inspector reuses the existing read-only Git diff renderer instead of implementing another diff engine. Shared commit-file loading behavior should be moved only when needed to avoid duplication between graph and inspector modes.

### Commit message data

The current log entry contains only the subject. Extend the existing bounded `git_log` result with the full commit body using an unambiguous record format that safely supports newlines. Parsing remains a pure Rust concern with focused tests. The body is returned as an additional `GitLogEntry` field and rendered only in inspector mode.

## State and Error Handling

- A failed remote URL lookup hides **Create PR** without affecting status controls.
- A browser opener failure produces a toast and leaves state unchanged.
- A failed initial history load keeps the existing retry state.
- A failed changed-file load shows a retry action in the inspector.
- A failed inline diff load shows the existing diff error state.
- Switching commits invalidates stale file and diff responses so an older selection cannot overwrite the current one.
- Binary and oversized files use the existing diff fallback behavior.
- Empty repositories retain the existing empty state.

## Accessibility

- **Create PR**, **History**, **Back to Commit Graph**, commit rows, and file rows remain keyboard accessible buttons.
- Focus-visible styling follows existing Pide components.
- Inspector selection is conveyed with more than color.
- Pane labels and controls use explicit accessible names.
- Reduced space does not hide the only way back to the graph.

## Testing

### Frontend

Focused tests cover:

- Compare URL generation for HTTPS and SSH GitHub remotes.
- Branch names with slashes and other encoded characters.
- Rejection of non-GitHub and malformed remotes.
- Create PR visibility for dirty, detached, missing-upstream, ahead, behind, and eligible states.
- Exact URL passed to the opener.
- Graph to inspector transition and return.
- Commit and file selection behavior.
- Stale selection results not replacing current inspector state.

### Rust

Focused tests cover the extended log parser, especially multiline commit bodies, empty bodies, delimiter-like text, and pagination behavior.

### Verification

Run:

```text
pnpm lint
pnpm check-types
pnpm test
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings
cd src-tauri && cargo nextest run --locked
```
