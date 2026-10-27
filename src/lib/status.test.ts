import { describe, expect, it } from "vitest";
import { dueStatus, dueWord, resultStatus, severityStatus, STATUS_BADGE, STATUS_DOT, STATUS_TEXT, STATUSES, toneStatus } from "@/lib/status";

const TODAY = "2026-10-26";

describe("status colors", () => {
  it("maps due dates: overdue red, today amber, later gray, done green", () => {
    expect(dueStatus("2026-10-25", TODAY)).toBe("missed");
    expect(dueStatus("2026-10-26", TODAY)).toBe("soon");
    expect(dueStatus("2026-10-27", TODAY)).toBe("neutral");
    expect(dueStatus(null, TODAY)).toBe("neutral");
    expect(dueStatus("2026-10-20", TODAY, { done: true })).toBe("met");
    expect(dueStatus("2026-10-26T15:00:00Z", TODAY)).toBe("soon");
  });
  it("counts the next days as due soon only when asked", () => {
    expect(dueStatus("2026-10-28", TODAY, { soonDays: 2 })).toBe("soon");
    expect(dueStatus("2026-10-29", TODAY, { soonDays: 2 })).toBe("neutral");
    expect(dueStatus("2026-11-01", "2026-10-31", { soonDays: 1 })).toBe("soon");
  });
  it("gives the status word", () => {
    expect(dueWord("2026-10-01", TODAY)).toBe("Overdue");
    expect(dueWord(TODAY, TODAY)).toBe("Due today");
    expect(dueWord("2026-12-01", TODAY)).toBeNull();
    expect(dueWord(undefined, TODAY)).toBeNull();
  });
  it("maps severity, tone, and results", () => {
    expect(severityStatus("critical")).toBe("missed");
    expect(severityStatus("warning")).toBe("soon");
    expect(severityStatus("info")).toBe("neutral");
    expect(toneStatus("good")).toBe("met");
    expect(toneStatus("warn")).toBe("soon");
    expect(toneStatus("bad")).toBe("missed");
    expect(toneStatus(undefined)).toBe("neutral");
    expect(resultStatus("met")).toBe("met");
    expect(resultStatus("missed")).toBe("missed");
    expect(resultStatus("open")).toBe("soon");
    expect(resultStatus("off")).toBe("neutral");
  });
  it("uses only the four status tokens", () => {
    for (const s of STATUSES) {
      for (const cls of [STATUS_TEXT[s], STATUS_BADGE[s], STATUS_DOT[s]]) {
        expect(cls).toContain(`status-${s}`);
        expect(cls).not.toMatch(/(emerald|amber|red|green|sky|blue)-\d/);
      }
    }
  });
});

describe("palette and progress helpers", () => {
  it("countStatus: met at the requirement, open periods are due soon, closed short periods are missed", async () => {
    const { countStatus } = await import("./status");
    expect(countStatus(3, 3, true)).toBe("met");
    expect(countStatus(4, 3, false)).toBe("met");
    expect(countStatus(2, 3, true)).toBe("soon");
    expect(countStatus(2, 3, false)).toBe("missed");
    expect(countStatus(0, 3, false, false)).toBe("neutral");
    expect(countStatus(0, 0, false)).toBe("missed");
  });
  it("progressPct is held between 0 and 100", async () => {
    const { progressPct } = await import("./status");
    expect(progressPct(2, 3)).toBe(67);
    expect(progressPct(5, 3)).toBe(100);
    expect(progressPct(1, 0)).toBe(0);
    expect(progressPct(-1, 3)).toBe(0);
  });
  it("chart series start cobalt then gold and wrap; every chart color equals a token in globals.css", async () => {
    const { seriesColor, CHART_SERIES, CHART_BASELINE, CHART_STATUS, ACCENT_HEX, MODULE_ACCENT, ACCENT_TEXT } = await import("./status");
    const fs = await import("node:fs");
    const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8").toLowerCase();
    expect(seriesColor(0)).toBe(ACCENT_HEX.cobalt);
    expect(seriesColor(1)).toBe(ACCENT_HEX.gold);
    expect(seriesColor(5)).toBe(seriesColor(0));
    expect(seriesColor(-1)).toBe(CHART_SERIES[4]);
    expect(css).toContain(`--primary: ${ACCENT_HEX.cobalt};`);
    expect(css).toContain(`--gold: ${ACCENT_HEX.gold};`);
    expect(css).toContain(`--violet: ${ACCENT_HEX.violet};`);
    expect(css).toContain(`--cyan: ${ACCENT_HEX.cyan};`);
    expect(css).toContain(`--coral: ${ACCENT_HEX.coral};`);
    expect(css).toContain(`--status-neutral-solid: ${CHART_BASELINE};`);
    expect(css).toContain(`--status-met-solid: ${CHART_STATUS.positive};`);
    expect(css).toContain(`--status-missed-solid: ${CHART_STATUS.negative};`);
    expect(new Set(CHART_SERIES).size).toBe(CHART_SERIES.length);
    for (const a of Object.values(MODULE_ACCENT)) expect(ACCENT_TEXT[a]).toBeTruthy();
    // Green, red, and amber carry status meaning, so no accent equals a status color.
    for (const c of Object.values(ACCENT_HEX)) expect([CHART_STATUS.positive, CHART_STATUS.negative, "#f59e0b"]).not.toContain(c);
  });
});
