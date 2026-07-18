import {
  type EditorState,
  type Extension,
  Prec,
  RangeSet,
  StateEffect,
  StateField,
  type Transaction,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  gutter,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import {
  computeGitQuickDiff,
  rematchActiveHunk,
  type GitQuickDiffHunk,
  type GitQuickDiffKind,
  type GitQuickDiffLayer,
} from "./gitQuickDiff";

export type GitQuickDiffBaselines = {
  repoRoot: string;
  headContent: string;
  indexContent: string;
};

type GitQuickDiffState = {
  baselines: GitQuickDiffBaselines | null;
  hunks: readonly GitQuickDiffHunk[];
  active: GitQuickDiffHunk | null;
};

export const setGitQuickDiffBaselines =
  StateEffect.define<GitQuickDiffBaselines | null>();
export const recomputeGitQuickDiff = StateEffect.define<null>();
export const toggleGitQuickDiffHunk = StateEffect.define<string | null>();

const emptyState: GitQuickDiffState = {
  baselines: null,
  hunks: [],
  active: null,
};

function compute(
  baselines: GitQuickDiffBaselines,
  state: EditorState,
  active: GitQuickDiffHunk | null,
): GitQuickDiffState {
  const hunks = computeGitQuickDiff(
    baselines.headContent,
    baselines.indexContent,
    state.doc,
  );
  return {
    baselines,
    hunks,
    active: active ? rematchActiveHunk(active, hunks) : null,
  };
}

function mapHunk(
  hunk: GitQuickDiffHunk,
  transaction: Transaction,
): GitQuickDiffHunk {
  const from = transaction.changes.mapPos(hunk.from, 1);
  const to = transaction.changes.mapPos(hunk.to, -1);
  return {
    ...hunk,
    from,
    to: Math.max(from, to),
    startLine: transaction.state.doc.lineAt(from).number,
    endLine: transaction.state.doc.lineAt(Math.max(from, to - 1)).number,
  };
}

const gitQuickDiffState = StateField.define<GitQuickDiffState>({
  create: () => emptyState,
  update(value, transaction) {
    let next = value;
    if (transaction.docChanged && value.baselines) {
      const hunks = value.hunks.map((hunk) => mapHunk(hunk, transaction));
      next = {
        ...value,
        hunks,
        active: value.active
          ? (hunks.find((hunk) => hunk.id === value.active?.id) ?? null)
          : null,
      };
    }

    for (const effect of transaction.effects) {
      if (effect.is(setGitQuickDiffBaselines)) {
        next = effect.value
          ? compute(effect.value, transaction.state, next.active)
          : emptyState;
      } else if (effect.is(recomputeGitQuickDiff)) {
        next = next.baselines
          ? compute(next.baselines, transaction.state, next.active)
          : next;
      } else if (effect.is(toggleGitQuickDiffHunk)) {
        next = {
          ...next,
          active:
            effect.value === null || next.active?.id === effect.value
              ? null
              : (next.hunks.find((hunk) => hunk.id === effect.value) ?? null),
        };
      }
    }
    return next;
  },
});

export function readGitQuickDiffState(state: EditorState): GitQuickDiffState {
  return state.field(gitQuickDiffState);
}

function hunkLabel(kind: GitQuickDiffKind, layer: GitQuickDiffLayer): string {
  const change = `${kind[0].toUpperCase()}${kind.slice(1)}`;
  return `${change} ${layer === "primary" ? "unstaged" : "staged"} change`;
}

function hunkClasses(
  base: string,
  hunk: Pick<GitQuickDiffHunk, "kind" | "layer">,
): string {
  return `${base} ${base}-${hunk.layer} ${base}-${hunk.kind}`;
}

class RemovedLinesWidget extends WidgetType {
  constructor(readonly hunk: GitQuickDiffHunk) {
    super();
  }

  eq(other: RemovedLinesWidget): boolean {
    return (
      other.hunk.layer === this.hunk.layer &&
      other.hunk.kind === this.hunk.kind &&
      other.hunk.removedText === this.hunk.removedText &&
      other.hunk.from === this.hunk.from &&
      other.hunk.to === this.hunk.to
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = "cm-gitInlineRemoved";
    root.role = "region";
    root.setAttribute("aria-label", "Removed lines");

    const close = document.createElement("button");
    close.type = "button";
    close.className = "cm-gitInlineClose";
    close.setAttribute("aria-label", "Close inline Git change");
    close.textContent = "×";
    close.addEventListener("click", () => {
      view.dispatch({ effects: toggleGitQuickDiffHunk.of(null) });
      view.focus();
    });
    root.appendChild(close);

    if (this.hunk.removedText) {
      for (const text of this.hunk.removedText.split("\n")) {
        const row = document.createElement("div");
        row.className = "cm-gitInlineRemovedLine";
        const sign = document.createElement("span");
        sign.className = "cm-gitInlineSign";
        sign.textContent = "-";
        const code = document.createElement("code");
        code.className = "cm-gitInlineCode";
        code.textContent = text;
        row.append(sign, code);
        root.appendChild(row);
      }
    }
    return root;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const { active } = readGitQuickDiffState(state);
  if (!active) return Decoration.none;

  const ranges = [];
  if (active.kind !== "deleted") {
    for (let line = active.startLine; line <= active.endLine; line += 1) {
      ranges.push(
        Decoration.line({ class: "cm-gitInlineAdded" }).range(
          state.doc.line(line).from,
        ),
      );
    }
  }
  const activeLine = state.doc.lineAt(active.from);
  const widgetAfterLine =
    active.kind === "deleted" && active.from !== activeLine.from;
  ranges.push(
    Decoration.widget({
      widget: new RemovedLinesWidget(active),
      block: true,
      side: widgetAfterLine ? 1 : -1,
    }).range(widgetAfterLine ? active.from : activeLine.from),
  );
  return Decoration.set(ranges, true);
}

class GitGutterMarker extends GutterMarker {
  constructor(readonly hunk: GitQuickDiffHunk) {
    super();
  }

  eq(other: GitGutterMarker): boolean {
    return other.hunk.id === this.hunk.id;
  }

  toDOM(view: EditorView): Node {
    const button = document.createElement("button");
    button.type = "button";
    button.className = hunkClasses("cm-gitGutterMarker", this.hunk);
    const label = hunkLabel(this.hunk.kind, this.hunk.layer);
    button.setAttribute("aria-label", label);
    button.title = label;
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      view.dispatch({ effects: toggleGitQuickDiffHunk.of(this.hunk.id) });
    });
    return button;
  }
}

const gitGutter = gutter({
  class: "cm-gitGutter",
  markers: (view) => {
    const ranges = readGitQuickDiffState(view.state).hunks.flatMap((hunk) => {
      const lines =
        hunk.kind === "deleted"
          ? [hunk.startLine]
          : Array.from(
              { length: hunk.endLine - hunk.startLine + 1 },
              (_, index) => hunk.startLine + index,
            );
      return lines.map((line) =>
        new GitGutterMarker(hunk).range(view.state.doc.line(line).from),
      );
    });
    return RangeSet.of(ranges, true);
  },
});

export function gitOverviewMarkerMetrics(
  top: number,
  bottom: number,
  contentHeight: number,
): { topPercent: number; heightPercent: number } {
  const height = Math.max(1, contentHeight);
  const start = Math.min(height, Math.max(0, top));
  const end = Math.min(height, Math.max(start, bottom));
  return {
    topPercent: (start / height) * 100,
    heightPercent: ((end - start) / height) * 100,
  };
}

export function gitOverviewMetrics(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): { thumbTopPercent: number; thumbHeightPercent: number } {
  if (scrollHeight <= clientHeight || scrollHeight <= 0) {
    return { thumbTopPercent: 0, thumbHeightPercent: 100 };
  }
  const thumbHeightPercent = (clientHeight / scrollHeight) * 100;
  const thumbTopPercent = Math.min(
    100 - thumbHeightPercent,
    Math.max(0, (scrollTop / scrollHeight) * 100),
  );
  return { thumbTopPercent, thumbHeightPercent };
}

export function gitOverviewScrollTop(
  ratio: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const maxScroll = Math.max(0, scrollHeight - clientHeight);
  return Math.min(
    maxScroll,
    Math.max(0, Math.min(1, ratio) * scrollHeight - clientHeight / 2),
  );
}

const quickDiffViewPlugin = ViewPlugin.fromClass(
  class {
    private timer: number | null = null;
    private scrollFrame: number | null = null;
    private readonly overview: HTMLDivElement;
    private readonly thumb: HTMLDivElement;
    private drag: { pointerId: number; offset: number } | null = null;
    private gutterRoot: HTMLElement | null = null;
    private hiddenGutters: HTMLElement[] = [];

    constructor(private readonly view: EditorView) {
      this.overview = document.createElement("div");
      this.overview.className = "cm-gitOverview";
      this.overview.setAttribute("aria-label", "Editor overview scrollbar");
      this.thumb = document.createElement("div");
      this.thumb.className = "cm-gitOverviewThumb";
      this.thumb.tabIndex = 0;
      this.thumb.role = "scrollbar";
      this.thumb.setAttribute("aria-label", "Editor viewport");
      this.thumb.setAttribute("aria-orientation", "vertical");
      this.overview.addEventListener("pointerdown", this.onTrackPointerDown);
      this.overview.addEventListener("pointermove", this.onPointerMove);
      this.overview.addEventListener("pointerup", this.onPointerUp);
      this.overview.addEventListener("pointercancel", this.onPointerUp);
      this.thumb.addEventListener("pointerdown", this.onThumbPointerDown);
      this.thumb.addEventListener("keydown", this.onThumbKeyDown);
      this.view.scrollDOM.addEventListener("scroll", this.onScroll, {
        passive: true,
      });
      this.view.dom.appendChild(this.overview);
      this.syncGutterAccessibility();
      this.renderOverview();
    }

    private readonly onScroll = () => {
      if (this.scrollFrame !== null) return;
      this.scrollFrame = window.requestAnimationFrame(() => {
        this.scrollFrame = null;
        this.updateThumb();
      });
    };

    private readonly onTrackPointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || event.target !== this.overview) return;
      const rect = this.overview.getBoundingClientRect();
      if (rect.height <= 0) return;
      event.preventDefault();
      const ratio = (event.clientY - rect.top) / rect.height;
      this.view.scrollDOM.scrollTop = gitOverviewScrollTop(
        ratio,
        this.view.scrollDOM.scrollHeight,
        this.view.scrollDOM.clientHeight,
      );
      this.updateThumb();
      this.startDrag(event, this.thumb.getBoundingClientRect().height / 2);
    };

    private startDrag(event: PointerEvent, offset: number) {
      this.drag = { pointerId: event.pointerId, offset };
      this.overview.setPointerCapture(event.pointerId);
      this.thumb.classList.add("cm-gitOverviewThumb-dragging");
    }

    private readonly onThumbPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.startDrag(
        event,
        event.clientY - this.thumb.getBoundingClientRect().top,
      );
    };

    private readonly onPointerMove = (event: PointerEvent) => {
      if (!this.drag || event.pointerId !== this.drag.pointerId) return;
      const track = this.overview.getBoundingClientRect();
      const thumb = this.thumb.getBoundingClientRect();
      const travel = Math.max(1, track.height - thumb.height);
      const top = Math.min(
        travel,
        Math.max(0, event.clientY - track.top - this.drag.offset),
      );
      const scrollRange = Math.max(
        0,
        this.view.scrollDOM.scrollHeight - this.view.scrollDOM.clientHeight,
      );
      this.view.scrollDOM.scrollTop = (top / travel) * scrollRange;
      this.updateThumb();
    };

    private readonly onPointerUp = (event: PointerEvent) => {
      if (!this.drag || event.pointerId !== this.drag.pointerId) return;
      this.drag = null;
      this.thumb.classList.remove("cm-gitOverviewThumb-dragging");
      if (this.overview.hasPointerCapture(event.pointerId)) {
        this.overview.releasePointerCapture(event.pointerId);
      }
    };

    private readonly onThumbKeyDown = (event: KeyboardEvent) => {
      const scroller = this.view.scrollDOM;
      const page = scroller.clientHeight * 0.9;
      let next: number | null = null;
      if (event.key === "ArrowUp") next = scroller.scrollTop - 40;
      if (event.key === "ArrowDown") next = scroller.scrollTop + 40;
      if (event.key === "PageUp") next = scroller.scrollTop - page;
      if (event.key === "PageDown") next = scroller.scrollTop + page;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = scroller.scrollHeight;
      if (next === null) return;
      event.preventDefault();
      scroller.scrollTop = next;
      this.updateThumb();
    };

    update(update: ViewUpdate) {
      if (update.docChanged) {
        if (this.timer !== null) window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => {
          this.timer = null;
          this.view.dispatch({ effects: recomputeGitQuickDiff.of(null) });
        }, 120);
      }
      if (
        update.docChanged ||
        update.geometryChanged ||
        readGitQuickDiffState(update.startState) !==
          readGitQuickDiffState(update.state)
      ) {
        this.syncGutterAccessibility();
        this.renderOverview();
      } else if (update.viewportChanged) {
        this.updateThumb();
      }
    }

    private syncGutterAccessibility() {
      const root =
        this.view.scrollDOM.querySelector<HTMLElement>(".cm-gutters-before");
      if (!root) return;
      this.gutterRoot = root;
      root.removeAttribute("aria-hidden");
      this.hiddenGutters = Array.from(root.children).filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement &&
          !element.classList.contains("cm-gitGutter"),
      );
      for (const gutter of this.hiddenGutters) {
        gutter.setAttribute("aria-hidden", "true");
      }
    }

    private updateThumb() {
      const scroller = this.view.scrollDOM;
      const metrics = gitOverviewMetrics(
        scroller.scrollTop,
        scroller.scrollHeight,
        scroller.clientHeight,
      );
      const trackHeight = this.overview.clientHeight;
      const thumbHeight = Math.min(
        trackHeight,
        Math.max(20, (metrics.thumbHeightPercent / 100) * trackHeight),
      );
      const scrollRange = Math.max(
        0,
        scroller.scrollHeight - scroller.clientHeight,
      );
      const scrollRatio =
        scrollRange === 0 ? 0 : scroller.scrollTop / scrollRange;
      this.thumb.style.top = `${scrollRatio * Math.max(0, trackHeight - thumbHeight)}px`;
      this.thumb.style.height = `${thumbHeight}px`;
      this.thumb.setAttribute("aria-valuemin", "0");
      this.thumb.setAttribute("aria-valuemax", "100");
      this.thumb.setAttribute(
        "aria-valuenow",
        `${Math.round(scrollRatio * 100)}`,
      );
    }

    private renderOverview() {
      const markers = readGitQuickDiffState(this.view.state).hunks.map(
        (hunk) => {
          const marker = document.createElement("div");
          marker.className = hunkClasses("cm-gitOverviewMarker", hunk);
          marker.setAttribute("aria-hidden", "true");
          const startBlock = this.view.lineBlockAt(hunk.from);
          const endBottom =
            hunk.kind === "deleted"
              ? startBlock.top
              : this.view.lineBlockAt(Math.max(hunk.from, hunk.to - 1)).bottom;
          const metrics = gitOverviewMarkerMetrics(
            startBlock.top,
            endBottom,
            this.view.contentHeight,
          );
          marker.style.top = `${metrics.topPercent}%`;
          marker.style.height = `${metrics.heightPercent}%`;
          return marker;
        },
      );
      this.overview.replaceChildren(this.thumb, ...markers);
      this.updateThumb();
    }

    destroy() {
      if (this.timer !== null) window.clearTimeout(this.timer);
      if (this.scrollFrame !== null) {
        window.cancelAnimationFrame(this.scrollFrame);
      }
      this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
      this.overview.removeEventListener("pointerdown", this.onTrackPointerDown);
      this.overview.removeEventListener("pointermove", this.onPointerMove);
      this.overview.removeEventListener("pointerup", this.onPointerUp);
      this.overview.removeEventListener("pointercancel", this.onPointerUp);
      this.thumb.removeEventListener("pointerdown", this.onThumbPointerDown);
      this.thumb.removeEventListener("keydown", this.onThumbKeyDown);
      this.gutterRoot?.setAttribute("aria-hidden", "true");
      for (const gutter of this.hiddenGutters) {
        gutter.removeAttribute("aria-hidden");
      }
      this.overview.remove();
    }
  },
);

const closeActiveHunk = Prec.highest(
  keymap.of([
    {
      key: "Escape",
      run(view) {
        if (!readGitQuickDiffState(view.state).active) return false;
        view.dispatch({ effects: toggleGitQuickDiffHunk.of(null) });
        return true;
      },
    },
  ]),
);

const gitQuickDiffTheme = EditorView.theme({
  ".cm-gitGutter": {
    width: "3px",
    transition: "width 120ms ease",
  },
  ".cm-gitGutter:hover, .cm-gitGutter:focus-within": {
    width: "7px",
  },
  ".cm-gitGutterMarker": {
    boxSizing: "border-box",
    display: "block",
    width: "100%",
    minHeight: "100%",
    padding: "0",
    border: "0",
    cursor: "pointer",
  },
  ".cm-gitGutterMarker-added, .cm-gitOverviewMarker-added": {
    color: "#3fb950",
    background: "#3fb950",
  },
  ".cm-gitGutterMarker-modified, .cm-gitOverviewMarker-modified": {
    color: "#58a6ff",
    background: "#58a6ff",
  },
  ".cm-gitGutterMarker-deleted": {
    color: "#f85149",
    background: "#f85149",
    clipPath: "polygon(0 0, 100% 50%, 0 100%)",
  },
  ".cm-gitOverviewMarker-deleted": {
    color: "#f85149",
    background: "#f85149",
  },
  ".cm-gitGutterMarker-secondary, .cm-gitOverviewMarker-secondary": {
    background: "transparent",
    border: "1px solid currentColor",
  },
  ".cm-gitOverview": {
    position: "absolute",
    top: "0",
    right: "0",
    bottom: "0",
    width: "6px",
    zIndex: "5",
    overflow: "hidden",
    pointerEvents: "auto",
    touchAction: "none",
    cursor: "pointer",
    transition: "width 120ms ease, background-color 120ms ease",
  },
  ".cm-gitOverview:hover, .cm-gitOverview:focus-within": {
    width: "12px",
    background: "color-mix(in srgb, var(--foreground) 5%, transparent)",
  },
  ".cm-gitOverviewThumb": {
    position: "absolute",
    right: "0",
    width: "100%",
    minHeight: "20px",
    zIndex: "1",
    borderRadius: "999px",
    background: "color-mix(in srgb, var(--foreground) 28%, transparent)",
    opacity: "0.7",
    cursor: "grab",
    transition: "background-color 120ms ease, opacity 120ms ease",
  },
  ".cm-gitOverview:hover .cm-gitOverviewThumb, .cm-gitOverviewThumb:focus-visible":
    {
      background: "color-mix(in srgb, var(--foreground) 42%, transparent)",
      opacity: "1",
    },
  ".cm-gitOverviewThumb-dragging": {
    cursor: "grabbing",
    opacity: "1",
  },
  ".cm-gitOverviewMarker": {
    position: "absolute",
    right: "0",
    width: "100%",
    minHeight: "3px",
    zIndex: "2",
    padding: "0",
    border: "0",
    pointerEvents: "none",
  },
  ".cm-gitOverview .cm-gitOverviewMarker-secondary": {
    border: "1px solid currentColor",
  },
  ".cm-gitInlineRemoved": {
    position: "relative",
    background: "color-mix(in srgb, #f85149 12%, transparent)",
    borderTop: "1px solid color-mix(in srgb, #f85149 35%, transparent)",
    borderBottom: "1px solid color-mix(in srgb, #f85149 35%, transparent)",
    fontFamily: "var(--font-mono)",
  },
  ".cm-gitInlineRemovedLine": {
    display: "flex",
    minWidth: "0",
  },
  ".cm-gitInlineSign": {
    flex: "0 0 2rem",
    color: "#f85149",
    textAlign: "center",
    userSelect: "none",
  },
  ".cm-gitInlineCode": {
    whiteSpace: "pre",
    color: "inherit",
    font: "inherit",
  },
  ".cm-gitInlineClose": {
    position: "absolute",
    top: "2px",
    right: "12px",
    zIndex: "1",
    border: "0",
    background: "transparent",
    color: "var(--muted-foreground)",
    cursor: "pointer",
  },
  ".cm-gitInlineAdded": {
    background: "color-mix(in srgb, #3fb950 10%, transparent)",
  },
});

export function gitQuickDiffExtension(): Extension {
  return [
    gitQuickDiffState,
    EditorView.decorations.compute([gitQuickDiffState], buildDecorations),
    Prec.highest(gitGutter),
    quickDiffViewPlugin,
    closeActiveHunk,
    gitQuickDiffTheme,
  ];
}
