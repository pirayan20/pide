import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  CONTENT_SEARCH_MIN_QUERY,
  type ContentHit,
  useContentSearch,
} from "@/modules/command-palette/hooks/useContentSearch";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { currentWorkspaceEnv } from "@/modules/workspace";
import {
  ArrowRight01Icon,
  Cancel01Icon,
  Folder01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { copyToClipboard, revealInFinder } from "./lib/contextActions";
import { fileIconUrl } from "./lib/iconResolver";
import { COMPACT_CONTENT, COMPACT_ITEM } from "./lib/menuItemClass";

type SearchHit = {
  path: string;
  rel: string;
  name: string;
  is_dir: boolean;
};

type SearchResult = {
  hits: SearchHit[];
  truncated: boolean;
};

const MIN_QUERY_LEN = 2;
const DEBOUNCE_MS = 300;

type Mode = "names" | "contents";

const MODES: { mode: Mode; label: string; ariaLabel: string }[] = [
  { mode: "names", label: "Names", ariaLabel: "Filter files by name" },
  { mode: "contents", label: "Contents", ariaLabel: "Search file contents" },
];

type Props = {
  rootPath: string;
  onOpenFile: (path: string) => void;
  onOpenAtLine?: (path: string, line: number) => void;
  onActiveChange?: (active: boolean) => void;
  onRevealInTerminal?: (path: string) => void;
};

export type ExplorerSearchHandle = {
  focus: () => void;
  isFocused: () => boolean;
};

export const ExplorerSearch = forwardRef<ExplorerSearchHandle, Props>(
  function ExplorerSearch(
    {
      rootPath,
      onOpenFile,
      onOpenAtLine,
      onActiveChange,
      onRevealInTerminal,
    }: Props,
    ref,
  ) {
    const showHidden = usePreferencesStore((s) => s.showHidden);
    const [query, setQuery] = useState("");
    const [mode, setMode] = useState<Mode>("names");
    const [results, setResults] = useState<SearchHit[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [searching, setSearching] = useState(false);
    const [truncated, setTruncated] = useState(false);
    const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(
      new Set(),
    );
    const inputRef = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const lastKeyboardNavAt = useRef(0);

    const active = query.trim().length > 0;
    const inContents = mode === "contents";

    const content = useContentSearch(
      rootPath,
      query.trim(),
      active && inContents,
    );

    useEffect(() => {
      onActiveChange?.(active);
    }, [active, onActiveChange]);

    useEffect(() => {
      const q = query.trim();
      if (inContents || q.length < MIN_QUERY_LEN) {
        setResults([]);
        setSelectedIndex(0);
        setSearching(false);
        setTruncated(false);
        return;
      }
      setSearching(true);
      let alive = true;
      const handle = setTimeout(async () => {
        try {
          const res = await invoke<SearchResult>("fs_search", {
            root: rootPath,
            query: q,
            limit: 200,
            showHidden,
            workspace: currentWorkspaceEnv(),
          });
          if (alive) {
            setResults(res.hits);
            setTruncated(res.truncated);
            setSelectedIndex(0);
          }
        } catch (e) {
          if (alive) {
            console.error("fs_search failed:", e);
            setResults([]);
            setTruncated(false);
            setSelectedIndex(0);
          }
        } finally {
          if (alive) setSearching(false);
        }
      }, DEBOUNCE_MS);

      return () => {
        alive = false;
        clearTimeout(handle);
      };
    }, [query, rootPath, showHidden, inContents]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: mode/content.results are triggers, not reads — switching tabs or getting new results resets the selection.
    useEffect(() => {
      setSelectedIndex(0);
      setCollapsedFiles(new Set());
    }, [mode, content.results]);

    const contentGroups = useMemo(() => {
      const groups: { rel: string; hits: ContentHit[] }[] = [];
      const byRel = new Map<string, ContentHit[]>();
      for (const hit of content.results) {
        let hits = byRel.get(hit.rel);
        if (!hits) {
          hits = [];
          byRel.set(hit.rel, hits);
          groups.push({ rel: hit.rel, hits });
        }
        hits.push(hit);
      }
      return groups;
    }, [content.results]);

    const visibleHits = useMemo(
      () =>
        contentGroups
          .filter((g) => !collapsedFiles.has(g.rel))
          .flatMap((g) => g.hits),
      [contentGroups, collapsedFiles],
    );

    const toggleCollapsed = (rel: string) => {
      setSelectedIndex(0);
      setCollapsedFiles((prev) => {
        const next = new Set(prev);
        if (next.has(rel)) next.delete(rel);
        else next.add(rel);
        return next;
      });
    };

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          requestAnimationFrame(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
          });
        },
        isFocused: () => document.activeElement === inputRef.current,
      }),
      [],
    );

    const rowCount = inContents ? visibleHits.length : results.length;

    useEffect(() => {
      if (active && rowCount > 0) {
        const el = scrollRef.current?.querySelector(
          `[data-index="${selectedIndex}"]`,
        );
        el?.scrollIntoView({ block: "nearest" });
      }
    }, [selectedIndex, rowCount, active]);

    const handleSelect = (hit: SearchHit) => {
      if (!hit.is_dir) {
        onOpenFile(hit.path);
      }
    };

    const commitSelected = () => {
      if (inContents) {
        const hit = visibleHits[selectedIndex];
        if (hit) onOpenAtLine?.(hit.path, hit.line);
      } else {
        const hit = results[selectedIndex];
        if (hit) handleSelect(hit);
      }
    };

    return (
      <div className={cn("flex min-h-0 flex-col", active && "flex-1")}>
        <div className="shrink-0 border-b border-border/60 px-2 py-1.5">
          <div className="relative">
            <HugeiconsIcon
              icon={Search01Icon}
              size={13}
              strokeWidth={2}
              className="absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  if (query) setQuery("");
                  else inputRef.current?.blur();
                  return;
                }
                if (rowCount > 0) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    lastKeyboardNavAt.current = Date.now();
                    setSelectedIndex((prev) => (prev + 1) % rowCount);
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    lastKeyboardNavAt.current = Date.now();
                    setSelectedIndex(
                      (prev) => (prev - 1 + rowCount) % rowCount,
                    );
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    commitSelected();
                  }
                }
              }}
              placeholder={inContents ? "Search in files…" : "Find files…"}
              className="h-7 pr-7 pl-6.5 text-xs"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Clear search"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
              </button>
            ) : null}
          </div>
          <div className="mt-1.5 flex h-6 w-full items-center gap-0.5 rounded-md bg-input/40 p-0.5">
            {MODES.map((opt) => (
              <button
                key={opt.mode}
                type="button"
                aria-label={opt.ariaLabel}
                aria-pressed={mode === opt.mode}
                onClick={() => setMode(opt.mode)}
                className={cn(
                  "h-full min-w-0 flex-1 rounded-[5px] text-[11px] transition-colors",
                  mode === opt.mode
                    ? "bg-background font-medium text-foreground shadow-xs"
                    : "text-muted-foreground hover:bg-background/40 hover:text-foreground",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {active ? (
          <ScrollArea className="min-h-0 flex-1">
            <div className="py-1" ref={scrollRef}>
              {inContents ? (
                query.trim().length < CONTENT_SEARCH_MIN_QUERY ? (
                  <StatusLine>Type at least 2 characters</StatusLine>
                ) : content.error ? (
                  <StatusLine tone="error">Search failed</StatusLine>
                ) : content.loading && content.results.length === 0 ? (
                  <StatusLine>Searching…</StatusLine>
                ) : content.results.length === 0 ? (
                  <StatusLine>No matches</StatusLine>
                ) : (
                  (() => {
                    let rowIndex = -1;
                    return contentGroups.map((group) => {
                      const isCollapsed = collapsedFiles.has(group.rel);
                      const dir = dirname(group.rel);
                      return (
                        <div key={group.rel} className="pt-1">
                          <button
                            type="button"
                            onClick={() => toggleCollapsed(group.rel)}
                            aria-expanded={!isCollapsed}
                            className="flex w-full items-center gap-1 px-2 py-0.5 text-left text-xs transition-colors hover:bg-accent/50"
                            title={group.rel}
                          >
                            <HugeiconsIcon
                              icon={ArrowRight01Icon}
                              size={12}
                              strokeWidth={2}
                              className={cn(
                                "shrink-0 text-muted-foreground transition-transform",
                                !isCollapsed && "rotate-90",
                              )}
                            />
                            <img
                              src={fileIconUrl(basename(group.rel))}
                              alt=""
                              className="size-3.5 shrink-0"
                            />
                            <span className="min-w-0 flex-1 truncate">
                              <span className="text-foreground">
                                {basename(group.rel)}
                              </span>
                              {dir ? (
                                <span className="ml-1.5 text-[10px] text-muted-foreground">
                                  {dir}
                                </span>
                              ) : null}
                            </span>
                            <span className="shrink-0 rounded-full bg-muted/80 px-1.5 text-[10px] text-muted-foreground">
                              {group.hits.length}
                            </span>
                          </button>
                          {!isCollapsed
                            ? group.hits.map((hit) => {
                                rowIndex += 1;
                                const index = rowIndex;
                                const isSelected = index === selectedIndex;
                                const parts = splitMatch(
                                  hit.text,
                                  query.trim(),
                                );
                                return (
                                  <button
                                    key={`${hit.path}:${hit.line}`}
                                    type="button"
                                    data-index={index}
                                    onClick={() =>
                                      onOpenAtLine?.(hit.path, hit.line)
                                    }
                                    onMouseEnter={() => {
                                      if (
                                        Date.now() - lastKeyboardNavAt.current >
                                        250
                                      ) {
                                        setSelectedIndex(index);
                                      }
                                    }}
                                    className={cn(
                                      "flex w-full items-baseline gap-1.5 py-px pr-2 pl-7 text-left transition-colors",
                                      isSelected
                                        ? "bg-accent text-foreground"
                                        : "hover:bg-accent/50 text-foreground/80",
                                    )}
                                    title={`${hit.rel}:${hit.line}`}
                                  >
                                    <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                                      {hit.line}
                                    </span>
                                    <span className="flex min-w-0 items-baseline whitespace-pre font-mono text-[11px]">
                                      <span className="shrink-0 text-muted-foreground">
                                        {parts.before}
                                      </span>
                                      {parts.match ? (
                                        <span className="shrink-0 rounded-sm bg-amber-500/30 text-foreground">
                                          {parts.match}
                                        </span>
                                      ) : null}
                                      <span className="min-w-0 truncate text-muted-foreground">
                                        {parts.after}
                                      </span>
                                    </span>
                                  </button>
                                );
                              })
                            : null}
                        </div>
                      );
                    });
                  })()
                )
              ) : searching && results.length === 0 ? (
                <StatusLine>Searching…</StatusLine>
              ) : results.length === 0 ? (
                <StatusLine>No matches</StatusLine>
              ) : (
                results.map((hit, index) => {
                  const url = hit.is_dir ? null : fileIconUrl(hit.name);
                  const isSelected = index === selectedIndex;
                  return (
                    <ContextMenu key={hit.path}>
                      <ContextMenuTrigger asChild>
                        <button
                          type="button"
                          data-index={index}
                          onClick={() => handleSelect(hit)}
                          onMouseEnter={() => {
                            if (Date.now() - lastKeyboardNavAt.current > 250) {
                              setSelectedIndex(index);
                            }
                          }}
                          className={cn(
                            "flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs transition-colors",
                            isSelected
                              ? "bg-accent text-foreground"
                              : "hover:bg-accent/50 text-foreground/80",
                          )}
                          title={hit.path}
                        >
                          {url ? (
                            <img
                              src={url}
                              alt=""
                              className="size-3.5 shrink-0"
                            />
                          ) : (
                            <HugeiconsIcon
                              icon={Folder01Icon}
                              size={13}
                              strokeWidth={1.75}
                              className="shrink-0 text-muted-foreground"
                            />
                          )}
                          <span className="truncate">{hit.name}</span>
                          <span className="ml-auto truncate text-[10px] text-muted-foreground">
                            {hit.rel}
                          </span>
                        </button>
                      </ContextMenuTrigger>
                      <ContextMenuContent className={COMPACT_CONTENT}>
                        {!hit.is_dir && (
                          <ContextMenuItem
                            className={COMPACT_ITEM}
                            onSelect={() => onOpenFile(hit.path)}
                          >
                            Open
                          </ContextMenuItem>
                        )}
                        {hit.is_dir && onRevealInTerminal && (
                          <ContextMenuItem
                            className={COMPACT_ITEM}
                            onSelect={() => onRevealInTerminal(hit.path)}
                          >
                            Open in Terminal
                          </ContextMenuItem>
                        )}
                        <ContextMenuItem
                          className={COMPACT_ITEM}
                          onSelect={() => void revealInFinder(hit.path)}
                        >
                          Reveal in Finder
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          className={COMPACT_ITEM}
                          onSelect={() => void copyToClipboard(hit.path)}
                        >
                          Copy Path
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })
              )}
              {!inContents && truncated && results.length > 0 ? (
                <div className="px-3 py-1.5 text-[10px] text-muted-foreground">
                  Showing partial results — refine your query.
                </div>
              ) : null}
              {inContents && content.results.length > 0 && content.loading ? (
                <StatusLine>Searching…</StatusLine>
              ) : null}
            </div>
          </ScrollArea>
        ) : null}
      </div>
    );
  },
);

function StatusLine({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <div
      className={cn(
        "px-3 py-2 text-[11px]",
        tone === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </div>
  );
}

function basename(rel: string): string {
  const parts = rel.split(/[\\/]/);
  return parts[parts.length - 1] || rel;
}

function dirname(rel: string): string {
  const parts = rel.split(/[\\/]/);
  return parts.slice(0, -1).join("/");
}

// Mirrors ORCA/VS Code's search view: left-truncate the pre-match text so the
// highlight stays visible at narrow sidebar widths.
const BEFORE_MAX = 26;

function splitMatch(
  text: string,
  q: string,
): { before: string; match: string; after: string } {
  const t = text.trim();
  const idx = q ? t.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (idx < 0) return { before: t, match: "", after: "" };
  const rawBefore = t.slice(0, idx);
  const before =
    rawBefore.length > BEFORE_MAX
      ? `…${rawBefore.slice(rawBefore.length - BEFORE_MAX)}`
      : rawBefore;
  return {
    before,
    match: t.slice(idx, idx + q.length),
    after: t.slice(idx + q.length),
  };
}
