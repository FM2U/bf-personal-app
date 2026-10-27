import { describe, expect, it } from "vitest";
import { inputsSummary, parseSaved, resolveOpen, setAll } from "./disclosure";

describe("progressive disclosure", () => {
  it("the viewer's saved choice wins over the default; unknown sections are ignored", () => {
    expect(resolveOpen({ Runway: true, Debt: false }, { Debt: true, Gone: false })).toEqual({ Runway: true, Debt: true });
    expect(resolveOpen({ Runway: true }, null)).toEqual({ Runway: true });
  });
  it("Expand all and Collapse all", () => {
    expect(setAll(["a", "b"], false)).toEqual({ a: false, b: false });
  });
  it("bad saved values are ignored", () => {
    expect(parseSaved("[1,2]")).toBeNull();
    expect(parseSaved("{bad")).toBeNull();
    expect(parseSaved('{"a":true}')).toEqual({ a: true });
  });
  it("a collapsed Inputs card shows up to 3 values on one line", () => {
    const text = inputsSummary([
      { label: "Runway target", unit: "months", value_number: 12 },
      { label: "Months of history used for averages", unit: "months", value_number: 3 },
      { label: "Subtract average income in runway (1 = yes, 0 = no)", unit: "boolean", value_number: 1 },
      { label: "Count Cyan Arc LLC cash in runway", unit: "boolean", value_number: 0 },
    ]);
    expect(text).toBe("Runway target: 12 months, Months of history used for averages: 3 months, Subtract average income in runway: yes, and 1 more");
    expect(inputsSummary([{ label: "Monthly spending target", unit: "usd", value_number: null }])).toBe("Monthly spending target: not set");
  });
});
