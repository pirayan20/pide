import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type RenderKind = "markdown" | "mermaid" | "csv" | "notebook";

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
    // case "ipynb":               return "notebook";           // added in P4
    default:
      return null;
  }
}

export function isMarkdownPath(path: string): boolean {
  return previewRendererFor(path) === "markdown";
}
