import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  FIT_TRANSFORM,
  type ImageTransform,
  zoomTowardPoint,
} from "./lib/imageZoom";

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

const ZOOM_STEP = 1.25;

// Wheel-to-zoom, drag-to-pan, double-click/reset to fit. CSS transform only —
// object-contain stays the resting (fit) state.
export function ImagePreview({ src, alt, background = "checker" }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<ImageTransform>(FIT_TRANSFORM);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const reset = useCallback(() => setTransform(FIT_TRANSFORM), []);
  // Zoom toward the container center (0,0 in center-relative coords).
  const zoomBy = useCallback((factor: number) => {
    setTransform((t) => zoomTowardPoint(t, t.scale * factor, 0, 0));
  }, []);

  // Native, non-passive listener: React's onWheel is passive, so
  // preventDefault() there wouldn't actually stop the pane from scrolling
  // (same pattern as TabBar.tsx's horizontal-wheel-scroll effect).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left - rect.width / 2;
      const py = e.clientY - rect.top - rect.height / 2;
      const factor = Math.exp(-e.deltaY * 0.001);
      setTransform((t) => zoomTowardPoint(t, t.scale * factor, px, py));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        origX: transform.x,
        origY: transform.y,
      };
      setDragging(true);
    },
    [transform.x, transform.y],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      setTransform((t) => ({
        ...t,
        x: drag.origX + (e.clientX - drag.startX),
        y: drag.origY + (e.clientY - drag.startY),
      }));
    },
    [],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    setDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  const isFit =
    transform.scale === FIT_TRANSFORM.scale &&
    transform.x === FIT_TRANSFORM.x &&
    transform.y === FIT_TRANSFORM.y;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: mouse/trackpad pan-zoom surface, no keyboard equivalent needed for an image preview
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onDoubleClick={reset}
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
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        }}
        alt={alt}
      />
      {/* Always-visible zoom controls (discoverable, esp. for diagrams); the
          % button resets to fit. stopPropagation so clicks don't start a pan. */}
      <div
        className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-md border border-border/60 bg-card/85 p-0.5 text-xs shadow-sm backdrop-blur"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          title="Zoom out"
          className="rounded px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          −
        </button>
        <button
          type="button"
          onClick={reset}
          title="Reset to fit"
          className={cn(
            "min-w-11 rounded px-1 py-0.5 tabular-nums",
            isFit
              ? "text-muted-foreground"
              : "text-foreground hover:bg-accent",
          )}
        >
          {Math.round(transform.scale * 100)}%
        </button>
        <button
          type="button"
          onClick={() => zoomBy(ZOOM_STEP)}
          title="Zoom in"
          className="rounded px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          +
        </button>
      </div>
    </div>
  );
}
