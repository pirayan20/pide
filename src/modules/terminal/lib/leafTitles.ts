import { create } from "zustand";

type LeafTitleStore = {
  titles: Record<number, string>;
  set: (leafId: number, title: string) => void;
  clear: (leafId: number) => void;
};

/** Last OSC 0/2 window title per leaf. Only consulted while a coding agent is
 * active in that leaf, so shell-set titles never surface in the UI. */
export const useLeafTitleStore = create<LeafTitleStore>((set) => ({
  titles: {},
  set: (leafId, title) =>
    set((s) => {
      if (s.titles[leafId] === title) return s;
      return { titles: { ...s.titles, [leafId]: title } };
    }),
  clear: (leafId) =>
    set((s) => {
      if (!(leafId in s.titles)) return s;
      const titles = { ...s.titles };
      delete titles[leafId];
      return { titles };
    }),
}));
