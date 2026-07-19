import { describe, expect, it } from "vitest";
import { pinColorScheme } from "./svgColorScheme";

describe("pinColorScheme", () => {
  const svg = `<style>
    .bg { fill: white }
    @media (prefers-color-scheme: dark) { .bg { fill: black } }
    @media (prefers-color-scheme: light) { .bg { fill: white } }
  </style>`;

  it("forces the dark variant on and the light variant off in dark mode", () => {
    const out = pinColorScheme(svg, "dark");
    // the dark block becomes always-true, the light block always-false
    expect(out).toContain("@media (min-width:0px) { .bg { fill: black }");
    expect(out).toContain("@media (max-width:0px) { .bg { fill: white }");
    expect(out).not.toContain("prefers-color-scheme");
  });

  it("forces the light variant on and the dark variant off in light mode", () => {
    const out = pinColorScheme(svg, "light");
    expect(out).toContain("@media (max-width:0px) { .bg { fill: black }");
    expect(out).toContain("@media (min-width:0px) { .bg { fill: white }");
    expect(out).not.toContain("prefers-color-scheme");
  });

  it("is case-insensitive and tolerates whitespace", () => {
    expect(pinColorScheme("(PREFERS-COLOR-SCHEME :  dark)", "dark")).toBe(
      "(min-width:0px)",
    );
  });

  it("leaves an SVG without color-scheme queries unchanged", () => {
    const plain = "<svg><rect fill='red'/></svg>";
    expect(pinColorScheme(plain, "dark")).toBe(plain);
  });
});
