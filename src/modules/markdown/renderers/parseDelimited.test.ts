import { describe, expect, it } from "vitest";

import { parseDelimited } from "./parseDelimited";

describe("parseDelimited", () => {
  it("splits plain comma-delimited rows", () => {
    expect(parseDelimited("a,b,c\n1,2,3", ",")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("splits tab-delimited rows", () => {
    expect(parseDelimited("a\tb\n1\t2", "\t")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a delimiter inside a quoted field", () => {
    expect(parseDelimited('a,"b,c",d', ",")).toEqual([["a", "b,c", "d"]]);
  });

  it("keeps a newline inside a quoted field", () => {
    expect(parseDelimited('a,"b\nc",d', ",")).toEqual([["a", "b\nc", "d"]]);
  });

  it("unescapes doubled quotes inside a quoted field", () => {
    expect(parseDelimited('a,"say ""hi""",b', ",")).toEqual([
      ["a", 'say "hi"', "b"],
    ]);
  });

  it("handles CRLF line endings without a phantom trailing row", () => {
    expect(parseDelimited("a,b\r\nc,d\r\n", ",")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("returns ragged rows as-is", () => {
    expect(parseDelimited("a,b,c\n1,2", ",")).toEqual([
      ["a", "b", "c"],
      ["1", "2"],
    ]);
  });

  it("returns an empty array for an empty file", () => {
    expect(parseDelimited("", ",")).toEqual([]);
  });
});
