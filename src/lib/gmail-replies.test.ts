import { describe, expect, it } from "vitest";
import { addressOf, nameOf, newReplies, replyTaskText, replyText, shouldCheckReplies, type GmailThreadMessage } from "./gmail-replies";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const msg = (id: string, from: string, at: string, text: string, labels: string[] = ["INBOX"]): GmailThreadMessage => ({
  id,
  threadId: "t1",
  internalDate: String(Date.parse(at)),
  labelIds: labels,
  snippet: text.slice(0, 40),
  payload: { mimeType: "multipart/alternative", headers: [{ name: "From", value: from }, { name: "Subject", value: "Re: Daily report" }], parts: [{ mimeType: "text/plain", body: { data: b64(text) } }, { mimeType: "text/html", body: { data: b64(`<p>${text}</p>`) } }] },
});

const sentAt = "2026-11-05T22:31:00Z";
const thread = [
  msg("m1", "Bram Frankel <owner@example.com>", sentAt, "Hello Jake, here is my report.", ["SENT"]),
  msg("m2", "Jake Morgan <jake.morgan@example.com>", "2026-11-06T02:58:00Z", "Good screening day. What happened with Summit?\n\nOn Thu, Nov 5, 2026 at 5:31 PM Bram Frankel <owner@example.com> wrote:\n> Hello Jake,\n> here is my report."),
  msg("m3", "owner@example.com", "2026-11-06T03:10:00Z", "Thanks, will do."),
  msg("m4", "Sarah Klein <sarah@example.com>", "2026-11-05T20:00:00Z", "An older message before the report"),
];

describe("reply matching", () => {
  it("keeps only messages by someone else, newer than the sent item", () => {
    const r = newReplies(thread, { ownerEmail: "Owner@Example.com", sentAt, known: new Set() });
    expect(r.map((x) => x.id)).toEqual(["m2"]);
    expect(r[0].fromEmail).toBe("jake.morgan@example.com");
    expect(r[0].text).toBe("Good screening day. What happened with Summit?");
  });
  it("stores each reply once: a known Gmail id is skipped", () => {
    expect(newReplies(thread, { ownerEmail: "owner@example.com", sentAt, known: new Set(["m2"]) })).toEqual([]);
  });
  it("leaves out Sent and Drafts even when the address is not known", () => {
    const r = newReplies([msg("d1", "Someone <x@example.com>", "2026-11-06T01:00:00Z", "draft", ["DRAFT"])], { ownerEmail: null, sentAt, known: new Set() });
    expect(r).toEqual([]);
  });
  it("reads the HTML part when there is no plain part", () => {
    const m: GmailThreadMessage = { id: "h1", threadId: "t1", internalDate: String(Date.parse("2026-11-06T01:00:00Z")), labelIds: ["INBOX"], payload: { mimeType: "text/html", headers: [{ name: "From", value: "Jake <jake@example.com>" }], body: { data: b64("<div>Nice week.<br>Keep going.</div><blockquote>old</blockquote>") } } };
    expect(newReplies([m], { ownerEmail: "owner@example.com", sentAt, known: new Set() })[0].text).toBe("Nice week.\nKeep going.");
  });
});

describe("reply text", () => {
  it("cuts the quoted email", () => {
    expect(replyText("Yes.\n\nOn Fri, Oct 30, 2026 at 5:34 PM Bram <b@x.com> wrote:\n> hi")).toBe("Yes.");
    expect(replyText("Sure\n-----Original Message-----\nFrom: Bram")).toBe("Sure");
    expect(replyText("Ok\nFrom: Bram <b@x.com>\nSent: Friday\n")).toBe("Ok");
    expect(replyText("Line one\n> quoted")).toBe("Line one");
  });
  it("reads the From header", () => {
    expect(addressOf("Jake Morgan <Jake@Example.com>")).toBe("jake@example.com");
    expect(addressOf("jake@example.com")).toBe("jake@example.com");
    expect(nameOf('"Jake Morgan" <jake@example.com>')).toBe("Jake Morgan");
    expect(nameOf("jake@example.com")).toBe("jake@example.com");
  });
  it("makes a task line", () => {
    expect(replyTaskText("Jake", "Good screening day.\nWhat happened with Summit?")).toBe("Answer Jake's reply: Good screening day. What happened with Summit?");
    expect(replyTaskText("Jake", "word ".repeat(60)).length).toBeLessThanOrEqual(140);
  });
});

describe("the check throttle", () => {
  const now = new Date("2026-11-06T15:00:00Z");
  it("checks when never checked or after five minutes", () => {
    expect(shouldCheckReplies(null, now)).toBe(true);
    expect(shouldCheckReplies("2026-11-06T14:56:00Z", now)).toBe(false);
    expect(shouldCheckReplies("2026-11-06T14:55:00Z", now)).toBe(true);
  });
});
