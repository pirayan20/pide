# Pull Request Review Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Pide find or create a GitHub pull request from a clean, fully pushed branch and expose one blue button that opens it in the system browser.

**Architecture:** Extend the authorized Rust Git subsystem with a bounded `gh` process path and thin Tauri commands. Keep frontend behavior in a pure action-state helper, while `useSourceControlPanel` owns asynchronous lookup and creation state and `SourceControlPanel` remains the UI shell.

**Tech Stack:** Rust 2021, Tauri 2, React 19, TypeScript 6, Vitest, pnpm, GitHub CLI

## Global Constraints

- Support GitHub repositories through the authenticated `gh` CLI only.
- Do not add dependencies.
- Only offer pull request actions for a clean, attached branch with an upstream and `ahead == 0` and `behind == 0`.
- Create pull requests with `gh pr create --fill`.
- Do not open the browser automatically after creation.
- Render one default primary blue button for the pull request action.
- Open URLs with the existing `@tauri-apps/plugin-opener` package.
- Keep OS access in Rust and keep React components thin.
- Never construct shell command strings.
- Use `@/` imports in frontend code.
- Do not add comments unless they explain a non-obvious reason.
- Do not use em dashes or emojis.

---

## File Structure

- `src-tauri/src/modules/git/process.rs`: generalize the existing bounded command runner enough to execute `git` and `gh`, including WSL.
- `src-tauri/src/modules/git/github.rs`: own GitHub CLI argument construction, output parsing, stable errors, lookup, and creation.
- `src-tauri/src/modules/git/types.rs`: add the serialized pull request result.
- `src-tauri/src/modules/git/commands.rs`: expose thin lookup and creation commands.
- `src-tauri/src/modules/git/mod.rs`: export the GitHub submodule.
- `src-tauri/src/lib.rs`: register the two new commands.
- `src/lib/native.ts`: add the pull request result type and IPC wrappers.
- `src/modules/source-control/pullRequestAction.ts`: derive eligibility, labels, disabled state, and URL without React or Tauri dependencies.
- `src/modules/source-control/pullRequestAction.test.ts`: lock the action-state rules.
- `src/modules/source-control/useSourceControlPanel.ts`: own lookup, creation, stale-result protection, and errors.
- `src/modules/source-control/SourceControlPanel.tsx`: render the single blue action and open the returned URL.
- `PIDE.md`: add the new Git commands to the living architecture command list.

---

### Task 1: Add a bounded GitHub CLI backend

**Files:**
- Modify: `src-tauri/src/modules/git/process.rs`
- Create: `src-tauri/src/modules/git/github.rs`
- Modify: `src-tauri/src/modules/git/mod.rs`

**Interfaces:**
- Produces: `process::run_gh(workspace: &WorkspaceEnv, cwd: &str, args: I, timeout_secs: u64) -> Result<GitOutput>`
- Produces: `github::find_pull_request(registry, repo_root, branch, workspace) -> Result<Option<String>>`
- Produces: `github::create_pull_request(registry, repo_root, workspace) -> Result<String>`

- [ ] **Step 1: Write failing process command-builder tests**

Add tests in `process.rs` that require the command builder to support both programs and preserve WSL behavior:

```rust
#[test]
fn builds_local_gh_command() {
    let cmd = build_command(
        "gh",
        &WorkspaceEnv::Local,
        Some("/repo"),
        &[OsString::from("pr"), OsString::from("list")],
    )
    .expect("command");
    assert_eq!(cmd.get_program(), "gh");
    assert_eq!(cmd.get_args().collect::<Vec<_>>(), ["pr", "list"]);
    assert_eq!(cmd.get_current_dir(), Some(std::path::Path::new("/repo")));
}

#[cfg(windows)]
#[test]
fn builds_wsl_gh_command_with_cd_and_exec() {
    let cmd = build_command(
        "gh",
        &WorkspaceEnv::Wsl {
            distro: "Ubuntu".into(),
        },
        Some("/home/user/repo"),
        &[OsString::from("pr"), OsString::from("list")],
    )
    .expect("command");
    let args = cmd
        .get_args()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    assert_eq!(
        args,
        ["-d", "Ubuntu", "--cd", "/home/user/repo", "--exec", "gh", "pr", "list"]
    );
}
```

- [ ] **Step 2: Run the focused Rust test and verify RED**

Run:

```bash
cd src-tauri && cargo test --locked modules::git::process::tests::builds_local_gh_command
```

Expected: compilation fails because `build_command` does not exist.

- [ ] **Step 3: Extract the generic bounded runner and add `run_gh`**

Refactor `run_git_uncached` to call a private generic function while preserving existing environment hardening and output limits:

```rust
pub fn run_gh<I, S>(
    workspace: &WorkspaceEnv,
    cwd: &str,
    args: I,
    timeout_secs: u64,
) -> Result<GitOutput>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    run_program("gh", workspace, Some(cwd), args, timeout_secs)
}

fn run_git_uncached<I, S>(
    workspace: &WorkspaceEnv,
    cwd: Option<&str>,
    args: I,
    timeout_secs: u64,
) -> Result<GitOutput>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    run_program("git", workspace, cwd, args, timeout_secs)
}
```

Rename `build_git_command` to `build_command`, add a `program: &str` parameter, and use that parameter for both local `Command::new(program)` and WSL `--exec program`. Keep the existing timeout, prompt disabling, locale, process hiding, stdout cap, stderr cap, and child kill behavior unchanged.

- [ ] **Step 4: Run process tests and verify GREEN**

Run:

```bash
cd src-tauri && cargo test --locked modules::git::process::tests
```

Expected: all process tests pass.

- [ ] **Step 5: Write failing GitHub output parsing tests**

Create `github.rs` with tests written before implementation:

```rust
#[cfg(test)]
mod tests {
    use super::{parse_optional_pull_request_url, parse_pull_request_url};

    #[test]
    fn parses_existing_pull_request_url() {
        assert_eq!(
            parse_optional_pull_request_url(b"https://github.com/acme/app/pull/42\n").unwrap(),
            Some("https://github.com/acme/app/pull/42".into())
        );
    }

    #[test]
    fn empty_lookup_output_means_no_pull_request() {
        assert_eq!(parse_optional_pull_request_url(b"\n").unwrap(), None);
    }

    #[test]
    fn rejects_non_https_pull_request_url() {
        let error = parse_pull_request_url(b"http://github.com/acme/app/pull/42\n")
            .expect_err("http must be rejected");
        assert!(error.to_string().contains("invalid pull request URL"));
    }

    #[test]
    fn rejects_non_github_pull_request_url() {
        let error = parse_pull_request_url(b"https://example.com/acme/app/pull/42\n")
            .expect_err("unknown host must be rejected");
        assert!(error.to_string().contains("invalid pull request URL"));
    }

    #[test]
    fn extracts_url_from_create_output() {
        assert_eq!(
            parse_pull_request_url(b"Creating pull request for feature into main in acme/app\n\nhttps://github.com/acme/app/pull/42\n").unwrap(),
            "https://github.com/acme/app/pull/42"
        );
    }
}
```

- [ ] **Step 6: Run GitHub parsing tests and verify RED**

Run:

```bash
cd src-tauri && cargo test --locked modules::git::github::tests
```

Expected: compilation fails because the parsing functions do not exist.

- [ ] **Step 7: Implement URL parsing and GitHub CLI operations**

Implement dependency-free validation by accepting only trimmed lines that start with `https://github.com/` and contain `/pull/`:

```rust
fn valid_pull_request_url(line: &str) -> bool {
    line.starts_with("https://github.com/") && line.contains("/pull/")
}

fn parse_optional_pull_request_url(stdout: &[u8]) -> Result<Option<String>> {
    let text = String::from_utf8_lossy(stdout);
    let value = text.lines().map(str::trim).find(|line| !line.is_empty());
    match value {
        None => Ok(None),
        Some(line) if valid_pull_request_url(line) => Ok(Some(line.into())),
        Some(_) => Err(GitError::command(
            "GitHub CLI returned an invalid pull request URL",
            "expected an https://github.com/.../pull/... URL",
        )),
    }
}

fn parse_pull_request_url(stdout: &[u8]) -> Result<String> {
    let text = String::from_utf8_lossy(stdout);
    text.lines()
        .map(str::trim)
        .find(|line| valid_pull_request_url(line))
        .map(str::to_string)
        .ok_or_else(|| {
            GitError::command(
                "GitHub CLI returned an invalid pull request URL",
                "expected an https://github.com/.../pull/... URL",
            )
        })
}
```

Implement lookup with separate arguments:

```rust
pub fn find_pull_request(
    registry: &WorkspaceRegistry,
    repo_root: &str,
    branch: &str,
    workspace: &WorkspaceEnv,
) -> Result<Option<String>> {
    let repo_root = authorized_repo_root(registry, repo_root, workspace)?;
    let output = run_gh(
        &repo_root.workspace,
        &repo_root.git_path,
        [
            "pr", "list", "--head", branch, "--state", "open", "--json", "url",
            "--limit", "1", "--jq", ".[0].url",
        ],
        NETWORK_TIMEOUT_SECS,
    )?;
    ensure_gh_success(&output, "failed to find pull request")?;
    parse_optional_pull_request_url(&output.stdout)
}
```

Implement creation with `run_gh(..., ["pr", "create", "--fill"], NETWORK_TIMEOUT_SECS)`, then parse the URL. Add `ensure_gh_success` that returns stable messages for a missing executable, timeout, unauthenticated CLI output containing `gh auth login` or `not logged into`, and otherwise uses bounded stderr or stdout as command detail.

- [ ] **Step 8: Run GitHub module tests and verify GREEN**

Run:

```bash
cd src-tauri && cargo test --locked modules::git::github::tests modules::git::process::tests
```

Expected: all focused tests pass.

- [ ] **Step 9: Export the module and commit**

Add `pub mod github;` to `src-tauri/src/modules/git/mod.rs`.

Run:

```bash
git add src-tauri/src/modules/git/process.rs src-tauri/src/modules/git/github.rs src-tauri/src/modules/git/mod.rs
git commit -m "feat(git): add bounded GitHub pull request operations"
```

---

### Task 2: Expose pull request lookup and creation through Tauri

**Files:**
- Modify: `src-tauri/src/modules/git/types.rs`
- Modify: `src-tauri/src/modules/git/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/native.ts`
- Modify: `PIDE.md`

**Interfaces:**
- Consumes: `github::find_pull_request(...) -> Result<Option<String>>`
- Consumes: `github::create_pull_request(...) -> Result<String>`
- Produces: frontend `GitPullRequestResult = { url: string | null }`
- Produces: `native.gitFindPullRequest(repoRoot, branch)` and `native.gitCreatePullRequest(repoRoot)`

- [ ] **Step 1: Add the serialized result type**

Add to `types.rs`:

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPullRequestResult {
    pub url: Option<String>,
}
```

- [ ] **Step 2: Add thin Tauri commands**

Import `github` and `GitPullRequestResult` in `commands.rs`, then add:

```rust
#[tauri::command]
pub async fn git_find_pull_request(
    repo_root: String,
    branch: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<GitPullRequestResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |registry| {
        github::find_pull_request(registry, &repo_root, &branch, &workspace)
            .map(|url| GitPullRequestResult { url })
            .map_err(Into::into)
    })
    .await
}

#[tauri::command]
pub async fn git_create_pull_request(
    repo_root: String,
    workspace: Option<WorkspaceEnv>,
    app: AppHandle,
) -> Result<GitPullRequestResult, String> {
    let workspace = WorkspaceEnv::from_option(workspace);
    blocking(app, move |registry| {
        github::create_pull_request(registry, &repo_root, &workspace)
            .map(|url| GitPullRequestResult { url: Some(url) })
            .map_err(Into::into)
    })
    .await
}
```

- [ ] **Step 3: Register both commands**

Add `git::commands::git_find_pull_request` and `git::commands::git_create_pull_request` beside `git_push` in `src-tauri/src/lib.rs`.

- [ ] **Step 4: Add frontend IPC wrappers**

Add to `src/lib/native.ts`:

```ts
export type GitPullRequestResult = {
  url: string | null;
};
```

Add to `native`:

```ts
gitFindPullRequest: (repoRoot: string, branch: string) =>
  invoke<GitPullRequestResult>("git_find_pull_request", {
    repoRoot,
    branch,
    workspace: workspace(),
  }),
gitCreatePullRequest: (repoRoot: string) =>
  invoke<GitPullRequestResult>("git_create_pull_request", {
    repoRoot,
    workspace: workspace(),
  }),
```

These are reads/network operations, so do not emit `notifyGitChanged`.

- [ ] **Step 5: Update the living architecture list**

Add `git_find_pull_request` and `git_create_pull_request` to the `git::commands::*` list in `PIDE.md`.

- [ ] **Step 6: Verify the bridge compiles**

Run:

```bash
pnpm check-types
cd src-tauri && cargo check --locked
```

Expected: both commands and frontend wrappers compile.

- [ ] **Step 7: Commit**

```bash
git add PIDE.md src/lib/native.ts src-tauri/src/lib.rs src-tauri/src/modules/git/commands.rs src-tauri/src/modules/git/types.rs
git commit -m "feat(git): expose pull request commands"
```

---

### Task 3: Derive the single pull request action with tests

**Files:**
- Create: `src/modules/source-control/pullRequestAction.ts`
- Create: `src/modules/source-control/pullRequestAction.test.ts`

**Interfaces:**
- Produces: `getPullRequestAction(input: PullRequestActionInput): PullRequestAction`
- `PullRequestAction` is either `{ visible: false }` or `{ visible: true; label: string; disabled: boolean; kind: "create" | "review" | "waiting"; url: string | null }`

- [ ] **Step 1: Write failing action-state tests**

Create `pullRequestAction.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getPullRequestAction } from "@/modules/source-control/pullRequestAction";

const eligible = {
  hasRepo: true,
  clean: true,
  detached: false,
  upstream: "origin/feature",
  ahead: 0,
  behind: 0,
  busy: null,
  url: null,
} as const;

describe("getPullRequestAction", () => {
  it.each([
    { hasRepo: false },
    { clean: false },
    { detached: true },
    { upstream: null },
    { ahead: 1 },
    { behind: 1 },
  ])("hides an ineligible branch for %o", (change) => {
    expect(getPullRequestAction({ ...eligible, ...change })).toEqual({ visible: false });
  });

  it("offers creation when no pull request exists", () => {
    expect(getPullRequestAction(eligible)).toEqual({
      visible: true,
      kind: "create",
      label: "Create PR",
      disabled: false,
      url: null,
    });
  });

  it("shows lookup progress", () => {
    expect(getPullRequestAction({ ...eligible, busy: "lookup" })).toMatchObject({
      kind: "waiting",
      label: "Checking PR…",
      disabled: true,
    });
  });

  it("shows creation progress", () => {
    expect(getPullRequestAction({ ...eligible, busy: "create" })).toMatchObject({
      kind: "waiting",
      label: "Creating PR…",
      disabled: true,
    });
  });

  it("returns the exact review URL", () => {
    const url = "https://github.com/acme/app/pull/42";
    expect(getPullRequestAction({ ...eligible, url })).toEqual({
      visible: true,
      kind: "review",
      label: "Review PR",
      disabled: false,
      url,
    });
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm test src/modules/source-control/pullRequestAction.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimal pure helper**

Create `pullRequestAction.ts` with the exact union types and eligibility branch required by the tests. Check eligibility first, then `busy`, then `url`, then return the create state. Do not import React, Tauri, or `native`.

- [ ] **Step 4: Run the test and verify GREEN**

Run:

```bash
pnpm test src/modules/source-control/pullRequestAction.test.ts
```

Expected: all action-state tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/source-control/pullRequestAction.ts src/modules/source-control/pullRequestAction.test.ts
git commit -m "test(source-control): define pull request action states"
```

---

### Task 4: Wire lookup, creation, and the blue review button

**Files:**
- Modify: `src/modules/source-control/useSourceControlPanel.ts`
- Modify: `src/modules/source-control/SourceControlPanel.tsx`

**Interfaces:**
- Consumes: `native.gitFindPullRequest(repoRoot, branch)`
- Consumes: `native.gitCreatePullRequest(repoRoot)`
- Consumes: `getPullRequestAction(...)`
- Produces from hook: `pullRequestUrl`, `pullRequestBusy`, `pullRequestError`, `createPullRequest()`

- [ ] **Step 1: Extend the panel hook state contract**

Add:

```ts
type PullRequestBusy = "lookup" | "create" | null;
```

Extend `SourceControlPanelState` with:

```ts
pullRequestUrl: string | null;
pullRequestBusy: PullRequestBusy;
pullRequestError: string | null;
createPullRequest: () => Promise<void>;
```

Add local state and a monotonically increasing request id:

```ts
const [pullRequestUrl, setPullRequestUrl] = useState<string | null>(null);
const [pullRequestBusy, setPullRequestBusy] = useState<PullRequestBusy>(null);
const [pullRequestError, setPullRequestError] = useState<string | null>(null);
const pullRequestRequestIdRef = useRef(0);
```

- [ ] **Step 2: Add eligible-branch lookup with stale-result protection**

Derive eligibility from `open`, `repo`, `status`, and `allClean`. In an effect:

- Increment `pullRequestRequestIdRef` whenever dependencies change.
- Clear URL and error immediately when ineligible.
- Set busy to `lookup` when eligible.
- Call `native.gitFindPullRequest(repo.repoRoot, status.branch)`.
- Only apply the URL, error, or idle state if the captured request id is still current.
- Cancel by invalidating the request id in the cleanup function.

Use dependencies that identify behavior, not whole objects:

```ts
[
  open,
  repo?.repoRoot,
  status?.branch,
  status?.isDetached,
  status?.upstream,
  status?.ahead,
  status?.behind,
  allClean,
]
```

Do not retry from the effect after an error until one of these dependencies changes or the panel is reopened.

- [ ] **Step 3: Add creation**

Implement `createPullRequest` so it:

- Returns when repository/status is absent, ineligible, or another pull request action is busy.
- Invalidates any previous request.
- Clears the pull request error.
- Sets busy to `create`.
- Calls `native.gitCreatePullRequest(repo.repoRoot)`.
- Requires a non-null result URL.
- Stores the URL and sets the existing action message to `Pull request created`.
- Normalizes errors into `pullRequestError`.
- Only clears busy if its request id is still current.

Return all four pull request fields from the hook.

- [ ] **Step 4: Render the action in the Source Control panel**

Import:

```ts
import { openUrl } from "@tauri-apps/plugin-opener";
import { getPullRequestAction } from "@/modules/source-control/pullRequestAction";
```

Derive the action near `canCommit`:

```ts
const pullRequestAction = getPullRequestAction({
  hasRepo: !!scm.repo,
  clean: scm.allClean,
  detached: scm.status?.isDetached ?? true,
  upstream: scm.status?.upstream ?? null,
  ahead: scm.status?.ahead ?? 0,
  behind: scm.status?.behind ?? 0,
  busy: scm.pullRequestBusy,
  url: scm.pullRequestUrl,
});
```

Include `scm.pullRequestError` ahead of success messages in `footerFeedback`.

Render one default `Button` directly below the Commit button and only when `pullRequestAction.visible`:

```tsx
<Button
  size="xs"
  className="h-7 w-full cursor-pointer text-[11.5px] font-semibold tracking-tight shadow-sm disabled:cursor-not-allowed disabled:shadow-none"
  disabled={pullRequestAction.disabled}
  onClick={() => {
    if (pullRequestAction.kind === "review" && pullRequestAction.url) {
      void openUrl(pullRequestAction.url).catch((error) =>
        toast.error(normalizeError(error)),
      );
      return;
    }
    if (pullRequestAction.kind === "create") {
      void scm.createPullRequest();
    }
  }}
>
  {pullRequestAction.label}
</Button>
```

Use the existing default button variant so the button is blue. Do not add a dialog or automatically call `openUrl` after creation.

- [ ] **Step 5: Run focused frontend tests and type checks**

Run:

```bash
pnpm test src/modules/source-control/pullRequestAction.test.ts
pnpm check-types
pnpm lint
```

Expected: tests pass and there are no type or lint errors.

- [ ] **Step 6: Run focused Rust checks**

Run:

```bash
cd src-tauri && cargo test --locked modules::git::github::tests modules::git::process::tests
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings
```

Expected: focused tests pass and clippy emits no warnings.

- [ ] **Step 7: Commit**

```bash
git add src/modules/source-control/SourceControlPanel.tsx src/modules/source-control/useSourceControlPanel.ts
git commit -m "feat(source-control): add pull request review button"
```

---

### Task 5: Full verification and final review

**Files:**
- Review all modified files.

**Interfaces:**
- Verifies the complete backend-to-browser flow.

- [ ] **Step 1: Run all frontend checks**

```bash
pnpm lint
pnpm check-types
pnpm test
```

Expected: all commands exit 0.

- [ ] **Step 2: Run all Rust checks**

```bash
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings
cd src-tauri && cargo nextest run --locked
```

If `cargo nextest` is unavailable, run `cargo test --locked` and record the fallback.

Expected: all commands exit 0.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git diff HEAD~4 --check
git diff HEAD~4 --stat
git status --short --branch
```

Confirm:

- No dependency was added.
- No shell command string was constructed.
- The action is unavailable while files are dirty or commits are not synchronized.
- Pull request creation does not open the browser.
- **Review PR** opens the stored exact URL.
- Only one pull request action button is visible.
- The working tree is clean.

- [ ] **Step 4: Request code review**

Use the `requesting-code-review` skill and address correctness, security, platform, and UX findings before completion.
