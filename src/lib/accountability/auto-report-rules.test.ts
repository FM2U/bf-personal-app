import { describe, expect, it } from "vitest";
import { reportStep } from "./auto-report-rules";

const at = (h: number, m = 0) => h * 60 + m;
const SIX = at(18);

describe("the report job's steps (2026-11-08)", () => {
  it("reminds at 4:00 and 5:30, then sends at 6:00, each once", () => {
    expect(reportStep({ nowMin: at(15, 55), sendMin: SIX, auto: {}, autoSend: true })).toBe("none");
    expect(reportStep({ nowMin: at(16), sendMin: SIX, auto: {}, autoSend: true })).toBe("remind1");
    expect(reportStep({ nowMin: at(16, 5), sendMin: SIX, auto: { reminded1: "x" }, autoSend: true })).toBe("none");
    expect(reportStep({ nowMin: at(17, 30), sendMin: SIX, auto: { reminded1: "x" }, autoSend: true })).toBe("remind2");
    expect(reportStep({ nowMin: at(17, 35), sendMin: SIX, auto: { reminded1: "x", reminded2: "x" }, autoSend: true })).toBe("none");
    expect(reportStep({ nowMin: at(18), sendMin: SIX, auto: { reminded1: "x", reminded2: "x" }, autoSend: true })).toBe("send");
    expect(reportStep({ nowMin: at(18, 5), sendMin: SIX, auto: { sentAt: "x" }, autoSend: true })).toBe("none");
  });
  it("a missed first reminder is skipped once the second is due; a failed send is tried until 9:00 pm", () => {
    expect(reportStep({ nowMin: at(17, 40), sendMin: SIX, auto: {}, autoSend: true })).toBe("remind2");
    expect(reportStep({ nowMin: at(20, 55), sendMin: SIX, auto: { failure: "x" } as never, autoSend: true })).toBe("send");
    expect(reportStep({ nowMin: at(21), sendMin: SIX, auto: {}, autoSend: true })).toBe("none");
  });
  it("Send automatically off: both reminders, never the send", () => {
    expect(reportStep({ nowMin: at(16), sendMin: SIX, auto: {}, autoSend: false })).toBe("remind1");
    expect(reportStep({ nowMin: at(18), sendMin: SIX, auto: {}, autoSend: false })).toBe("none");
  });
});
