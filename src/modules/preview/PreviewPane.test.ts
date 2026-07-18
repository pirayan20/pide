import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Source-level regression test for the preview iframe's security attributes.
 * Rendering this component for real requires jsdom + a working
 * useImperativeHandle stub; for a focused security check we just verify the
 * static JSX still carries the sandbox/referrerPolicy attributes — if a
 * future change silently removes them, this test fails.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "PreviewPane.tsx"), "utf8");
const iframeMatch = src.match(/<iframe[\s\S]*?\/>/);
// Strip JSX comments (`// …` inside `{…}` and `{/* … */}` blocks) so the
// assertions only see actual attribute syntax — the source explains in a
// comment why `allow-top-navigation` is intentionally omitted, which we
// don't want to match.
const iframeJsx = (iframeMatch?.[0] ?? "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

// The sandbox is a conditional expression: asset-URL previews (local files
// served through convertFileSrc) drop `allow-same-origin` so their JS cannot
// read arbitrary files via the ["**"]-scoped asset protocol; everything else
// keeps it so dev servers work. Both branches are string literals containing
// `allow-scripts`.
const sandboxBranches = [
  ...iframeJsx.matchAll(/"([^"]*allow-scripts[^"]*)"/g),
].map((m) => m[1]);

describe("PreviewPane iframe sandbox", () => {
  it("declares an iframe in the source", () => {
    expect(iframeJsx).not.toBe("");
  });

  it("has both sandbox branches (asset + non-asset)", () => {
    expect(sandboxBranches).toHaveLength(2);
  });

  it("grants allow-scripts in every branch", () => {
    // Strip this and dev servers / previews stop working.
    for (const s of sandboxBranches) expect(s).toContain("allow-scripts");
  });

  it("keeps allow-same-origin only for non-asset URLs", () => {
    // Exactly one branch (the dev/http preview) may grant same-origin; the
    // asset-URL branch must NOT, or local HTML could exfiltrate disk files.
    const withSameOrigin = sandboxBranches.filter((s) =>
      s.includes("allow-same-origin"),
    );
    expect(withSameOrigin).toHaveLength(1);
  });

  it("keys the sandbox choice on an asset URL", () => {
    expect(iframeJsx).toMatch(/asset:|asset\.localhost/);
  });

  it("does NOT include allow-top-navigation* tokens", () => {
    // The whole point of sandboxing here: forbid the iframe from navigating
    // the parent Tauri webview to an attacker origin (which would expose
    // window.__TAURI__). Top-nav permissions must never be added.
    expect(iframeJsx).not.toMatch(/allow-top-navigation/);
  });

  it("does NOT include allow-popups-without-allow-popups-to-escape-sandbox combo", () => {
    // If popups are allowed, they MUST escape the sandbox cleanly — otherwise
    // a popup window inherits sandbox flags and we get hard-to-debug behavior.
    for (const s of sandboxBranches) {
      if (/allow-popups\b/.test(s)) {
        expect(s).toContain("allow-popups-to-escape-sandbox");
      }
    }
  });

  it("sets referrerPolicy to no-referrer", () => {
    expect(iframeJsx).toMatch(/referrerPolicy="no-referrer"/);
  });
});
