"use client";

import { Button } from "@/components/ui/button";
import {
  CheckmarkCircle01Icon,
  CopyIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo, useEffect, useRef, useState } from "react";
import {
  highlight,
  isHighlightable,
  type HighlightedNode,
} from "./code-lezer";

function normalizeLangLabel(raw: string): string {
  const lower = raw.toLowerCase();
  if (["sh", "zsh", "shell", "console", "shellscript"].includes(lower)) {
    return "bash";
  }
  if (["pwsh", "ps1", "ps"].includes(lower)) return "powershell";
  if (["bat", "batch"].includes(lower)) return "cmd";
  return lower || "text";
}

export type MarkdownCodeBlockProps = {
  code: string;
  lang: string | null;
};

export function MarkdownCodeBlock({ code, lang }: MarkdownCodeBlockProps) {
  const label = normalizeLangLabel(lang ?? "");
  return (
    <div className="not-prose my-2 overflow-hidden rounded-lg border border-border/50 bg-muted/30">
      <div className="flex items-center justify-between gap-2 border-b border-border/40 bg-muted/20 px-3 py-1">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <CopyButton text={code} />
      </div>
      <div className="overflow-x-auto">
        {isHighlightable(label) ? (
          <HighlightedPre code={code} lang={label} />
        ) : (
          <pre className="m-0 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-foreground">
            {code}
          </pre>
        )}
      </div>
    </div>
  );
}

const HighlightedPre = memo(function HighlightedPre({
  code,
  lang,
}: {
  code: string;
  lang: string;
}) {
  const [nodes, setNodes] = useState<HighlightedNode[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    highlight(code, lang)
      .then((result) => {
        if (!cancelled) setNodes(result);
      })
      .catch(() => {
        if (!cancelled) setNodes(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  if (!nodes) {
    return (
      <pre className="m-0 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-foreground">
        {code}
      </pre>
    );
  }

  return (
    <pre className="m-0 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-foreground">
      {nodes.map((node, index) =>
        node.kind === "break" ? (
          <span key={`${index}:break`}>{"\n"}</span>
        ) : (
          <span key={`${index}:${node.value}`} className={node.cls || undefined}>
            {node.value}
          </span>
        ),
      )}
    </pre>
  );
});

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number>(0);

  useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

  const onCopy = async () => {
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      timeoutRef.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      return;
    }
  };

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      onClick={onCopy}
      className="size-5 shrink-0 text-muted-foreground hover:text-foreground"
      aria-label="Copy code"
    >
      <HugeiconsIcon
        icon={copied ? CheckmarkCircle01Icon : CopyIcon}
        size={11}
        strokeWidth={1.75}
      />
    </Button>
  );
}
