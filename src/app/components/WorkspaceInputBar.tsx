import { useBlockController } from "@/modules/terminal/lib/blockController";
import { focusLeafInput } from "@/modules/terminal/lib/useTerminalSession";
import { useTheme } from "@/modules/theme";
import {
  CommandLineIcon,
  Folder01Icon,
  GitBranchIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { OsIcon } from "./OsIcon";
import { useGitBranch } from "./useGitBranch";
import { useSystemInfo } from "./useSystemInfo";

const ShellInput = lazy(() => import("@/modules/terminal/block/ShellInput"));

export const FOCUS_BLOCK_INPUT_EVENT = "pide:focus-block-input";

type Props = {
  isBlockTab: boolean;
  activeLeafId: number | null;
  cwd: string | null;
  home: string | null;
};

export function WorkspaceInputBar({
  isBlockTab,
  activeLeafId,
  cwd,
  home,
}: Props) {
  const { resolvedMode, themeId, customThemes } = useTheme();
  const themeKey = `${resolvedMode}:${themeId}:${customThemes.length}`;
  const { os, shell } = useSystemInfo();
  const controller = useBlockController(isBlockTab ? activeLeafId : null);
  const blockMode = controller?.blockMode ?? "prompt";

  const [promptNonce, setPromptNonce] = useState(0);
  const prevBlockMode = useRef(blockMode);
  useEffect(() => {
    if (prevBlockMode.current !== "prompt" && blockMode === "prompt") {
      setPromptNonce((nonce) => nonce + 1);
    }
    prevBlockMode.current = blockMode;
  }, [blockMode]);
  const branch = useGitBranch(isBlockTab ? cwd : null, promptNonce);

  useEffect(() => {
    if (!isBlockTab || activeLeafId == null) return;
    const focus = () => focusLeafInput(activeLeafId);
    window.addEventListener(FOCUS_BLOCK_INPUT_EVENT, focus);
    return () => window.removeEventListener(FOCUS_BLOCK_INPUT_EVENT, focus);
  }, [activeLeafId, isBlockTab]);

  if (!isBlockTab || !controller || activeLeafId == null) return null;

  return (
    <div className="shrink-0 border-t border-border/60 bg-card/40 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5 pb-2">
        {os && (
          <ContextChip title={os} iconNode={<OsIcon os={os} />}>
            {os}
          </ContextChip>
        )}
        {cwd && (
          <ContextChip title={cwd} icon={Folder01Icon}>
            {relPath(cwd, home)}
          </ContextChip>
        )}
        {branch && (
          <ContextChip title={`Branch: ${branch}`} icon={GitBranchIcon}>
            {branch}
          </ContextChip>
        )}
        {shell && <ContextChip icon={CommandLineIcon}>{shell}</ContextChip>}
      </div>
      <Suspense fallback={null}>
        <ShellInput
          leafId={activeLeafId}
          mode={blockMode}
          focused
          themeKey={themeKey}
          onSubmit={controller.submitCommand}
          onInterrupt={controller.interrupt}
          getCwd={controller.getCwd}
        />
      </Suspense>
    </div>
  );
}

function ContextChip({
  title,
  icon,
  iconNode,
  children,
}: {
  title?: string;
  icon?: IconSvgElement;
  iconNode?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className="inline-flex min-w-0 items-center gap-1 rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 text-[10.5px] text-muted-foreground"
    >
      {iconNode}
      {icon && <HugeiconsIcon icon={icon} size={11} strokeWidth={1.75} />}
      <span className="max-w-48 truncate">{children}</span>
    </span>
  );
}

function relPath(path: string, home: string | null): string {
  if (!home) return path;
  const normalizedHome = home.replace(/\/+$/, "");
  if (path === normalizedHome || path.startsWith(`${normalizedHome}/`)) {
    return `~${path.slice(normalizedHome.length)}`;
  }
  return path;
}
