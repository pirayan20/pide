import { cn } from "@/lib/utils";
import { MarkdownViewToggle } from "../MarkdownViewToggle";
import { useFileText } from "../useFileText";

// ponytail: stub for Phase 2 — previewRendererFor doesn't return "mermaid"
// yet, so this arm is unreachable. Fill in the real renderer in Phase 2.
type Props = {
  path: string;
  visible: boolean;
  onSetView: (mode: "rendered" | "raw") => void;
};

export function MermaidPane({ path, visible, onSetView }: Props) {
  const status = useFileText(path);
  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background",
        !visible && "pointer-events-none",
      )}
    >
      <MarkdownViewToggle mode="rendered" onChange={onSetView} />
      <div className="flex-1 overflow-auto">
        <div className="px-8 py-6">
          <p className="text-[12px] text-muted-foreground">
            {status.kind === "loading"
              ? "Loading…"
              : "Mermaid preview coming soon."}
          </p>
        </div>
      </div>
    </div>
  );
}
