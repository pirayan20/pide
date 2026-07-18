import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { RenderStack as RenderStackType } from "./RenderStack";

const RenderStackInner = lazy(() =>
  import("./RenderStack").then((m) => ({ default: m.RenderStack })),
);

type Props = ComponentProps<typeof RenderStackType>;

export function RenderStack(props: Props) {
  return (
    <Suspense fallback={null}>
      <RenderStackInner {...props} />
    </Suspense>
  );
}
