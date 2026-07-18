import { cn } from "@/lib/utils";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef } from "react";
import { MarkdownViewToggle } from "../MarkdownViewToggle";
import { useFileText } from "../useFileText";
import { parseDelimited } from "./parseDelimited";

type Props = {
  path: string;
  visible: boolean;
  onSetView: (mode: "rendered" | "raw") => void;
};

const ROW_HEIGHT = 26;
const OVERSCAN = 12;
// ponytail: below this many body rows a plain <tbody> is cheap enough —
// skip the virtualizer's spacer-row math entirely.
const VIRTUALIZE_THRESHOLD = 200;

export function CsvPane({ path, visible, onSetView }: Props) {
  const status = useFileText(path);
  const delimiter = path.toLowerCase().endsWith(".tsv") ? "\t" : ",";
  const rows = useMemo(
    () =>
      status.kind === "ready" ? parseDelimited(status.content, delimiter) : [],
    [status, delimiter],
  );
  const [header, ...body] = rows;
  const shouldVirtualize = body.length > VIRTUALIZE_THRESHOLD;

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: body.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });
  const virtualItems = shouldVirtualize ? virtualizer.getVirtualItems() : [];
  const topPad = virtualItems[0]?.start ?? 0;
  const bottomPad = shouldVirtualize
    ? virtualizer.getTotalSize() -
      (virtualItems[virtualItems.length - 1]?.end ?? 0)
    : 0;

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background",
        !visible && "pointer-events-none",
      )}
    >
      <MarkdownViewToggle mode="rendered" onChange={onSetView} />
      {status.kind !== "ready" && (
        <div className="flex-1 overflow-auto">
          <div className="px-8 py-6">
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
                Binary file — cannot render as a table.
              </p>
            )}
            {status.kind === "toolarge" && (
              <p className="text-[12px] text-muted-foreground">
                File is {status.size} bytes; limit {status.limit}.
              </p>
            )}
          </div>
        </div>
      )}
      {status.kind === "ready" && !header && (
        <div className="flex-1 overflow-auto">
          <div className="px-8 py-6">
            <p className="text-[12px] text-muted-foreground">Empty file.</p>
          </div>
        </div>
      )}
      {status.kind === "ready" && header && (
        <div ref={scrollRef} className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead className="sticky top-0 z-[1] bg-card">
              <tr>
                {header.map((cell, i) => (
                  <th
                    // biome-ignore lint/suspicious/noArrayIndexKey: CSV columns have no id besides position; header order is stable within a render.
                    key={i}
                    className="truncate whitespace-nowrap border-b border-border/60 px-2 py-1 text-left font-medium"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topPad > 0 && <tr style={{ height: topPad }} />}
              {(shouldVirtualize
                ? virtualItems.map((vi) => body[vi.index])
                : body
              ).map((r, i) => (
                <tr
                  // biome-ignore lint/suspicious/noArrayIndexKey: CSV rows have no id besides position; row order is stable within a render.
                  key={i}
                  className="border-b border-border/40"
                  style={shouldVirtualize ? { height: ROW_HEIGHT } : undefined}
                >
                  {r?.map((cell, j) => (
                    <td
                      // biome-ignore lint/suspicious/noArrayIndexKey: CSV columns have no id besides position; column order is stable within a render.
                      key={j}
                      className="truncate whitespace-nowrap px-2 py-1"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
              {bottomPad > 0 && <tr style={{ height: bottomPad }} />}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
