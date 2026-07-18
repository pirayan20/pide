import { native, onGitChanged } from "@/lib/native";
import type { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { setGitQuickDiffBaselines } from "./gitQuickDiffExtension";

type Params = {
  active: boolean;
  path: string;
  ready: boolean;
  cmRef: RefObject<ReactCodeMirrorRef | null>;
};

export function nextGitQuickDiffGeneration(
  generation: number,
  currentRepoRoot: string | null,
  changedRepoRoot?: string,
): number {
  return changedRepoRoot !== undefined &&
    currentRepoRoot !== null &&
    changedRepoRoot !== currentRepoRoot
    ? generation
    : generation + 1;
}

export function useGitQuickDiff({ active, path, ready, cmRef }: Params): void {
  const generationRef = useRef(0);
  const staleRef = useRef(true);
  const repoRootRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const lastFocusRefreshRef = useRef(0);

  const refresh = useCallback(async () => {
    const view = cmRef.current?.view;
    if (!active || !ready || !view) return;

    const generation = ++generationRef.current;
    try {
      const result = await native.gitEditorBaselines(path);
      if (!mountedRef.current || generation !== generationRef.current) return;

      repoRootRef.current = result.repoRoot;
      staleRef.current = false;
      view.dispatch({
        effects:
          !result.repoRoot ||
          !result.tracked ||
          result.isBinary ||
          result.oversized
            ? setGitQuickDiffBaselines.of(null)
            : setGitQuickDiffBaselines.of({
                repoRoot: result.repoRoot,
                headContent: result.headContent,
                indexContent: result.indexContent,
              }),
      });
    } catch (error) {
      if (!mountedRef.current || generation !== generationRef.current) return;
      repoRootRef.current = null;
      staleRef.current = false;
      view.dispatch({ effects: setGitQuickDiffBaselines.of(null) });
      console.warn("[editor] git baseline refresh failed", path, error);
    }
  }, [active, ready, path, cmRef]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!path) return;
    generationRef.current += 1;
    repoRootRef.current = null;
    staleRef.current = true;
    cmRef.current?.view?.dispatch({
      effects: setGitQuickDiffBaselines.of(null),
    });
  }, [path, cmRef]);

  useEffect(() => {
    if (ready) return;
    generationRef.current += 1;
    staleRef.current = true;
    cmRef.current?.view?.dispatch({
      effects: setGitQuickDiffBaselines.of(null),
    });
  }, [ready, cmRef]);

  useEffect(() => {
    if (active) return;
    generationRef.current = nextGitQuickDiffGeneration(
      generationRef.current,
      repoRootRef.current,
    );
    staleRef.current = true;
  }, [active]);

  useEffect(() => {
    if (!active || !ready || !staleRef.current) return;
    const frame = window.requestAnimationFrame(() => void refresh());
    return () => window.cancelAnimationFrame(frame);
  }, [active, ready, refresh]);

  useEffect(
    () =>
      onGitChanged(({ repoRoot }) => {
        const generation = nextGitQuickDiffGeneration(
          generationRef.current,
          repoRootRef.current,
          repoRoot,
        );
        if (generation === generationRef.current) return;
        generationRef.current = generation;
        staleRef.current = true;
        if (active) void refresh();
      }),
    [active, refresh],
  );

  useEffect(() => {
    let timer: number | null = null;
    const onFocus = () => {
      if (!active || !ready) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        const now = Date.now();
        if (now - lastFocusRefreshRef.current < 1500) return;
        lastFocusRefreshRef.current = now;
        staleRef.current = true;
        void refresh();
      }, 400);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [active, ready, refresh]);
}
