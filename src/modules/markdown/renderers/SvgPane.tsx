import { cn } from "@/lib/utils";
import { ImagePreview } from "@/modules/editor/ImagePreview";
import { convertFileSrc } from "@tauri-apps/api/core";
import { MarkdownViewToggle } from "../MarkdownViewToggle";

type Props = {
  path: string;
  visible: boolean;
  onSetView: (mode: "rendered" | "raw") => void;
};

// SVG renders as an image via the asset URL (an <img>-loaded SVG cannot execute
// embedded scripts, so this is safe for untrusted files). Reuses ImagePreview
// for zoom/pan/fit. The rendered/raw toggle flips to the XML source editor.
export function SvgPane({ path, visible, onSetView }: Props) {
  const filename = path.split(/[/\\]/).pop() ?? path;
  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background",
        !visible && "pointer-events-none",
      )}
    >
      <MarkdownViewToggle mode="rendered" onChange={onSetView} />
      <div className="min-h-0 flex-1">
        <ImagePreview src={convertFileSrc(path)} alt={filename} />
      </div>
    </div>
  );
}
