import { describe, expect, it } from "vitest";
import { parseSaved } from "./disclosure";

describe("progressive disclosure", () => {
  it("bad saved values are ignored", () => {
    expect(parseSaved("[1,2]")).toBeNull();
    expect(parseSaved("{bad")).toBeNull();
    expect(parseSaved('{"a":true}')).toEqual({ a: true });
  });
});
