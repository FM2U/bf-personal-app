import { describe, expect, it } from "vitest";
import { reportVoice } from "@/lib/work/reply-wait";

describe("reportVoice", () => {
  it("turns Bram's 'your email' into 'my email' for the partner's report", () => {
    expect(reportVoice('Dana Whitfield\'s reply to your email "Pinecrest LOI"')).toBe('Dana Whitfield\'s reply to my email "Pinecrest LOI"');
    expect(reportVoice('Reply to your email "Oakline CIM"')).toBe('Reply to my email "Oakline CIM"');
    expect(reportVoice("The CIM")).toBe("The CIM");
  });
});
