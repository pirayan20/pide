import { renderToStaticMarkup } from "react-dom/server";
import type { PointerEvent } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useSidebarDrag } from "@/modules/spaces/lib/useSidebarDrag";

class Row {
  dataset: Record<string, string> = {};
  captured = false;
  action = false;
  closest(selector: string) {
    if (selector === "input, [data-project-action]")
      return this.action ? this : null;
    if (selector === "[data-project-scroll]") return null;
    return this;
  }
  getBoundingClientRect() {
    return { top: 100, height: 100 };
  }
  hasPointerCapture() {
    return this.captured;
  }
  setPointerCapture() {
    this.captured = true;
  }
  releasePointerCapture() {
    this.captured = false;
  }
}

function setup(kind: "space" | "project" = "space") {
  const onDrop = vi.fn();
  const onStart = vi.fn();
  let drag!: ReturnType<typeof useSidebarDrag>;
  function Harness() {
    drag = useSidebarDrag(kind, onDrop, onStart);
    return null;
  }
  renderToStaticMarkup(<Harness />);
  const source = new Row();
  const target = new Row();
  target.dataset = { spaceDragId: "s2", projectId: "p2", spaceId: "s2" };
  vi.stubGlobal("Element", Row);
  vi.stubGlobal("document", { elementFromPoint: () => target });
  const event = (y: number) =>
    ({
      button: 0,
      pointerId: 1,
      clientX: 0,
      clientY: y,
      target: source,
      currentTarget: source,
      preventDefault: vi.fn(),
    }) as unknown as PointerEvent<HTMLElement>;
  return { drag, source, target, event, onDrop, onStart };
}

afterEach(() => vi.unstubAllGlobals());

it("drags a Space below another Space and suppresses the following click", () => {
  const { drag, source, event, onDrop, onStart } = setup();
  drag.start(event(0), "s1", "spaces");
  drag.move(event(3));
  expect(onStart).not.toHaveBeenCalled();
  drag.move(event(175));
  expect(source.captured).toBe(true);
  expect(onStart).toHaveBeenCalledWith("s1");
  expect(drag.suppressClick.current).toBe(true);
  drag.end(event(175));
  expect(onDrop).toHaveBeenCalledWith("spaces", "s2", "after");
  expect(source.captured).toBe(false);
});

it("supports dropping above a Space and ignores action controls", () => {
  const { drag, source, event, onDrop } = setup();
  source.action = true;
  drag.start(event(0), "s1", "spaces");
  drag.move(event(125));
  drag.end(event(125));
  expect(onDrop).not.toHaveBeenCalled();
  source.action = false;
  drag.start(event(0), "s1", "spaces");
  drag.move(event(125));
  drag.end(event(125));
  expect(onDrop).toHaveBeenCalledWith("spaces", "s2", "before");
});

it("cancels without committing or retaining pointer capture", () => {
  const { drag, source, event, onDrop } = setup();
  drag.start(event(0), "s1", "spaces");
  drag.move(event(175));
  drag.cancel();
  drag.end(event(175));
  expect(onDrop).not.toHaveBeenCalled();
  expect(source.captured).toBe(false);
});

it("continues rejecting Project drops into another Space", () => {
  const { drag, event, onDrop } = setup("project");
  drag.start(event(0), "p1", "s1");
  drag.move(event(175));
  drag.end(event(175));
  expect(onDrop).not.toHaveBeenCalled();
});
