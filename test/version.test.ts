import { describe, it, expect } from "vitest";
import { parseVersion, isNewer } from "../src/update/version";

describe("update version compare", () => {
  it("parses a leading v and dotted parts", () => {
    expect(parseVersion("v0.2.10")).toEqual([0, 2, 10]);
    expect(parseVersion("0.3.0")).toEqual([0, 3, 0]);
  });
  it("compares numerically, not as strings (0.2.10 > 0.2.9)", () => {
    expect(isNewer("0.2.10", "0.2.9")).toBe(true);
    expect(isNewer("0.2.9", "0.2.10")).toBe(false);
  });
  it("is false when equal or older", () => {
    expect(isNewer("0.2.10", "0.2.10")).toBe(false);
    expect(isNewer("0.2.2", "0.2.10")).toBe(false);
  });
  it("handles a leading v on either side and differing lengths", () => {
    expect(isNewer("v0.3.0", "0.2.10")).toBe(true);
    expect(isNewer("1.0", "0.9.9")).toBe(true);
    expect(isNewer("0.2", "0.2.1")).toBe(false);
  });
});
