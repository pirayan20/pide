import { describe, expect, it, vi } from "vitest";
import {
  clampWindowOpacity,
  createBlurController,
  resolveWindowAppearance,
  ZED_WINDOW_OPACITY,
} from "@/modules/theme/windowAppearance";

describe("window appearance", () => {
  it("defaults malformed persisted opacity to opaque and bounds valid values", () => {
    for (const value of [undefined, null, "0.8", Number.NaN, Infinity]) {
      expect(clampWindowOpacity(value)).toBe(1);
    }
    expect(clampWindowOpacity(-1)).toBe(0);
    expect(clampWindowOpacity(2)).toBe(1);
    expect(clampWindowOpacity(ZED_WINDOW_OPACITY)).toBe(208 / 255);
  });

  it("only enables native blur for translucent windows with blur explicitly enabled", () => {
    expect(resolveWindowAppearance(1, true)).toEqual({
      opacity: 1,
      transparent: false,
      blur: false,
    });
    expect(resolveWindowAppearance(0.82, true).blur).toBe(true);
    expect(resolveWindowAppearance(0, true).blur).toBe(true);
    expect(resolveWindowAppearance(0.82, false).blur).toBe(false);
    expect(resolveWindowAppearance(0.82, "true").blur).toBe(false);
  });

  it("does no native work while disabled and does not reapply blur on opacity changes", async () => {
    const apply = vi.fn(async (_enabled: boolean) => {});
    const sync = createBlurController(apply);
    await sync(false);
    expect(apply).not.toHaveBeenCalled();
    await sync(true);
    await sync(true);
    await sync(false);
    await sync(false);
    expect(apply.mock.calls).toEqual([[true], [false]]);
  });

  it("serializes rapid toggles so a slow enable cannot win over a later disable", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const apply = vi.fn(async (enabled: boolean) => {
      if (enabled) await gate;
    });
    const sync = createBlurController(apply);
    const enabled = sync(true);
    const disabled = sync(false);
    await Promise.resolve();
    expect(apply.mock.calls).toEqual([[true]]);
    release();
    await Promise.all([enabled, disabled]);
    expect(apply.mock.calls).toEqual([[true], [false]]);
  });

  it("can retry after a native effect failure", async () => {
    const apply = vi
      .fn()
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValue(undefined);
    const sync = createBlurController(apply);
    await expect(sync(true)).rejects.toThrow("unavailable");
    await sync(true);
    await sync(false);
    expect(apply.mock.calls).toEqual([[true], [true], [false]]);
  });
});
