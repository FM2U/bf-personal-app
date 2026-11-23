import { describe, expect, it } from "vitest";
import { cleanSource, dayTotal, parseReviewed, reviewedRows, reviewedWords, sourceChoices, toEntry, type ReviewedEntry } from "@/lib/accountability/listings-reviewed";

const e = (id: string, day: string, reviewed: number, source: string | null, createdAt = `${day}T14:05:00Z`): ReviewedEntry => ({ id, day, reviewed, source, createdAt });

describe("listings reviewed", () => {
  it("reads the typed number: whole numbers 0 to 2,000, with commas allowed", () => {
    expect(parseReviewed("15")).toEqual({ ok: true, value: 15 });
    expect(parseReviewed("0")).toEqual({ ok: true, value: 0 });
    expect(parseReviewed("1,200")).toEqual({ ok: true, value: 1200 });
    expect(parseReviewed("")).toMatchObject({ ok: false });
    expect(parseReviewed("2.5")).toMatchObject({ ok: false });
    expect(parseReviewed("-3")).toMatchObject({ ok: false });
    expect(parseReviewed("2001")).toMatchObject({ ok: false });
  });
  it("cleans the source to one line of at most 80 characters", () => {
    expect(cleanSource("  Biz   BuySell ")).toBe("Biz BuySell");
    expect(cleanSource("   ")).toBeNull();
    expect(cleanSource("x".repeat(100))).toHaveLength(80);
  });
  it("adds up a day; an entry of 0 still counts as entered", () => {
    const list = [e("a", "2026-11-23", 10, "BizBuySell"), e("b", "2026-11-23", 5, "Axial"), e("c", "2026-11-23", 4, "BizBuySell"), e("d", "2026-11-22", 9, "Axial")];
    expect(dayTotal(list, "2026-11-23")).toEqual({ total: 19, entered: true, sources: ["BizBuySell", "Axial"] });
    expect(dayTotal([e("z", "2026-11-23", 0, null)], "2026-11-23")).toEqual({ total: 0, entered: true, sources: [] });
    expect(dayTotal(list, "2026-11-21")).toEqual({ total: 0, entered: false, sources: [] });
  });
  it("offers the owner's sources first, most used first, then the defaults not already there", () => {
    const list = [e("a", "2026-11-20", 3, "Broker newsletter"), e("b", "2026-11-21", 3, "bizbuysell"), e("c", "2026-11-22", 3, "Broker newsletter")];
    const s = sourceChoices(list);
    expect(s.slice(0, 2)).toEqual(["Broker newsletter", "bizbuysell"]);
    expect(s).not.toContain("BizBuySell");
    expect(s).toContain("Axial");
    expect(s.length).toBeLessThanOrEqual(8);
  });
  it("words and Today's activity rows", () => {
    expect(reviewedWords(1)).toBe("Reviewed 1 listing");
    expect(reviewedWords(15)).toBe("Reviewed 15 listings");
    expect(reviewedWords(0)).toBe("No listings reviewed");
    const rows = reviewedRows([e("a", "2026-11-23", 15, "BizBuySell"), e("b", "2026-11-22", 3, null)], "2026-11-23", () => "9:05");
    expect(rows).toEqual([{ id: "reviewed:a", kind: "reviewed", text: "Reviewed 15 listings", record: "BizBuySell", time: "9:05", href: null }]);
  });
  it("reads a table row", () => {
    expect(toEntry({ id: "x", day: "2026-11-23", reviewed: "12", source: " Axial ", created_at: "t" })).toEqual({ id: "x", day: "2026-11-23", reviewed: 12, source: "Axial", createdAt: "t" });
    expect(toEntry({ id: "x", day: null, reviewed: 1 })).toBeNull();
  });
});
