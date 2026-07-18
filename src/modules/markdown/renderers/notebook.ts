/**
 * Pure parser/validator for Jupyter notebooks (nbformat v4) plus the output
 * ANSI-stripping/selection helpers NotebookPane renders with. No JSX/DOM
 * here — keeps the non-trivial branching testable without mounting React.
 */

export type NotebookCellType = "markdown" | "code" | "raw";

export type NotebookOutput = Record<string, unknown>;

export type NotebookCell = {
  cell_type: NotebookCellType;
  source: string;
  outputs: NotebookOutput[];
};

export type Notebook = {
  cells: NotebookCell[];
  language: string;
};

export type ParseNotebookResult =
  | { ok: true; notebook: Notebook }
  | { ok: false; error: string };

/** ipynb stores multi-line text as either a string or an array of line strings. */
function joinText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return value.join("");
  }
  return null;
}

function normalizeOutputs(value: unknown): NotebookOutput[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (o): o is NotebookOutput => typeof o === "object" && o !== null,
  );
}

export function parseNotebook(text: string): ParseNotebookResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { ok: false, error: "Notebook is not a JSON object." };
  }
  const raw = json as Record<string, unknown>;
  if (!Array.isArray(raw.cells)) {
    return { ok: false, error: 'Notebook is missing a "cells" array.' };
  }

  const cells: NotebookCell[] = [];
  for (let i = 0; i < raw.cells.length; i++) {
    const rawCell = raw.cells[i];
    if (typeof rawCell !== "object" || rawCell === null) {
      return { ok: false, error: `Cell ${i} is not an object.` };
    }
    const cell = rawCell as Record<string, unknown>;
    const cellType = cell.cell_type;
    if (cellType !== "markdown" && cellType !== "code" && cellType !== "raw") {
      return { ok: false, error: `Cell ${i} has an invalid cell_type.` };
    }
    const source = joinText(cell.source);
    if (source === null) {
      return { ok: false, error: `Cell ${i} has an invalid source.` };
    }
    cells.push({
      cell_type: cellType,
      source,
      outputs: normalizeOutputs(cell.outputs),
    });
  }

  const metadata = (raw.metadata ?? {}) as Record<string, unknown>;
  const kernelspec = (metadata.kernelspec ?? {}) as Record<string, unknown>;
  const languageInfo = (metadata.language_info ?? {}) as Record<
    string,
    unknown
  >;
  const language =
    (typeof kernelspec.language === "string" ? kernelspec.language : null) ??
    (typeof languageInfo.name === "string" ? languageInfo.name : null) ??
    "python";

  return { ok: true, notebook: { cells, language } };
}

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** What to render for a single code-cell output, in nbformat preference order. */
export type OutputContent =
  | { kind: "image"; mime: "image/png" | "image/jpeg"; data: string }
  | { kind: "text"; text: string }
  | { kind: "error"; text: string }
  | { kind: "html-only" }
  | { kind: "none" };

export function pickOutputContent(output: NotebookOutput): OutputContent {
  const outputType = output.output_type;
  if (outputType === "error") {
    const traceback = Array.isArray(output.traceback)
      ? output.traceback
          .filter((l): l is string => typeof l === "string")
          .join("\n")
      : "";
    return { kind: "error", text: stripAnsi(traceback) };
  }
  if (outputType === "stream") {
    const text = joinText(output.text);
    return text === null
      ? { kind: "none" }
      : { kind: "text", text: stripAnsi(text) };
  }
  if (outputType === "execute_result" || outputType === "display_data") {
    const data =
      typeof output.data === "object" && output.data !== null
        ? (output.data as Record<string, unknown>)
        : {};
    const png = joinText(data["image/png"]);
    if (png !== null) return { kind: "image", mime: "image/png", data: png };
    const jpeg = joinText(data["image/jpeg"]);
    if (jpeg !== null) {
      return { kind: "image", mime: "image/jpeg", data: jpeg };
    }
    const plain = joinText(data["text/plain"]);
    if (plain !== null) return { kind: "text", text: stripAnsi(plain) };
    if (data["text/html"] !== undefined) return { kind: "html-only" };
    return { kind: "none" };
  }
  return { kind: "none" };
}
