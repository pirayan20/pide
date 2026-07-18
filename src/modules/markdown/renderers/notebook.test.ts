import { describe, expect, it } from "vitest";

import { parseNotebook, pickOutputContent, stripAnsi } from "./notebook";

describe("parseNotebook", () => {
  it("parses a valid minimal notebook", () => {
    const result = parseNotebook(
      JSON.stringify({
        cells: [
          { cell_type: "markdown", source: "# Title" },
          { cell_type: "code", source: "print(1)", outputs: [] },
        ],
        metadata: { kernelspec: { language: "python" } },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notebook.language).toBe("python");
    expect(result.notebook.cells).toEqual([
      { cell_type: "markdown", source: "# Title", outputs: [] },
      { cell_type: "code", source: "print(1)", outputs: [] },
    ]);
  });

  it("joins source given as an array of lines", () => {
    const result = parseNotebook(
      JSON.stringify({
        cells: [{ cell_type: "code", source: ["import os\n", "os.getcwd()"] }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notebook.cells[0]?.source).toBe("import os\nos.getcwd()");
  });

  it("falls back to language_info.name when kernelspec is absent", () => {
    const result = parseNotebook(
      JSON.stringify({
        cells: [],
        metadata: { language_info: { name: "rust" } },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notebook.language).toBe("rust");
  });

  it("defaults language to python when no metadata is present", () => {
    const result = parseNotebook(JSON.stringify({ cells: [] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notebook.language).toBe("python");
  });

  it("errors on invalid JSON", () => {
    const result = parseNotebook("{not json");
    expect(result.ok).toBe(false);
  });

  it("errors when cells is missing", () => {
    const result = parseNotebook(JSON.stringify({ metadata: {} }));
    expect(result.ok).toBe(false);
  });

  it("errors when a cell has an invalid cell_type", () => {
    const result = parseNotebook(
      JSON.stringify({ cells: [{ cell_type: "bogus", source: "x" }] }),
    );
    expect(result.ok).toBe(false);
  });

  it("errors when a cell source is neither a string nor a string array", () => {
    const result = parseNotebook(
      JSON.stringify({ cells: [{ cell_type: "code", source: 42 }] }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("stripAnsi", () => {
  it("removes ANSI color codes and leaves the text intact", () => {
    expect(stripAnsi("[31mred[0m text")).toBe("red text");
  });

  it("leaves plain text unchanged", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });
});

describe("pickOutputContent", () => {
  it("prefers image/png over image/jpeg and text/plain", () => {
    const content = pickOutputContent({
      output_type: "display_data",
      data: {
        "image/png": "png-bytes",
        "image/jpeg": "jpeg-bytes",
        "text/plain": "a figure",
      },
    });
    expect(content).toEqual({
      kind: "image",
      mime: "image/png",
      data: "png-bytes",
    });
  });

  it("falls back to text/plain when no image data is present", () => {
    const content = pickOutputContent({
      output_type: "execute_result",
      data: { "text/plain": "42" },
    });
    expect(content).toEqual({ kind: "text", text: "42" });
  });

  it("returns html-only when only text/html is present", () => {
    const content = pickOutputContent({
      output_type: "display_data",
      data: { "text/html": "<b>hi</b>" },
    });
    expect(content).toEqual({ kind: "html-only" });
  });

  it("ANSI-strips stream text", () => {
    const content = pickOutputContent({
      output_type: "stream",
      name: "stdout",
      text: "[32mok[0m\n",
    });
    expect(content).toEqual({ kind: "text", text: "ok\n" });
  });

  it("ANSI-strips and joins an error traceback", () => {
    const content = pickOutputContent({
      output_type: "error",
      ename: "ValueError",
      evalue: "boom",
      traceback: ["[31mTraceback[0m", "ValueError: boom"],
    });
    expect(content).toEqual({
      kind: "error",
      text: "Traceback\nValueError: boom",
    });
  });
});
