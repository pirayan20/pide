import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMemo } from "react";
import { Streamdown } from "streamdown";
import { MarkdownCode } from "../components/MarkdownCode";
import { MarkdownCodeBlock } from "../components/MarkdownCodeBlock";
import { MarkdownViewToggle } from "../MarkdownViewToggle";
import { useFileText } from "../useFileText";
import {
  type NotebookCell,
  type NotebookOutput,
  parseNotebook,
  pickOutputContent,
} from "./notebook";

type Props = {
  path: string;
  visible: boolean;
  onSetView: (mode: "rendered" | "raw") => void;
};

const components = { code: MarkdownCode };

const preClass =
  "my-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-border/50 bg-muted/30 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed";

function CellOutput({ output }: { output: NotebookOutput }) {
  const content = pickOutputContent(output);
  switch (content.kind) {
    case "image":
      return (
        <img
          className="my-2 max-w-full rounded"
          src={`data:${content.mime};base64,${content.data}`}
          alt="Notebook output"
        />
      );
    case "text":
      return (
        <pre className={cn(preClass, "text-foreground")}>{content.text}</pre>
      );
    case "error":
      return (
        <pre className={cn(preClass, "text-destructive")}>{content.text}</pre>
      );
    case "html-only":
      return (
        <p className="my-2 text-[12px] text-muted-foreground">
          HTML output not rendered
        </p>
      );
    case "none":
      return null;
  }
}

function Cell({ cell, language }: { cell: NotebookCell; language: string }) {
  if (cell.cell_type === "markdown") {
    return (
      <Streamdown
        className="select-text [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
        components={components}
        mode="static"
        parseIncompleteMarkdown={false}
      >
        {cell.source}
      </Streamdown>
    );
  }
  if (cell.cell_type === "code") {
    return (
      <div>
        <MarkdownCodeBlock code={cell.source} lang={language} />
        {cell.outputs.map((output, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: outputs have no stable id; order is stable within a render.
          <CellOutput key={i} output={output} />
        ))}
      </div>
    );
  }
  // raw cell — no fence/highlighting, just the source text.
  return <pre className={cn(preClass, "text-foreground")}>{cell.source}</pre>;
}

export function NotebookPane({ path, visible, onSetView }: Props) {
  const status = useFileText(path);
  const result = useMemo(
    () => (status.kind === "ready" ? parseNotebook(status.content) : null),
    [status],
  );

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background",
        !visible && "pointer-events-none",
      )}
    >
      <MarkdownViewToggle mode="rendered" onChange={onSetView} />
      <div className="flex-1 overflow-auto">
        <div className="space-y-4 px-8 py-6">
          {status.kind === "loading" && (
            <p className="text-[12px] text-muted-foreground">Loading…</p>
          )}
          {status.kind === "error" && (
            <p className="text-[12px] text-destructive">
              Failed to read file: {status.message}
            </p>
          )}
          {status.kind === "binary" && (
            <p className="text-[12px] text-muted-foreground">
              Binary file — cannot render as a notebook.
            </p>
          )}
          {status.kind === "toolarge" && (
            <p className="text-[12px] text-muted-foreground">
              File is {status.size} bytes; limit {status.limit}.
            </p>
          )}
          {status.kind === "ready" && result && !result.ok && (
            <div className="space-y-2">
              <p className="text-[12px] text-destructive">
                Failed to parse notebook: {result.error}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSetView("raw")}
              >
                View source
              </Button>
            </div>
          )}
          {status.kind === "ready" &&
            result?.ok &&
            result.notebook.cells.map((cell, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: notebook cells have no stable id; order is stable within a render.
              <Cell key={i} cell={cell} language={result.notebook.language} />
            ))}
        </div>
      </div>
    </div>
  );
}
