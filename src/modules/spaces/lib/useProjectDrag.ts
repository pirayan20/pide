import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { DropSide } from "@/modules/spaces/lib/projectOrder";

type Target = { id: string; side: DropSide };
export function useProjectDrag(
  onDrop: (spaceId: string, id: string, side: DropSide) => void,
  onStart: (id: string) => void,
) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const drag = useRef<{
    id: string;
    spaceId: string;
    pointerId: number;
    x: number;
    y: number;
    active: boolean;
    target: Target | null;
    element: HTMLElement;
  } | null>(null);
  const suppressClick = useRef(false);
  const reset = () => {
    const current = drag.current;
    drag.current = null;
    if (current?.element.hasPointerCapture(current.pointerId))
      current.element.releasePointerCapture(current.pointerId);
    setDraggingId(null);
    setTarget(null);
  };
  useEffect(
    () => () => {
      const current = drag.current;
      if (current?.element.hasPointerCapture(current.pointerId))
        current.element.releasePointerCapture(current.pointerId);
    },
    [],
  );

  return {
    draggingId,
    target,
    suppressClick,
    start(event: PointerEvent<HTMLElement>, id: string, spaceId: string) {
      suppressClick.current = false;
      if (
        event.button !== 0 ||
        !(event.target instanceof Element) ||
        event.target.closest("input, [data-project-action]")
      )
        return;
      drag.current = {
        id,
        spaceId,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        active: false,
        target: null,
        element: event.currentTarget,
      };
    },
    move(event: PointerEvent<HTMLElement>) {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (!current.active) {
        if (
          Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5
        )
          return;
        current.active = true;
        suppressClick.current = true;
        current.element.setPointerCapture(event.pointerId);
        onStart(current.id);
        setDraggingId(current.id);
      }
      event.preventDefault();
      const row = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-project-id]");
      const targetId = row?.dataset.projectId;
      const next: Target | null =
        targetId &&
        row?.dataset.spaceId === current.spaceId &&
        row.dataset.projectId !== current.id
          ? {
              id: targetId,
              side:
                event.clientY <
                row.getBoundingClientRect().top +
                  row.getBoundingClientRect().height / 2
                  ? "before"
                  : "after",
            }
          : null;
      current.target = next;
      setTarget((previous) =>
        previous?.id === next?.id && previous?.side === next?.side
          ? previous
          : next,
      );
      const scroller = current.element.closest<HTMLElement>(
        "[data-project-scroll]",
      );
      if (scroller) {
        const bounds = scroller.getBoundingClientRect();
        if (event.clientY < bounds.top + 28) scroller.scrollTop -= 12;
        else if (event.clientY > bounds.bottom - 28) scroller.scrollTop += 12;
      }
    },
    end(event: PointerEvent<HTMLElement>) {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (current.active && current.target)
        onDrop(current.spaceId, current.target.id, current.target.side);
      reset();
    },
    cancel: reset,
  };
}
