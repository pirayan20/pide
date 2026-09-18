export const ZED_WINDOW_OPACITY = 208 / 255;

export function clampWindowOpacity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

export function resolveWindowAppearance(opacity: unknown, blur: unknown) {
  const normalized = clampWindowOpacity(opacity);
  return {
    opacity: normalized,
    transparent: normalized < 1,
    blur: normalized < 1 && blur === true,
  };
}

export function createBlurController(
  apply: (enabled: boolean) => Promise<void>,
) {
  let applied = false;
  let pending = Promise.resolve();
  return (enabled: boolean): Promise<void> => {
    const next = pending.then(async () => {
      if (applied === enabled) return;
      await apply(enabled);
      applied = enabled;
    });
    pending = next.catch(() => {});
    return next;
  };
}
