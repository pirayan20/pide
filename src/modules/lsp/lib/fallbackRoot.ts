import { pathsOverlap } from "@/modules/spaces/lib/projectPaths";

/**
 * Root to anchor a language server on when a file has no marker
 * (tsconfig/package.json/Cargo.toml/...) anywhere above it: the opened project
 * root, but only when it actually contains the file. Keeps loose files served
 * by one server per project instead of leaving them with no diagnostics — and
 * never anchors a server at an unrelated project that happens to be active.
 */
export function pickFallbackRoot(
  path: string,
  projectRoot: string | null,
  caseInsensitive: boolean,
): string | null {
  if (!projectRoot) return null;
  return pathsOverlap(path, projectRoot, caseInsensitive) ? projectRoot : null;
}
