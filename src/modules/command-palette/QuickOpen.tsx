import {
  Command,
  CommandDialog,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

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
const DEBOUNCE_MS = 150;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rootPath: string | null;
  onOpenFile: (path: string) => void;
};

function FooterKey({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border/60 bg-muted/35 px-2 py-0.5 text-[10px] font-medium text-foreground/85">
      {children}
    </span>
  );
}

export function QuickOpen({ open, onOpenChange, rootPath, onOpenFile }: Props) {
  const showHidden = usePreferencesStore((s) => s.showHidden);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
      setSearching(false);
    }
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (!open || !rootPath || q.length < MIN_QUERY_LEN) {
      setHits([]);
      setSearching(false);
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
        if (alive) setHits(res.hits.filter((h) => !h.is_dir));
      } catch (e) {
        if (alive) {
          console.error("fs_search failed:", e);
          setHits([]);
        }
      } finally {
        if (alive) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(handle);
    };
  }, [query, rootPath, showHidden, open]);

  const handleSelect = (hit: SearchHit) => {
    onOpenChange(false);
    window.setTimeout(() => onOpenFile(hit.path), 0);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Go to file"
      description="Search for a file to open."
      className="top-1/2 w-[min(680px,calc(100vw-32px))] -translate-y-1/2"
    >
      <Command shouldFilter={false} loop>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Go to file..."
          autoFocus
        />
        <ScrollArea className="max-h-[420px]">
          <CommandList className="max-h-none overflow-visible pr-3">
            {!rootPath ? (
              <StatusLine>No project selected</StatusLine>
            ) : query.trim().length < MIN_QUERY_LEN ? (
              <StatusLine>Type to search files</StatusLine>
            ) : searching && hits.length === 0 ? (
              <StatusLine>Searching…</StatusLine>
            ) : hits.length === 0 ? (
              <StatusLine>No matching files</StatusLine>
            ) : (
              hits.map((hit) => {
                const lastSlash = hit.rel.lastIndexOf("/");
                const dir = lastSlash >= 0 ? hit.rel.slice(0, lastSlash) : "";
                return (
                  <CommandItem
                    key={hit.path}
                    value={hit.path}
                    onSelect={() => handleSelect(hit)}
                    className="text-[12.5px]"
                  >
                    <img
                      src={fileIconUrl(hit.name)}
                      alt=""
                      className="size-4 shrink-0"
                    />
                    <span className="shrink-0 truncate">{hit.name}</span>
                    {dir ? (
                      <span className="min-w-0 truncate text-[11px] font-normal text-muted-foreground">
                        {dir}
                      </span>
                    ) : null}
                  </CommandItem>
                );
              })
            )}
          </CommandList>
        </ScrollArea>
        <div className="flex items-center justify-end border-t border-border/60 px-3.5 py-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <FooterKey>Enter</FooterKey>
            <span>Open</span>
            <FooterKey>Esc</FooterKey>
            <span>Close</span>
            <FooterKey>↑↓</FooterKey>
            <span>Move</span>
          </div>
        </div>
      </Command>
    </CommandDialog>
  );
}

function StatusLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
