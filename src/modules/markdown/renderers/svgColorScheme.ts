// prefers-color-scheme in the webview follows the OS, not pide's theme, and is
// evaluated inconsistently for <img>-embedded SVGs. So instead of relying on it,
// rewrite the SVG's prefers-color-scheme media conditions to pide's resolved
// theme: swap them for a viewport condition that is always true (min-width:0px)
// or never true (max-width:0px). The correct variant then renders
// deterministically regardless of the OS/webview; min/max-width keep the @media
// syntax valid.
export function pinColorScheme(svg: string, mode: "dark" | "light"): string {
  const ON = "min-width:0px";
  const OFF = "max-width:0px";
  return svg
    .replace(/prefers-color-scheme\s*:\s*dark/gi, mode === "dark" ? ON : OFF)
    .replace(/prefers-color-scheme\s*:\s*light/gi, mode === "light" ? ON : OFF);
}
