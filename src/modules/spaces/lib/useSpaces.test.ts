import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSpaces } from "./useSpaces";

vi.mock("./store", () => ({
  deleteProjectData: vi.fn(),
  newProjectId: () => "generated-project",
  newSpaceId: () => "generated-space",
  saveActiveProjects: vi.fn(),
  saveActiveSpaceId: vi.fn(),
  saveProjectsList: vi.fn(),
  saveSpacesList: vi.fn(),
}));

beforeEach(() => {
  useSpaces.setState({
    spaces: [],
    projects: [],
    activeSpaceId: null,
    activeProjectBySpace: {},
    availability: {},
    initialActiveIndex: {},
    hydrated: false,
  });
});

describe("Project hierarchy actions", () => {
  it("creates an empty Space and an owned Project", () => {
    const space = useSpaces
      .getState()
      .createSpace({ id: "s1", name: "Space", env: { kind: "local" } });
    const project = useSpaces.getState().createProject({
      id: "p1",
      spaceId: space.id,
      name: "Project",
      root: "/repo",
    });

    expect(project.spaceId).toBe("s1");
    expect(useSpaces.getState().activeProjectBySpace.s1).toBe("p1");
  });

  it("rejects environment changes while a Space owns Projects", () => {
    useSpaces.getState().createSpace({
      id: "s1",
      name: "Space",
      env: { kind: "local" },
    });
    useSpaces.getState().createProject({
      id: "p1",
      spaceId: "s1",
      name: "Project",
      root: "/repo",
    });

    expect(
      useSpaces
        .getState()
        .setEnv("s1", { kind: "wsl", distro: "Ubuntu" }),
    ).toBe(false);
    expect(useSpaces.getState().spaces[0].env).toEqual({ kind: "local" });
  });

  it("selects the nearest sibling when removing a Project", () => {
    useSpaces.getState().createSpace({
      id: "s1",
      name: "Space",
      env: { kind: "local" },
    });
    for (const id of ["p1", "p2", "p3"]) {
      useSpaces.getState().createProject({
        id,
        spaceId: "s1",
        name: id,
        root: `/${id}`,
      });
    }
    useSpaces.getState().setActiveProject("s1", "p2");

    expect(useSpaces.getState().removeProjectMetadata("p2")).toBe("p3");
    expect(useSpaces.getState().activeProjectBySpace.s1).toBe("p3");
  });

  it("permits removing the final Space", () => {
    useSpaces.getState().createSpace({
      id: "s1",
      name: "Space",
      env: { kind: "local" },
    });
    useSpaces.getState().setActiveSpace("s1");

    expect(useSpaces.getState().removeSpaceMetadata("s1")).toBeNull();
    expect(useSpaces.getState().activeSpaceId).toBeNull();
  });
});
