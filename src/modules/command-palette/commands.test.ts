import { describe, expect, it } from "vitest";
import type { CommandPaletteActionContext } from "./commands";
import { createCommandItems } from "./commands";

const noop = () => {};

function context(
  overrides: Partial<CommandPaletteActionContext> = {},
): CommandPaletteActionContext {
  return {
    tabs: [],
    activeId: null,
    searchTarget: null,
    explorerRoot: null,
    pythonInterpreterLabel: null,
    openNewTab: noop,
    openNewBlock: noop,
    openNewPrivate: noop,
    openNewEditor: noop,
    openNewPreview: noop,
    openGitGraph: noop,
    toggleSourceControl: noop,
    closeActiveTabOrPane: noop,
    splitPaneRight: noop,
    splitPaneDown: noop,
    focusSearch: noop,
    focusExplorerSearch: noop,
    toggleSidebar: noop,
    openSettings: noop,
    openKeyboardShortcuts: noop,
    spaces: [],
    activeSpaceId: null,
    projects: [],
    activeProjectId: null,
    openSpacesOverview: noop,
    newSpace: noop,
    switchSpace: noop,
    switchProject: noop,
    ...overrides,
  };
}

describe("createCommandItems", () => {
  it("disables Project-scoped commands without a selected Project", () => {
    const items = createCommandItems(context());

    expect(items.find((item) => item.id === "tab.new")?.disabledReason).toBe(
      "No project selected",
    );
    expect(
      items.find((item) => item.id === "tab.newEditor")?.disabledReason,
    ).toBe("No project selected");
    expect(items.find((item) => item.id === "git.graph")?.disabledReason).toBe(
      "No project selected",
    );
    expect(
      items.find((item) => item.id === "search.content")?.disabledReason,
    ).toBe("No project selected");
  });

  it("keeps Close tab enabled for a Project's final tab", () => {
    const tab = {
      id: 1,
      kind: "terminal" as const,
      projectId: "p1",
      title: "shell",
      paneTree: { kind: "leaf" as const, id: 2 },
      activeLeafId: 2,
    };
    const items = createCommandItems(
      context({
        tabs: [tab],
        activeId: tab.id,
        explorerRoot: "/repo",
        activeProjectId: "p1",
      }),
    );

    expect(
      items.find((item) => item.id === "tab.close")?.disabledReason,
    ).toBeUndefined();
  });

  it("adds Project switch commands", () => {
    const items = createCommandItems(
      context({
        projects: [{ id: "p1", name: "Pide" }],
        activeProjectId: "p1",
      }),
    );

    expect(items.find((item) => item.id === "projects.switch.p1")).toMatchObject(
      {
        title: "Switch to Pide",
        disabledReason: "Current project",
      },
    );
  });

  it("shows the current Python interpreter on the select command", () => {
    const items = createCommandItems(context({ pythonInterpreterLabel: ".venv" }));
    const item = items.find((i) => i.id === "python.selectInterpreter");
    expect(item?.title).toBe("Python: Select Interpreter");
    expect(item?.trailing).toBe(".venv");
  });
});
