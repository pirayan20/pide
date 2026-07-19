import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type RenderKind = "markdown" | "mermaid" | "csv" | "notebook" | "svg";

export function previewRendererFor(path: string): RenderKind | null {
  switch (path.split(".").pop()?.toLowerCase()) {
    case "md":
    case "markdown":
    case "mdx":
      return "markdown"; // P0
    case "mmd":
    case "mermaid":
      return "mermaid";
    case "csv":
    case "tsv":
      return "csv"; // pane re-derives delimiter from extension
    case "ipynb":
      return "notebook";
    // SVG is text (valid UTF-8), so fs_read_file returns "text" and it would
    // otherwise open as XML source. Route it here to render the image with a
    // rendered/raw toggle. Other image formats are binary → editor image path.
    case "svg":
      return "svg";
    default:
      return null;
  }
}

export function isMarkdownPath(path: string): boolean {
  return previewRendererFor(path) === "markdown";
}
