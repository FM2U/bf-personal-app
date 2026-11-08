import { describe, expect, it } from "vitest";
import { cleanStageDefaults, cleanWorkSettings, eodCountdown, eodLong, eodShort, minutesLeftWords, parseTime } from "./settings";

describe("Work settings (push D)", () => {
  it("reads and shows the End of day time", () => {
    expect(parseTime("17:30")).toBe("17:30");
    expect(parseTime("9:05")).toBe("09:05");
    expect(parseTime("25:00")).toBeNull();
    expect(parseTime("5:30 pm")).toBeNull();
    expect(eodShort("17:30")).toBe("5:30");
    expect(eodLong("17:30")).toBe("5:30 pm");
    expect(eodLong("12:15")).toBe("12:15 pm");
    expect(eodLong("09:00")).toBe("9:00 am");
    // 2026-11-08: the report goes out at 6:00 pm unless changed.
    expect(eodShort(null)).toBe("6:00");
  });
  it("counts down to the End of day time in the owner's time zone (2026-11-05)", () => {
    const tz = "America/New_York";
    // 4:18 pm in New York on Nov 5 is 21:18 UTC.
    expect(eodCountdown(new Date("2026-11-05T21:18:00Z"), tz, "2026-11-05", "17:30")).toEqual({ kind: "left", minutes: 72 });
    expect(eodCountdown(new Date("2026-11-05T21:18:30Z"), tz, "2026-11-05", "17:30")).toEqual({ kind: "left", minutes: 72 });
    expect(eodCountdown(new Date("2026-11-05T22:29:59Z"), tz, "2026-11-05", "17:30")).toEqual({ kind: "left", minutes: 1 });
    expect(eodCountdown(new Date("2026-11-05T22:30:00Z"), tz, "2026-11-05", "17:30")).toEqual({ kind: "passed" });
    expect(eodCountdown(new Date("2026-11-06T05:01:00Z"), tz, "2026-11-05", "17:30")).toEqual({ kind: "other-day" });
    expect(eodCountdown(new Date("2026-11-05T21:18:00Z"), tz, "2026-11-05", "16:00")).toEqual({ kind: "passed" });
    expect(minutesLeftWords(72)).toBe("1 hr 12 min left");
    expect(minutesLeftWords(45)).toBe("45 min left");
    expect(minutesLeftWords(60)).toBe("1 hr left");
    expect(minutesLeftWords(1)).toBe("1 min left");
  });
  it("checks the four values", () => {
    expect(cleanWorkSettings({ threshold: "5", noReply: "2", outreach: "10", eodTime: "17:30", blockMinutes: "60" })).toEqual({ ok: true, value: { threshold: 5, stalled: 10, noReply: 2, outreach: 10, eodTime: "17:30", blockMinutes: 60, autoSend: true } });
    // 2026-11-08: Stalled after has its own number, more than Follow up after; Send automatically off.
    expect(cleanWorkSettings({ threshold: "5", stalled: "7", noReply: "2", outreach: "10", eodTime: "18:00", blockMinutes: "60", autoSend: false })).toMatchObject({ ok: true, value: { stalled: 7, autoSend: false } });
    expect(cleanWorkSettings({ threshold: "5", stalled: "5", noReply: "2", outreach: "10", eodTime: "18:00", blockMinutes: "60" })).toMatchObject({ ok: false, error: expect.stringMatching(/^Stalled after/) });
    expect(cleanWorkSettings({ threshold: "0", noReply: "2", outreach: "10", eodTime: "17:30", blockMinutes: "60" })).toMatchObject({ ok: false, error: expect.stringMatching(/^Follow up after/) });
    expect(cleanWorkSettings({ threshold: "5", noReply: "2", outreach: "2.5", eodTime: "17:30", blockMinutes: "60" })).toMatchObject({ ok: false, error: expect.stringMatching(/^Network outreach/) });
    expect(cleanWorkSettings({ threshold: "5", noReply: "2", outreach: "10", eodTime: "late", blockMinutes: "60" })).toMatchObject({ ok: false, error: expect.stringMatching(/^Report goes out at/) });
    expect(cleanWorkSettings({ threshold: "5", noReply: "2", outreach: "10", eodTime: "17:30", blockMinutes: "3" })).toMatchObject({ ok: false, error: expect.stringMatching(/^Default block/) });
    // Push E: No reply yet after 1 to 29 days (inside the 30 days replies are read for).
    expect(cleanWorkSettings({ threshold: "5", noReply: "0", outreach: "10", eodTime: "17:30", blockMinutes: "60" })).toMatchObject({ ok: false, error: expect.stringMatching(/^No reply yet/) });
    expect(cleanWorkSettings({ threshold: "5", noReply: "30", outreach: "10", eodTime: "17:30", blockMinutes: "60" })).toMatchObject({ ok: false, error: expect.stringMatching(/^No reply yet/) });
    expect(cleanWorkSettings({ threshold: "5", noReply: "29", outreach: "10", eodTime: "17:30", blockMinutes: "60" })).toMatchObject({ ok: true, value: { noReply: 29 } });
  });
  it("checks the stage defaults", () => {
    const names = { s1: "Interested", s2: "NDA signed" };
    expect(cleanStageDefaults([{ stageId: "s1", title: "  Sign the NDA  ", dueInDays: "1", timeLimit: "" }, { stageId: "s2", title: "", dueInDays: "", timeLimit: "14" }, { stageId: "x", title: "a", dueInDays: 1, timeLimit: 1 }], names)).toEqual({
      ok: true,
      rows: [
        { stageId: "s1", title: "Sign the NDA", dueInDays: 1, timeLimit: null },
        { stageId: "s2", title: "", dueInDays: 2, timeLimit: 14 },
      ],
    });
    expect(cleanStageDefaults([{ stageId: "s1", title: "a", dueInDays: "400", timeLimit: "" }], names)).toEqual({ ok: false, error: "Interested: due in 0 to 365 days." });
    expect(cleanStageDefaults([{ stageId: "s2", title: "a", dueInDays: "1", timeLimit: "0" }], names)).toEqual({ ok: false, error: "NDA signed: a time limit of 1 to 365 days, or blank for none." });
    // The Settings table sends no time limit: the stage's limit is left as it is.
    expect(cleanStageDefaults([{ stageId: "s2", title: "a", dueInDays: "1" }], names)).toEqual({ ok: true, rows: [{ stageId: "s2", title: "a", dueInDays: 1 }] });
  });
});
