import { describe, expect, it } from "vitest";
import { cleanStageDefaults, cleanWorkSettings, eodLong, eodShort, parseTime } from "./settings";

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
    expect(eodShort(null)).toBe("5:30");
  });
  it("checks the four values", () => {
    expect(cleanWorkSettings({ threshold: "5", outreach: "10", eodTime: "17:30", blockMinutes: "60" })).toEqual({ ok: true, value: { threshold: 5, outreach: 10, eodTime: "17:30", blockMinutes: 60 } });
    expect(cleanWorkSettings({ threshold: "0", outreach: "10", eodTime: "17:30", blockMinutes: "60" })).toMatchObject({ ok: false, error: expect.stringMatching(/^Waiting/) });
    expect(cleanWorkSettings({ threshold: "5", outreach: "2.5", eodTime: "17:30", blockMinutes: "60" })).toMatchObject({ ok: false, error: expect.stringMatching(/^Network outreach/) });
    expect(cleanWorkSettings({ threshold: "5", outreach: "10", eodTime: "late", blockMinutes: "60" })).toMatchObject({ ok: false, error: expect.stringMatching(/^End of day/) });
    expect(cleanWorkSettings({ threshold: "5", outreach: "10", eodTime: "17:30", blockMinutes: "3" })).toMatchObject({ ok: false, error: expect.stringMatching(/^Default block/) });
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
