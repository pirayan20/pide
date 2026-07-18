import { cn } from "@/lib/utils";
import type { RenderTab, Tab } from "@/modules/tabs";
import { RenderPane } from "./RenderPane";

type Props = {
  tabs: Tab[];
  activeId: number | null;
  onSetRenderView: (id: number, mode: "rendered" | "raw") => void;
};

export function RenderStack({ tabs, activeId, onSetRenderView }: Props) {
  const renders = tabs.filter(
    (t): t is RenderTab => t.kind === "render" && !t.cold,
  );
  if (renders.length === 0) return null;
  return (
    <div className="relative h-full w-full">
      {renders.map((t) => {
        const visible = t.id === activeId;
        return (
          <div
            key={t.id}
            className={cn(
              "absolute inset-0",
              !visible && "invisible pointer-events-none",
            )}
            aria-hidden={!visible}
          >
            <RenderPane
              path={t.path}
              renderer={t.renderer}
              visible={visible}
              onSetView={(mode) => onSetRenderView(t.id, mode)}
            />
          </div>
        );
      })}
    </div>
  );
}
