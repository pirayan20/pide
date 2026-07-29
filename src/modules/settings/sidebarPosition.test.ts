import { sidebarLayoutOrder } from "@/modules/sidebar/types";
import {
  coerceSidebarPosition,
  DEFAULT_PREFERENCES,
} from "@/modules/settings/store";
import { describe, expect, it } from "vitest";

describe("sidebar position", () => {
  it("defaults missing or invalid values to the left", () => {
    expect(DEFAULT_PREFERENCES.sidebarPosition).toBe("left");
    expect(coerceSidebarPosition(undefined)).toBe("left");
    expect(coerceSidebarPosition("invalid")).toBe("left");
  });

  it("places the whole sidebar after the workspace on the right", () => {
    expect(sidebarLayoutOrder("left")).toEqual([
      "sidebar",
      "handle",
      "workspace",
    ]);
    expect(sidebarLayoutOrder("right")).toEqual([
      "workspace",
      "handle",
      "sidebar",
    ]);
  });
});
