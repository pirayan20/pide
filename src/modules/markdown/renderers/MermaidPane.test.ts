import { describe, expect, it } from "vitest";

import { mermaidThemeFor } from "./MermaidPane";

describe("mermaidThemeFor", () => {
  it("maps the app's dark mode to mermaid's dark theme", () => {
    expect(mermaidThemeFor("dark")).toBe("dark");
  });

  it("maps the app's light mode to mermaid's default theme", () => {
    expect(mermaidThemeFor("light")).toBe("default");
  });
});
