import { describe, expect, it } from "vitest";
import {
  githubCompareUrl,
  parseRemoteWebUrl,
} from "@/modules/git-history/lib/remoteWebUrl";

describe("githubCompareUrl", () => {
  it.each([
    "https://github.com/acme/pide.git",
    "git@github.com:acme/pide.git",
  ])("builds a compare URL from %s", (remote) => {
    const info = parseRemoteWebUrl(remote);

    expect(githubCompareUrl(info, "feat/create pr")).toBe(
      "https://github.com/acme/pide/compare/feat%2Fcreate%20pr?expand=1",
    );
  });

  it("rejects non-GitHub remotes", () => {
    const info = parseRemoteWebUrl("git@gitlab.com:acme/pide.git");

    expect(githubCompareUrl(info, "feature")).toBeNull();
  });

  it("rejects an empty branch", () => {
    const info = parseRemoteWebUrl("git@github.com:acme/pide.git");

    expect(githubCompareUrl(info, "")).toBeNull();
  });
});
