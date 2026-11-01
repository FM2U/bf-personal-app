import { describe, expect, it } from "vitest";
import { isCutOff, parseJsonFromText, readAiReply, replyLines, replySnippet } from "./reply";

describe("the AI reply reader (Edit batch B, item 2)", () => {
  it("reads a fenced JSON object", () => {
    expect(readAiReply('Here you go:\n```json\n{"text": "This week: ship the hub"}\n```', "text")).toEqual({ text: "This week: ship the hub" });
    expect(readAiReply('```\n{"items": ["Read the CIM", "Call the broker"]}\n```', "items")).toEqual({ items: ["Read the CIM", "Call the broker"] });
  });

  it("reads a bare JSON object or array", () => {
    expect(readAiReply('{"steps": [{"text": "Call", "reason": "Quiet 6 days"}]}', "items")).toEqual({ steps: [{ text: "Call", reason: "Quiet 6 days" }] });
    expect(readAiReply('["a", "b"]', "items")).toEqual(["a", "b"]);
    expect(parseJsonFromText('Sure. {"a": 1} is it')).toEqual({ a: 1 });
  });

  it("reads a bare JSON string as text, or as items when a list was asked", () => {
    expect(readAiReply('"This week: finish the onboarding flow"', "text")).toEqual({ text: "This week: finish the onboarding flow" });
    expect(readAiReply('"Read the CIM\\nCall the broker"', "items")).toEqual({ items: ["Read the CIM", "Call the broker"] });
  });

  it("reads prose as one text when the feature asked for a line", () => {
    expect(readAiReply("This week: finish the agency hub onboarding flow.", "text")).toEqual({ text: "This week: finish the agency hub onboarding flow." });
    // Several lines stay together as the field's text (an email body).
    const body = "Hi Mark,\n\nQuick follow-up on Dalton.\n\nThanks,\nBram";
    expect(readAiReply(body, "text")).toEqual({ text: body });
  });

  it("reads prose lines as items when the feature asked for a list, dropping bullets and numbers", () => {
    expect(readAiReply("- Read the CIM end to end\n- Ask for the customer list\n\n3. Compare with the last two deals", "items")).toEqual({ items: ["Read the CIM end to end", "Ask for the customer list", "Compare with the last two deals"] });
    expect(replyLines('• "Why are you selling now?"\n* Who are the top customers?')).toEqual(["Why are you selling now?", "Who are the top customers?"]);
    // A lead-in and a closing line around a bulleted list are not items; without bullets every line is one.
    expect(replyLines("Here are a few things to do:\n- Read the CIM\n- Call the broker\nLet me know if you want more.")).toEqual(["Read the CIM", "Call the broker"]);
    expect(replyLines("Read the CIM\nCall the broker")).toEqual(["Read the CIM", "Call the broker"]);
    // Short group headings between bullets stay (the questions reader groups by them).
    expect(replyLines("Ask the seller:\n- Why sell now?\nAsk the broker:\n- Any other bidders?")).toEqual(["Ask the seller:", "Why sell now?", "Ask the broker:", "Any other bidders?"]);
  });

  it("accepts only JSON for the none shape and returns null otherwise", () => {
    expect(readAiReply("I can see a filtration distributor in Macon but no figures.", "none")).toBeNull();
    expect(readAiReply("", "text")).toBeNull();
    expect(readAiReply('{"listing_name": "Industrial Filtration Distributor"}', "none")).toEqual({ listing_name: "Industrial Filtration Distributor" });
  });

  it("falls back to plain text when a brace in the prose is not JSON", () => {
    expect(readAiReply("Use {company} as the name, then call.", "text")).toEqual({ text: "Use {company} as the name, then call." });
  });

  it("treats JSON cut off before it closes as cut off, never as lines (Edit batch B round 2)", () => {
    const steps = '{"steps": [\n{"text": "Email the broker today", "reason": "Quiet 6 days"},\n{"text": "Write the key fin';
    expect(isCutOff(steps)).toBe(true);
    expect(readAiReply(steps, "items")).toBeNull();
    const bullets = '{"bullets": ["**Send first:** the Dalton follow-up, then hol';
    expect(isCutOff(bullets)).toBe(true);
    expect(readAiReply(bullets, "items")).toBeNull();
    // An opening fence with no closing one (the fence was cut off too).
    expect(isCutOff('```json\n{"items": ["Read the CIM", "Call the')).toBe(true);
    expect(readAiReply('```json\n{"items": ["Read the CIM", "Call the', "items")).toBeNull();
    // A stop reason of max_tokens counts as cut off whatever the text.
    expect(isCutOff("- Read the CIM\n- Call the", "max_tokens")).toBe(true);
    expect(isCutOff("- Read the CIM\n- Call the broker", "end_turn")).toBe(false);
  });

  it("still parses full JSON and still reads plain text as lines after the cut-off check", () => {
    const full = '{"steps": [{"text": "Email the broker today", "reason": "Quiet 6 days"}]}';
    expect(isCutOff(full)).toBe(false);
    expect(readAiReply(full, "items")).toEqual({ steps: [{ text: "Email the broker today", reason: "Quiet 6 days" }] });
    expect(isCutOff('```json\n{"items": ["a"]}\n```')).toBe(false);
    expect(isCutOff("- Read the CIM\n- Call the broker")).toBe(false);
    expect(readAiReply("- Read the CIM\n- Call the broker", "items")).toEqual({ items: ["Read the CIM", "Call the broker"] });
  });

  it("gives the first 300 characters of a reply on one line", () => {
    expect(replySnippet("a\n\n  b   c")).toBe("a b c");
    expect(replySnippet("x".repeat(400)).length).toBe(300);
  });
});
