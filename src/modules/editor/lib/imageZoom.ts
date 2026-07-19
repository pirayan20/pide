// Pure zoom/pan math for the image preview — framework-free so it's
// trivially testable without mounting anything.

export const IMAGE_ZOOM_MIN = 0.1;
export const IMAGE_ZOOM_MAX = 10;

export type ImageTransform = { scale: number; x: number; y: number };

// object-contain baseline: unscaled, centered.
export const FIT_TRANSFORM: ImageTransform = { scale: 1, x: 0, y: 0 };

export function clampImageZoom(scale: number): number {
  return Math.min(IMAGE_ZOOM_MAX, Math.max(IMAGE_ZOOM_MIN, scale));
}

/**
 * Zoom to `nextScale`, keeping the point at (px, py) — relative to the
 * container's center, same units as `x`/`y` — visually fixed under the
 * cursor. Clamps the resulting scale.
 */
export function zoomTowardPoint(
  t: ImageTransform,
  nextScale: number,
  px: number,
  py: number,
): ImageTransform {
  const scale = clampImageZoom(nextScale);
  const ratio = scale / t.scale;
  return {
    scale,
    x: px + (t.x - px) * ratio,
    y: py + (t.y - py) * ratio,
  };
}
