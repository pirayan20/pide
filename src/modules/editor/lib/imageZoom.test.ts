import { describe, expect, it } from "vitest";
import {
  clampImageZoom,
  FIT_TRANSFORM,
  IMAGE_ZOOM_MAX,
  IMAGE_ZOOM_MIN,
  zoomTowardPoint,
} from "./imageZoom";

describe("clampImageZoom", () => {
  it("clamps to the min/max range", () => {
    expect(clampImageZoom(0)).toBe(IMAGE_ZOOM_MIN);
    expect(clampImageZoom(50)).toBe(IMAGE_ZOOM_MAX);
    expect(clampImageZoom(2)).toBe(2);
  });
});

describe("zoomTowardPoint", () => {
  it("keeps the cursor point fixed on screen while zooming", () => {
    // Zooming in 2x around a point 100px right of center must push the
    // translate left so that point stays under the cursor.
    expect(zoomTowardPoint(FIT_TRANSFORM, 2, 100, 0)).toEqual({
      scale: 2,
      x: -100,
      y: 0,
    });
  });

  it("clamps the resulting scale", () => {
    expect(zoomTowardPoint(FIT_TRANSFORM, 999, 0, 0).scale).toBe(
      IMAGE_ZOOM_MAX,
    );
    expect(zoomTowardPoint(FIT_TRANSFORM, 0, 0, 0).scale).toBe(IMAGE_ZOOM_MIN);
  });

  it("is a no-op at the same scale and origin", () => {
    expect(zoomTowardPoint(FIT_TRANSFORM, 1, 0, 0)).toEqual(FIT_TRANSFORM);
  });
});
