import { describe, expect, it } from "vitest";
import { isMarkdownPath, previewRendererFor } from "./utils";

describe("previewRendererFor", () => {
  it("returns markdown for md/markdown/mdx (case-insensitive)", () => {
    expect(previewRendererFor("README.md")).toBe("markdown");
    expect(previewRendererFor("README.MARKDOWN")).toBe("markdown");
    expect(previewRendererFor("notes.mdx")).toBe("markdown");
  });

  it("returns mermaid for mmd/mermaid (case-insensitive)", () => {
    expect(previewRendererFor("diagram.mmd")).toBe("mermaid");
    expect(previewRendererFor("diagram.MERMAID")).toBe("mermaid");
  });

  it("returns csv for csv/tsv (case-insensitive)", () => {
    expect(previewRendererFor("data.csv")).toBe("csv");
    expect(previewRendererFor("data.TSV")).toBe("csv");
  });

  it("returns null for renderer-less extensions in this phase", () => {
    expect(previewRendererFor("notebook.ipynb")).toBeNull();
    expect(previewRendererFor("main.ts")).toBeNull();
  });

  it("returns null for extension-less paths", () => {
    expect(previewRendererFor("README")).toBeNull();
  });
});

describe("isMarkdownPath", () => {
  it("is true only for markdown-rendered extensions", () => {
    expect(isMarkdownPath("README.md")).toBe(true);
    expect(isMarkdownPath("notes.mdx")).toBe(true);
    expect(isMarkdownPath("data.csv")).toBe(false);
  });
});
