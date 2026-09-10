# Terminal energy investigation

Date: 2026-09-08. Scope: the current working copy, including the existing UI and agent-status work.

Pide can reduce unnecessary work while retaining terminal features, animation and responsiveness. This investigation found and fixed three specific costs. It has not established how much of the reported MacBook battery drain these costs explain.

## Measured findings and changes

| Path | Before | After | What this establishes |
| --- | --- | --- | --- |
| Idle PTY output flusher | A 50 ms timed wait per session; four empty wakeups in a 220 ms reproduction | Waits for output or closure; zero empty wakeups in the same test | Removes scheduled idle polling from this thread. OS scheduling and App Nap can affect the observed process wakeup rate. |
| Startup device-query filter | Continued parsing ANSI sequences after it could no longer answer startup queries | Copies subsequent bytes directly, including any partial startup sequence | Reduces CPU work in this filter while preserving the byte stream and startup replies. |
| Terminal titles | 100 title changes invalidated 4,000 selected values across 20 labels and 20 icons | The same replay invalidates only the changed label, 100 times | Removes unrelated label and icon updates. This is a subscription test, not a measured count of browser paints or React commits. |

The initial optimized filter benchmark processed 66,560,000 bytes per replay, taking the median of seven runs: 54.430 ms before and 3.244 ms after, using `rustc -O`. Those figures apply only to the query-filter stage. Most of an ordinary terminal's cost may lie elsewhere. This benchmark does not include xterm parsing, IPC, WebKit rendering, the compositor, or the CLI producing the output.

A second comparison after the build had finished used the release profile's `opt-level=s` and fat LTO: 96.315 ms before and 1.755 ms after for the same replay. This is a filter microbenchmark, not whole-app CPU usage.

The title change keeps the original raw title store and all title-driven agent transitions intact. Labels subscribe to the chosen split pane's title; icons do not subscribe to title animation. Custom labels, private terminals and editor tabs do not consume terminal titles. Agent selection still uses the existing priority rules.

The output queue keeps the existing 4 ms coalescing delay and 4 MiB pending-output overflow policy. The output and closed predicates now share a mutex, so closure cannot race a waiter into sleeping indefinitely. Only an empty-to-nonempty transition signals the flusher. A single sender drains output before the waiter sends the exit event; the prior implementation had two concurrent output senders during shutdown.

## Feature and responsiveness constraints

- Terminal refresh rate, WebGL rendering, keyboard input and resize scheduling retain their existing settings.
- Hidden running terminals retain their live parser/grid and continue processing output, terminal queries, agent status and notifications.
- No ANSI repaint is discarded or interpreted as a replaceable text snapshot by these changes.
- Scrollback, search, selection, clipboard sequences, split panes and tab labels retain their existing behavior.
- The existing emergency overflow policy still drops accumulated output with a reset notice at 4 MiB. This investigation did not introduce that policy or replace it with lossless flow control.

The filter regressions cover every chunk width of a representative ANSI/OSC stream, startup cursor/device queries and a partial sequence spanning the switch to passthrough. Queue regressions cover idle wakeups, sparse UTF-8/ANSI data, final output during an in-flight send, closure before startup, delivery failure and the existing overflow behavior.

## Reproducing the focused checks

Run from the repository root:

```sh
pnpm test src/modules/tabs/lib/useTabAgentContext.test.ts
rustc --test --edition 2021 src-tauri/src/modules/pty/da_filter.rs -o /tmp/pide-filter-tests
/tmp/pide-filter-tests
rustc --test --edition 2021 src-tauri/src/modules/pty/output.rs -o /tmp/pide-output-tests
/tmp/pide-output-tests
rustc -O scripts/bench-pty-filter.rs -o /tmp/pide-filter-bench
/tmp/pide-filter-bench
```

For a benchmark using the release profile's optimization choices, replace `-O` with `-C opt-level=s -C lto=fat`. Compare identical compiler settings, input and machine conditions. Avoid running a build during the timing comparison. The benchmark is manual because machine-dependent timing thresholds make poor CI assertions.

The title test uses the actual hook selectors, agent picker and stores with a simulated React subscription boundary. It checks `Object.is` changes to the selected snapshot, the mechanism that decides whether a Zustand title update requires a component update. It does not run a DOM renderer.

## Native observations and remaining investigation

The initial installed-app sample was inactive: Pide, its WebContent process and GPU process reported 0.0% CPU over the short sample. Its native stack showed the PTY threads waiting. That sample did not reproduce sustained drain. A temporary new terminal in the installed version remained blank, so it was closed and could not supply a reliable active-workload comparison against this working copy.

A separate native test app was then built successfully with its own bundle identifier and settings, using the optimized production frontend and a debug Rust backend. It displayed the final `PIDE PROFILE COMPLETE 2400 frames` line after a 20-second, 120-update/second replay and returned to the shell prompt. Agent title/status changes and terminal tab switching worked. After hiding the second 60-second workload, switching back displayed `PIDE PROFILE COMPLETE 7200 frames` and the shell prompt, confirming final output was retained while hidden. The isolated app was then quit.

Short process samples from this **patched debug build**, excluding the initial zero-CPU sample and recording the final two intervals, were:

| Synthetic workload at 120 updates/second | Native Pide CPU | WebContent CPU | WebKit GPU-process CPU |
| --- | --- | --- | --- |
| Visible grid, animated agent title | 9.7% | 29.1-30.5% | 26.1-26.2% |
| Hidden grid, animated agent title still visible in tab bar | 9.8-9.9% | 32.0-32.5% | 19.9-20.1% |
| Visible grid, no agent title | 15.6-16.2% | 19.7% | 17.4-17.5% |
| Hidden grid, no agent title | 7.0-7.7% | 4.7-5.7% | 0.0% |

These are short diagnostic samples, not matched before/after release measurements. A GPU-process CPU percentage is **not** GPU hardware utilization or power. Sampling itself and other machine activity affect the numbers. The important observation is that the hidden grid can become GPU-idle, while title/status animation keeps substantial UI work active. The animated-title workload also activates the agent badges, so it does not isolate the title text from those animations. The lower native CPU in that workload must not be interpreted as a benefit of adding title updates.

The streaming WebContent stack included WebGL display preparation and page layout. The hidden-grid/no-title sample showed much less rendering work. This gives a concrete next profiling target: animated tab labels and status badges, their layout invalidations and compositor damage, in addition to the terminal itself.

Run `python3 scripts/terminal-output-workload.py --seconds 60 --hz 120 --rows 8 --title` inside a disposable terminal, then switch to another tab during the run. Repeat without `--title`. This intentionally repaints the screen using ANSI cursor positioning; do not run it inside an existing interactive CLI session.

`sample` and `top` are available here. Instruments' `xctrace` is unavailable in the selected developer tools. Total battery-life improvement and visible-terminal frame timing remain unmeasured.

For the next native comparison, use matched release builds, fixed window size and display refresh, identical theme, identical tab count and the same recorded workload. Compare a quiet prompt, visible TUI output, hidden TUI output, rapid tab switching and multiple active agents. Record:

1. Pide's native process, WebContent, WebKit GPU, WindowServer and CLI child CPU separately. A local model, compiler or development server can dominate the child-process cost.
2. Timer wakeups, CPU time and GPU activity, plus process memory. Include idle recovery after output stops.
3. Input-to-echo and frame-time distributions, output-byte counts and final terminal state. Reject a change that saves CPU by delaying input, losing output, corrupting a TUI or making switching visibly stutter.
4. Matched energy measurements over repeated runs. Whole-machine power includes display brightness, charging and unrelated apps, so it cannot be attributed to Pide from a single run.

Further candidates require those measurements:

- **IPC and parser backpressure.** Use xterm write-completion acknowledgements to bound bytes in flight, and investigate batching bursts before the native/webview boundary. Do not increase delays globally or suspend all background parsing: terminal protocols and agent notifications depend on continued processing.
- **WebKit/compositor work.** The current renderer pool already uses `display:none` for parked terminals, and the installed xterm source pauses rendering through an IntersectionObserver. Confirm actual offscreen GPU behavior and window occlusion before changing renderer lifetime or frame scheduling.
- **Remaining parser work.** The agent detector still examines OSC sequences, which is necessary for hooks and lifecycle. Profile it after removing the startup filter cost before introducing more parsing complexity.

Apple recommends minimizing unnecessary timers and content updates in its [energy-efficiency guidance](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/BestPractices.html). [xterm's flow-control guide](https://xtermjs.org/docs/guides/flowcontrol/) describes why transport delivery and parser consumption are different and how write callbacks can support backpressure. These sources support the investigation strategy; they do not quantify Pide's savings.

## Validation

- `pnpm check-types`: passed.
- `pnpm test`: 71 files, 446 tests passed.
- `pnpm lint`: successful with existing warnings in unrelated code; the new hook and its test lint cleanly.
- `cargo clippy --all-targets --locked -- -D warnings`: passed.
- `cargo test --locked`: 285 tests passed, including the terminal lifecycle and output tests.
- Isolated Tauri app bundle: built and exercised in native WebKit. This is a functional smoke test, not a release power comparison.
