import {
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import {
  FIT_TRANSFORM,
  type ImageTransform,
  zoomTowardPoint,
} from "./lib/imageZoom";

const ZOOM_STEP = 1.25;

type PointerHandlers = {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerLeave: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
};

export type ZoomPan = {
  /** Ref for the scroll/zoom surface (wheel is bound here). */
  containerRef: RefObject<HTMLDivElement | null>;
  scale: number;
  dragging: boolean;
  isFit: boolean;
  reset: () => void;
  zoomBy: (factor: number) => void;
  /** Spread onto the surface element to enable wheel-zoom / drag-pan / dbl-fit. */
  surfaceProps: PointerHandlers;
  /** Apply to the element wrapping the zoomed content. */
  transformStyle: CSSProperties;
};

// Wheel-to-zoom, drag-to-pan, double-click to fit — shared by the image preview
// and the mermaid diagram preview. CSS transform only; fit (scale 1) is the rest
// state. See ImagePreview / MermaidPane for the two consumers.
export function useZoomPan(): ZoomPan {
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
  const zoomBy = useCallback((factor: number) => {
    setTransform((t) => zoomTowardPoint(t, t.scale * factor, 0, 0));
  }, []);

  // Native, non-passive listener: React's onWheel is passive, so preventDefault
  // there wouldn't stop the pane scrolling (same pattern as TabBar's wheel).
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

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
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

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
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

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    setDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  const isFit =
    transform.scale === FIT_TRANSFORM.scale &&
    transform.x === FIT_TRANSFORM.x &&
    transform.y === FIT_TRANSFORM.y;

  return {
    containerRef,
    scale: transform.scale,
    dragging,
    isFit,
    reset,
    zoomBy,
    surfaceProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerLeave: endDrag,
      onDoubleClick: reset,
    },
    transformStyle: {
      transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
    },
  };
}

// Always-visible zoom bar; the % button resets to fit. stopPropagation so the
// clicks don't start a pan on the surface underneath.
export function ZoomControls({
  scale,
  isFit,
  onReset,
  onZoomBy,
}: {
  scale: number;
  isFit: boolean;
  onReset: () => void;
  onZoomBy: (factor: number) => void;
}): JSX.Element {
  return (
    <div
      className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-md border border-border/60 bg-card/85 p-0.5 text-xs shadow-sm backdrop-blur"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => onZoomBy(1 / ZOOM_STEP)}
        title="Zoom out"
        className="rounded px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        −
      </button>
      <button
        type="button"
        onClick={onReset}
        title="Reset to fit"
        className={cn(
          "min-w-11 rounded px-1 py-0.5 tabular-nums",
          isFit ? "text-muted-foreground" : "text-foreground hover:bg-accent",
        )}
      >
        {Math.round(scale * 100)}%
      </button>
      <button
        type="button"
        onClick={() => onZoomBy(ZOOM_STEP)}
        title="Zoom in"
        className="rounded px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        +
      </button>
    </div>
  );
}
