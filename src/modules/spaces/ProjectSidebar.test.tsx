import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SpaceProjectTree } from "./ProjectSidebar";
import type { ProjectMeta, SpaceMeta } from "./lib/store";

const space: SpaceMeta = {
  id: "s1",
  name: "Personal",
  env: { kind: "local" },
  createdAt: 0,
  updatedAt: 0,
};

const project = (id: string, name: string): ProjectMeta => ({
  id,
  spaceId: "s1",
  name,
  root: `/work/${name.toLowerCase()}`,
  createdAt: 0,
  updatedAt: 0,
});

const noop = () => {};

it("renders projects and agent status while suppressing unavailable-project activity", () => {
  const html = renderToStaticMarkup(
    <SpaceProjectTree
      spaces={[space]}
      projects={[project("p1", "Pide"), project("p2", "Abacus")]}
      activeSpaceId="s1"
      activeProjectId="p1"
      availability={{ p1: "available", p2: "unavailable" }}
      projectBranches={{ p1: "feat/project-hierarchy" }}
      projectTabCounts={{ p1: 1, p2: 0 }}
      projectActivity={{
        p1: { working: 1, waiting: 0 },
        p2: { working: 0, waiting: 1 },
      }}
      expanded={new Set(["s1"])}
      actions={{
        toggleSpace: noop,
        selectSpace: noop,
        selectProject: noop,
        renameSpace: noop,
        renameProject: noop,
        addProject: noop,
        locateProject: noop,
        removeProject: noop,
        deleteSpace: noop,
        dragSpace: noop,
        dropSpace: noop,
        dragProject: noop,
        dropProject: noop,
      }}
    />,
  );

  const spaceContainer = html.match(
    /<div[^>]*aria-label="Personal"[^>]*>/,
  )?.[0];
  expect(spaceContainer).toBeDefined();
  expect(spaceContainer).not.toContain('draggable="true"');
  expect(html.match(/draggable="true"/g)).toHaveLength(1);
  expect(html).toContain('draggable="false"');
  expect(html).toContain("Coding agents: 1 working");
  expect(html).not.toContain("Coding agents: 1 waiting");
  expect(html).toContain("Folder unavailable");
  expect(html).not.toContain("bg-accent");
  expect(html).toContain("bg-foreground/[0.07]");
  expect(html).toContain("Pide");
  expect(html).toContain("Abacus");
  expect(html).toContain("feat/project-hierarchy");
  expect(html).not.toContain(">abacus<");
  expect(html).toContain('data-project-empty="true"');
  expect(html).not.toContain("Terminal tab title");
});
