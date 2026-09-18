import { useWindowAppearanceStatus } from "@/modules/theme/useWindowAppearance";
import { Button } from "@/components/ui/button";
import { Slider } from "radix-ui";
import { Switch } from "@/components/ui/switch";
import { IS_LINUX, IS_MAC, IS_WINDOWS } from "@/lib/platform";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  setBackgroundKind,
  setEditorTheme,
  setTheme,
  setThemeId,
  setWindowBlur,
  setWindowOpacity,
} from "@/modules/settings/store";
import { ZED_WINDOW_OPACITY } from "@/modules/theme/windowAppearance";
import { useState } from "react";

export function WindowAppearanceGroup() {
  const opacity = usePreferencesStore((s) => s.windowOpacity);
  const blur = usePreferencesStore((s) => s.windowBlur);
  const nativeError = useWindowAppearanceStatus((s) => s.error);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const nativeBlur = IS_MAC || IS_WINDOWS;

  const save = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch {
      setError("Could not save window appearance. Please try again.");
    }
  };

  const matchZed = async () => {
    setApplying(true);
    await save(async () => {
      await setTheme("dark");
      await setThemeId("github-dark-classic");
      await setEditorTheme("auto");
      await setBackgroundKind("none");
      await setWindowBlur(true);
      await setWindowOpacity(ZED_WINDOW_OPACITY);
    });
    setApplying(false);
  };

  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="window-appearance-heading"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3
            id="window-appearance-heading"
            className="text-[12.5px] font-medium"
          >
            Window background
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            See your desktop through Pide. No image needed.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-[11px]"
          disabled={applying}
          onClick={() => void matchZed()}
        >
          Match Zed
        </Button>
      </div>
      <div className="flex flex-col gap-3 rounded-lg border border-border/60 p-3">
        <div className="flex items-center justify-between text-[11.5px]">
          <label htmlFor="window-opacity">Background opacity</label>
          <span className="tabular-nums text-muted-foreground">
            {Math.round(opacity * 100)}%
          </span>
        </div>
        <Slider.Root
          className="relative flex w-full touch-none items-center select-none"
          value={[opacity]}
          min={0}
          max={1}
          step={0.01}
          onValueChange={(value) =>
            usePreferencesStore.setState({ windowOpacity: value[0] ?? 1 })
          }
          onValueCommit={(value) =>
            void save(() => setWindowOpacity(value[0] ?? 1))
          }
        >
          <Slider.Track className="relative h-2 grow overflow-hidden rounded-full bg-input/90">
            <Slider.Range className="absolute h-full bg-primary" />
          </Slider.Track>
          <Slider.Thumb
            id="window-opacity"
            aria-label="Background opacity"
            aria-valuetext={`${Math.round(opacity * 100)}%`}
            className="block h-4 w-6 rounded-full bg-white shadow-md ring-1 ring-black/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/30"
          />
        </Slider.Root>
        <div className="flex justify-between text-[10.5px] text-muted-foreground">
          <span>Clear</span>
          <span>Solid</span>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-3">
          <div>
            <label htmlFor="window-blur" className="text-[11.5px]">
              Blur behind window
            </label>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground">
              {IS_LINUX
                ? "Desktop blur is controlled by your Linux compositor."
                : opacity === 1
                  ? "Lower the opacity to reveal the blur."
                  : "Softens the desktop behind Pide. Blur strength follows your system."}
            </p>
          </div>
          <Switch
            id="window-blur"
            checked={blur}
            disabled={!nativeBlur}
            onCheckedChange={(value) => void save(() => setWindowBlur(value))}
          />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Match Zed uses GitHub Dark Classic, 82% opacity, and background blur.
      </p>
      {(error || nativeError) && (
        <p role="alert" className="text-[11px] text-destructive">
          {error || nativeError}
        </p>
      )}
    </section>
  );
}
