import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { ImagePreview } from "@/modules/editor/ImagePreview";
import { useTheme } from "@/modules/theme";
import { MarkdownViewToggle } from "../MarkdownViewToggle";
import { useFileText } from "../useFileText";
import { pinColorScheme } from "./svgColorScheme";

type Props = {
  path: string;
  visible: boolean;
  onSetView: (mode: "rendered" | "raw") => void;
};

// SVG renders as an image (an <img>-loaded SVG can't execute embedded scripts,
// so untrusted files are safe). Reuses ImagePreview for zoom/pan/fit. The
// rendered/raw toggle flips to the XML source editor.
export function SvgPane({ path, visible, onSetView }: Props) {
  const status = useFileText(path);
  const { resolvedMode } = useTheme();
  const filename = path.split(/[/\\]/).pop() ?? path;

  const src = useMemo(() => {
    if (status.kind !== "ready") return null;
    const svg = pinColorScheme(status.content, resolvedMode);
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }, [status, resolvedMode]);

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background",
        !visible && "pointer-events-none",
      )}
    >
      <MarkdownViewToggle mode="rendered" onChange={onSetView} />
      <div className="min-h-0 flex-1">
        {src ? (
          // surface (not checkerboard): a transparent SVG sits on the theme
          // background, dark on a dark theme (matches Orca).
          <ImagePreview
            key={src}
            src={src}
            alt={filename}
            background="surface"
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-muted-foreground">
            {status.kind === "loading" && "Loading…"}
            {status.kind === "error" && `Failed to read file: ${status.message}`}
            {status.kind === "binary" && "Binary file — cannot render as SVG."}
            {status.kind === "toolarge" &&
              `File is ${status.size} bytes; too large to preview.`}
          </div>
        )}
      </div>
    </div>
  );
}
