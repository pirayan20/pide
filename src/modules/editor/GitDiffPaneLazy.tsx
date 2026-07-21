import { lazy, Suspense, type ComponentProps } from "react";
import type { GitDiffPane as GitDiffPaneType } from "./GitDiffPane";

const GitDiffPaneInner = lazy(() =>
  import("./GitDiffPane").then((module) => ({
    default: module.GitDiffPane,
  })),
);

type Props = ComponentProps<typeof GitDiffPaneType>;

export function GitDiffPane(props: Props) {
  return (
    <Suspense fallback={null}>
      <GitDiffPaneInner {...props} />
    </Suspense>
  );
}
