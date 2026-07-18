import type { RenderKind } from "@/lib/utils";
import type { ComponentProps, ComponentType } from "react";
import { lazy, Suspense } from "react";
import type { MarkdownPreviewPane as MarkdownPreviewPaneType } from "./MarkdownPreviewPane";

const MarkdownPreviewPaneLazy = lazy(() =>
  import("./MarkdownPreviewPane").then((m) => ({
    default: m.MarkdownPreviewPane,
  })),
);
const MermaidPaneLazy = lazy(() =>
  import("./renderers/MermaidPane").then((m) => ({ default: m.MermaidPane })),
);
const CsvPaneLazy = lazy(() =>
  import("./renderers/CsvPane").then((m) => ({ default: m.CsvPane })),
);
const NotebookPaneLazy = lazy(() =>
  import("./renderers/NotebookPane").then((m) => ({
    default: m.NotebookPane,
  })),
);

type PaneProps = ComponentProps<typeof MarkdownPreviewPaneType>;

// Every arm shares the same (path, visible, onSetView) contract, so P2/P3/P4
// only need to fill in their stub file — this dispatch table never changes.
const renderers: Record<RenderKind, ComponentType<PaneProps>> = {
  markdown: MarkdownPreviewPaneLazy,
  mermaid: MermaidPaneLazy,
  csv: CsvPaneLazy,
  notebook: NotebookPaneLazy,
};

type Props = PaneProps & { renderer: RenderKind };

export function RenderPane({ renderer, ...paneProps }: Props) {
  const Pane = renderers[renderer];
  return (
    <Suspense fallback={null}>
      <Pane {...paneProps} />
    </Suspense>
  );
}
