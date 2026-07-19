import { cn } from "@/lib/utils";
import { useZoomPan, ZoomControls } from "./useZoomPan";

type Props = {
  src: string;
  alt?: string;
  /**
   * "checker": transparency checkerboard (default, for raster images).
   * "surface": no pattern — the image sits on the theme background, so a
   * transparent SVG shows dark on a dark theme (matches Orca).
   */
  background?: "checker" | "surface";
};

const CHECKERBOARD_STYLE = {
  backgroundImage:
    "conic-gradient(var(--muted) 0.25turn, transparent 0.25turn 0.5turn, var(--muted) 0.5turn 0.75turn, transparent 0.75turn)",
  backgroundSize: "20px 20px",
} as const;

// Wheel-to-zoom, drag-to-pan, double-click/reset to fit. CSS transform only —
// object-contain stays the resting (fit) state.
export function ImagePreview({ src, alt, background = "checker" }: Props) {
  const { containerRef, scale, dragging, isFit, reset, zoomBy, surfaceProps, transformStyle } =
    useZoomPan();

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      {...surfaceProps}
    >
      <img
        src={src}
        loading="lazy"
        decoding="async"
        draggable={false}
        className={cn(
          "max-w-full max-h-full object-contain rounded-md border border-border shadow-sm select-none",
          dragging ? "cursor-grabbing" : "cursor-grab",
        )}
        style={{
          ...(background === "checker" ? CHECKERBOARD_STYLE : {}),
          ...transformStyle,
        }}
        alt={alt}
      />
      <ZoomControls
        scale={scale}
        isFit={isFit}
        onReset={reset}
        onZoomBy={zoomBy}
      />
    </div>
  );
}
