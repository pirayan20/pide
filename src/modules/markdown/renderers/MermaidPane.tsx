import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useZoomPan, ZoomControls } from "@/modules/editor/useZoomPan";
import { useTheme } from "@/modules/theme";
import mermaid from "mermaid";
import { useEffect, useId, useState } from "react";
import { MarkdownViewToggle } from "../MarkdownViewToggle";
import { useFileText } from "../useFileText";

type Props = {
  path: string;
  visible: boolean;
  onSetView: (mode: "rendered" | "raw") => void;
};

type MermaidTheme = "default" | "dark";

/** Maps the app's resolved light/dark mode to mermaid's built-in theme names. */
export function mermaidThemeFor(mode: "light" | "dark"): MermaidTheme {
  return mode === "dark" ? "dark" : "default";
}

// mermaid.initialize() writes global config; guard it so repeated renders
// (or multiple mermaid panes) don't redo it, but re-run when the app's
// resolved theme actually flips.
let initializedTheme: MermaidTheme | null = null;

function ensureMermaidInitialized(theme: MermaidTheme): void {
  if (initializedTheme === theme) return;
  // suppressErrorRendering: on a parse error mermaid otherwise leaves its
  // "syntax error" bomb diagram appended to document.body (it throws before
  // cleanup). We render our own error UI, so suppress that stray DOM.
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme,
  });
  initializedTheme = theme;
}

export function MermaidPane({ path, visible, onSetView }: Props) {
  const status = useFileText(path);
  const { resolvedMode } = useTheme();
  const theme = mermaidThemeFor(resolvedMode);
  const rawId = useId();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    containerRef,
    scale,
    dragging,
    isFit,
    reset,
    zoomBy,
    surfaceProps,
    transformStyle,
  } = useZoomPan();

  useEffect(() => {
    if (status.kind !== "ready") return;
    ensureMermaidInitialized(theme);
    let cancelled = false;
    setSvg(null);
    setError(null);
    const id = `mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
    mermaid
      .render(id, status.content)
      .then(({ svg: rendered }) => {
        if (!cancelled) setSvg(rendered);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [status, theme, rawId]);

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background",
        !visible && "pointer-events-none",
      )}
    >
      <MarkdownViewToggle mode="rendered" onChange={onSetView} />
      <div className="relative min-h-0 flex-1">
        {(status.kind !== "ready" || error) && (
          <div className="h-full overflow-auto">
            <div className="px-8 py-6">
              {status.kind === "loading" && (
                <p className="text-[12px] text-muted-foreground">Loading…</p>
              )}
              {status.kind === "error" && (
                <p className="text-[12px] text-destructive">
                  Failed to read file: {status.message}
                </p>
              )}
              {status.kind === "binary" && (
                <p className="text-[12px] text-muted-foreground">
                  Binary file — cannot render as a diagram.
                </p>
              )}
              {status.kind === "toolarge" && (
                <p className="text-[12px] text-muted-foreground">
                  File is {status.size} bytes; limit {status.limit}.
                </p>
              )}
              {status.kind === "ready" && error && (
                <div className="space-y-2">
                  <p className="text-[12px] text-destructive">
                    Failed to render diagram: {error}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onSetView("raw")}
                  >
                    View source
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
        {status.kind === "ready" && !error && svg && (
          <div
            ref={containerRef}
            className="absolute inset-0 flex items-center justify-center overflow-hidden"
            style={{ cursor: dragging ? "grabbing" : "grab" }}
            {...surfaceProps}
          >
            <div
              className="flex h-full w-full items-center justify-center [&_svg]:max-h-full [&_svg]:max-w-full"
              style={transformStyle}
              // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid.initialize({ securityLevel: "strict" }) sanitizes the SVG it returns (scripts/foreignObject/event handlers stripped) before we ever see this string.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            <ZoomControls
              scale={scale}
              isFit={isFit}
              onReset={reset}
              onZoomBy={zoomBy}
            />
          </div>
        )}
      </div>
    </div>
  );
}
