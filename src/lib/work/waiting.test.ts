import { describe, expect, it } from "vitest";
import { firstReplyAfter, noReplyRows, parseReplyWait, personFollowUpDraft, personWaits, repliedLabel, replySubject, replyWaitName, replyWaitText, whoBesides, waitGroups, waitItem, waitLines, waitRepliedAt, waitSummary, waitsText, waitTarget, type ItemInfo, type MailRow } from "./waiting";

const today = "2026-11-05";
const local = (ts: string) => ts.slice(0, 10);
const mail = (id: string, thread: string, day: string, more: Partial<MailRow> = {}): MailRow => ({ id, occurredAt: `${day}T14:00:00Z`, direction: "outgoing", threadId: thread, subject: `Subject ${id}`, contactId: "c-mark", organizationId: null, itemId: null, reportId: null, dismissed: false, ...more });
const items: Record<string, ItemInfo> = {
  summit: { name: "Summit Logistics Group", kind: "acquisition", status: "open", isDeal: true },
  passed: { name: "Lakeside Car Wash", kind: "acquisition", status: "lost", isDeal: false },
  job: { name: "Lumen Industrial Holdings", kind: "other", status: "open", isDeal: false },
};
const base = { reportThreads: new Set<string>(), waitedThreads: new Set<string>(), today, afterDays: 2, localDate: local, contacts: { "c-mark": "Mark Reed", "c-rita": "Rita Caldwell" }, items, organizations: { "o-ga": "GA Home Care Association" } };

describe("No reply yet (push E)", () => {
  it("lists an email after N days and not before, with who it went to and the record", () => {
    const rows = noReplyRows({ ...base, mail: [mail("a", "t1", "2026-11-03", { itemId: "summit" }), mail("b", "t2", "2026-11-04")] });
    expect(rows.map((r) => r.commId)).toEqual(["a"]);
    expect(rows[0]).toMatchObject({ sentOn: "2026-11-03", days: 2, to: "Mark Reed", recordName: "Summit Logistics Group", target: "deal", href: "/work/deals/summit" });
    // The setting moves the line.
    expect(noReplyRows({ ...base, afterDays: 1, mail: [mail("a", "t1", "2026-11-03"), mail("b", "t2", "2026-11-04")] }).map((r) => r.commId)).toEqual(["a", "b"]);
  });

  it("drops a thread once a reply is stored after the newest email sent in it", () => {
    const sent = mail("a", "t1", "2026-11-01");
    expect(noReplyRows({ ...base, mail: [sent, mail("r", "t1", "2026-11-02", { direction: "incoming" })] })).toEqual([]);
    // A reply before a newer email in the same thread does not count for the newer one.
    const rows = noReplyRows({ ...base, mail: [sent, mail("r", "t1", "2026-11-02", { direction: "incoming" }), mail("b", "t1", "2026-11-03")] });
    expect(rows.map((r) => r.commId)).toEqual(["b"]);
  });

  it("leaves out reports, dismissed emails, waited-on threads, closed records, nowhere to wait, and the window", () => {
    const m = [
      mail("rep", "t-rep", "2026-11-01", { reportId: "r1" }),
      mail("rep2", "t-rep2", "2026-11-01"),
      mail("dis", "t-dis", "2026-11-01", { dismissed: true }),
      mail("wait", "t-wait", "2026-11-01"),
      mail("lost", "t-lost", "2026-11-01", { itemId: "passed" }),
      mail("typed", "t-typed", "2026-11-01", { contactId: null }),
      mail("old", "t-old", "2026-10-05"),
      mail("edge", "t-edge", "2026-10-06"),
    ];
    const rows = noReplyRows({ ...base, mail: m, reportThreads: new Set(["t-rep2"]), waitedThreads: new Set(["t-wait"]) });
    expect(rows.map((r) => r.commId)).toEqual(["edge"]);
  });

  it("sends an email about a job or consulting item, or with no deal, to the person; oldest first", () => {
    const rows = noReplyRows({ ...base, mail: [mail("j", "t1", "2026-11-02", { itemId: "job" }), mail("p", "t2", "2026-10-26", { contactId: "c-rita", organizationId: "o-ga" })] });
    expect(rows.map((r) => [r.commId, r.target, r.href, r.recordName])).toEqual([
      ["p", "person", "/work/people/c-rita", "GA Home Care Association"],
      ["j", "person", "/work/people/c-mark", "Lumen Industrial Holdings"],
    ]);
  });

  it("knows where Add to Waiting puts the wait", () => {
    expect(waitTarget(items.summit, "c")).toBe("deal");
    expect(waitTarget(items.job, "c")).toBe("person");
    expect(waitTarget(items.job, null)).toBeNull();
    expect(waitTarget(items.passed, "c")).toBeNull();
    expect(waitTarget(null, "c")).toBe("person");
    expect(waitTarget(null, null)).toBeNull();
  });
});

describe("Waiting on someone with people (push E, push E2)", () => {
  it("groups deals and people by the threshold, longest wait first; the labels are N+ days and < N days", () => {
    const people = personWaits(
      [
        { id: "p1", name: "Priya Natarajan", organization: "Truist", role: "Lender", email: "p@example.com", waits: [{ id: "w1", text: "Two intros", since: "2026-10-30", repliedOn: null }] },
        { id: "p2", name: "Nobody Waiting", organization: null, role: null, email: null, waits: [{ id: "w2", text: " ", since: null, repliedOn: null }] },
        { id: "p3", name: "No waits", organization: null, role: null, email: null, waits: [] },
      ],
      today,
      5,
    );
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ key: "person:p1", kind: "person", days: 6, level: "amber", context: "Lender", href: "/work/people/p1" });
    expect(people[0].lines).toEqual([{ waitId: "w1", waitingOn: "Two intros", who: "Truist", since: "2026-10-30", days: 6, level: "amber", repliedOn: null, email: "p@example.com", contactId: "p1", contactName: "Priya Natarajan" }]);
    const g = waitGroups([...people, { name: "Summit", days: 11 }, { name: "Oakline", days: 2 }] as never[], 5);
    expect(g.map((x) => [x.label, (x.items as { name: string }[]).map((i) => i.name)])).toEqual([
      ["5+ days", ["Summit", "Priya Natarajan"]],
      ["< 5 days", ["Oakline"]],
    ]);
  });

  it("keeps two waits on one deal as one row with two lines, in the group of its longest wait", () => {
    const line = (waitId: string, waitingOn: string, days: number) => ({ waitId, waitingOn, who: "Luis Ortega", since: null, days, level: days >= 5 ? ("amber" as const) : ("quiet" as const), repliedOn: null, email: null, contactId: null, contactName: null });
    const row = waitItem({ key: "deal:oak", kind: "deal", id: "oak", name: "Oakline Dental Lab", href: "/work/deals/oak", context: "NDA signed" }, [line("a", 'Luis Ortega\'s reply to your email "Oakline CIM"', 2), line("b", "The CIM", 6)]);
    expect(row!.lines.map((l) => l.waitingOn)).toEqual(["The CIM", 'Luis Ortega\'s reply to your email "Oakline CIM"']);
    // Item 3 of 2026-11-05: a line whose text names its person drops the separate "· Luis Ortega".
    expect(row!.lines.map((l) => l.who)).toEqual(["Luis Ortega", null]);
    expect([row!.days, row!.level]).toEqual([6, "amber"]);
    expect(waitGroups([row!], 5).map((g) => g.items.length)).toEqual([1, 0]);
    // Every line cleared: no row.
    expect(waitItem({ key: "deal:x", kind: "deal", id: "x", name: "X", href: "", context: null }, [])).toBeNull();
  });

  it("reads a record's waits longest first, and sums them up where there is room for one", () => {
    const lines = waitLines(
      [
        { id: "a", text: 'Luis Ortega\'s reply to your email "Oakline CIM"', since: "2026-11-03", createdAt: "2026-11-05T10:00:00Z" },
        { id: "b", text: "The CIM", since: "2026-11-03", createdAt: "2026-11-01T10:00:00Z" },
        { id: "c", text: "Times for a call", since: "2026-10-28", createdAt: "2026-11-02T10:00:00Z" },
        { id: "d", text: "  ", since: "2026-10-01", createdAt: "2026-11-02T10:00:00Z" },
      ],
      today,
      5,
    );
    expect(lines.map((l) => [l.id, l.days, l.level])).toEqual([["c", 8, "amber"], ["b", 2, "quiet"], ["a", 2, "quiet"]]);
    expect(waitSummary(lines)).toEqual({ waitingOn: "Times for a call and 2 more", waitingSince: "2026-10-28", waitDays: 8, waitLevel: "amber" });
    expect(waitSummary(lines.slice(1, 2)).waitingOn).toBe("The CIM");
    expect(waitSummary([])).toEqual({ waitingOn: null, waitingSince: null, waitDays: 0, waitLevel: "none" });
    expect(waitsText(lines.slice(1), (d) => (d === "2026-11-03" ? "Nov 3" : d))).toBe('The CIM, since Nov 3; Luis Ortega\'s reply to your email "Oakline CIM", since Nov 3');
  });

  it("shows Replied for a reply to the original email or to the follow-up, whichever came first (push E2, item 3)", () => {
    const m = [
      { direction: "incoming", threadId: "orig", occurredAt: "2026-11-05T09:00:00Z" },
      { direction: "incoming", threadId: "follow", occurredAt: "2026-11-06T09:00:00Z" },
    ];
    const orig = { thread: "orig", at: "2026-10-30T14:00:00Z" };
    const follow = { thread: "follow", at: "2026-11-04T14:00:00Z" };
    // Dana answers the Oct 30 LOI email instead of the follow-up: Replied.
    expect(waitRepliedAt(m, [orig, follow])).toBe("2026-11-05T09:00:00Z");
    expect(waitRepliedAt(m.slice(1), [orig, follow])).toBe("2026-11-06T09:00:00Z");
    expect(waitRepliedAt([], [orig, follow])).toBeNull();
    expect(waitRepliedAt(m, [null, undefined])).toBeNull();
  });

  it("finds the first reply after the email a wait came from", () => {
    const m = [
      { direction: "incoming", threadId: "t", occurredAt: "2026-11-01T10:00:00Z" },
      { direction: "incoming", threadId: "t", occurredAt: "2026-11-04T10:00:00Z" },
      { direction: "incoming", threadId: "t", occurredAt: "2026-11-03T10:00:00Z" },
      { direction: "incoming", threadId: "u", occurredAt: "2026-11-02T10:00:00Z" },
    ];
    expect(firstReplyAfter(m, "t", "2026-11-02T00:00:00Z")).toBe("2026-11-03T10:00:00Z");
    expect(firstReplyAfter(m, "t", "2026-11-05T00:00:00Z")).toBeNull();
  });

  it("writes Waiting on and the Follow up to a person (wording of item 3, 2026-11-05)", () => {
    expect(replyWaitText("Pinecrest LOI", "Dana Whitfield")).toBe('Dana Whitfield\'s reply to your email "Pinecrest LOI"');
    expect(replyWaitText("East Tennessee owners")).toBe('Reply to your email "East Tennessee owners"');
    expect(replyWaitText("", "Dana Whitfield")).toBe("Dana Whitfield's reply to your email");
    expect(replyWaitText("")).toBe("Reply to your email");
    const long = replyWaitText("x".repeat(200), "Dana Whitfield");
    expect(long).toHaveLength(120);
    expect(long.endsWith('..."')).toBe(true);
    // Read back, with the wordings saved before (they keep their text).
    expect(parseReplyWait('Dana Whitfield\'s reply to your email "Pinecrest LOI"')).toEqual({ name: "Dana Whitfield", subject: "Pinecrest LOI" });
    expect(parseReplyWait("Kevin O'Brien's reply to your email")).toEqual({ name: "Kevin O'Brien", subject: "" });
    expect(parseReplyWait('Reply to your email "Pinecrest LOI"')).toEqual({ name: null, subject: "Pinecrest LOI" });
    expect(replySubject("Reply to your email: Pinecrest LOI")).toBe("Pinecrest LOI");
    expect(replySubject("A reply to: Pinecrest LOI")).toBe("Pinecrest LOI");
    expect(replySubject("The CIM")).toBe("");
    expect(parseReplyWait("The CIM")).toBeNull();
    expect(replyWaitName('Dana Whitfield\'s reply to your email "Pinecrest LOI"')).toBe("Dana Whitfield");
    expect(replyWaitName("Reply to your email: Pinecrest LOI")).toBeNull();
    // The Waiting card: the person is not named twice.
    expect(whoBesides('Dana Whitfield\'s reply to your email "Pinecrest LOI"', "Sunbelt, Dana Whitfield")).toBeNull();
    expect(whoBesides("The CIM", "Luis Ortega")).toBe("Luis Ortega");
    expect(whoBesides('Reply to your email "Oakline CIM"', "Luis Ortega")).toBe("Luis Ortega");
    // The Replied pill names the person by first name.
    expect(repliedLabel("Dana Whitfield", "Nov 4")).toBe("Dana replied Nov 4");
    expect(repliedLabel(null, "Nov 4")).toBe("Replied Nov 4");
    // The drafts read naturally whatever the wording.
    expect(personFollowUpDraft({ name: "Rita Caldwell", waitingOn: 'Rita Caldwell\'s reply to your email "Member survey project"', days: 2 }).body).toContain("still waiting on your reply to my email about Member survey project. It has been 2 days");
    expect(personFollowUpDraft({ name: "Rita Caldwell", waitingOn: "Rita Caldwell's reply to your email", days: 1 }).body).toContain("still waiting on your reply to my email.");
    expect(personFollowUpDraft({ name: "Rita", waitingOn: "A reply to: Member survey project", days: 1 }).subject).toBe("Following up: Member survey project");
    expect(personFollowUpDraft({ name: "Rita", waitingOn: "Reply to your email", days: 1 }).body).toContain("still waiting on your reply to my email.");
    const d = personFollowUpDraft({ name: "Rita Caldwell", waitingOn: "Reply to your email: Member survey project", days: 4 });
    expect(d.subject).toBe("Following up: Member survey project");
    expect(d.body).toContain("Hi Rita,");
    expect(d.body).toContain("your reply to my email about Member survey project. It has been 4 days");
    expect(personFollowUpDraft({ name: "Priya", waitingOn: "Two intros", days: 1 }).body).toContain("still waiting on two intros.\n");
  });
});
