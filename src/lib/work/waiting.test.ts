import { describe, expect, it } from "vitest";
import { firstReplyAfter, noReplyRows, personFollowUpDraft, personWaits, replyWaitText, waitGroups, waitTarget, type ItemInfo, type MailRow } from "./waiting";

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

describe("Waiting on someone with people (push E)", () => {
  it("groups deals and people by the threshold, longest wait first", () => {
    const people = personWaits(
      [
        { id: "p1", name: "Priya Natarajan", waitingOn: "Two intros", waitingSince: "2026-10-30", organization: "Truist", role: "Lender", email: "p@example.com", repliedOn: null },
        { id: "p2", name: "Nobody Waiting", waitingOn: " ", waitingSince: null, organization: null, role: null, email: null, repliedOn: null },
      ],
      today,
      5,
    );
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ key: "person:p1", kind: "person", days: 6, level: "amber", who: "Truist", context: "Lender", href: "/work/people/p1" });
    const g = waitGroups([...people, { name: "Summit", days: 11 }, { name: "Oakline", days: 2 }] as never[], 5);
    expect(g.map((x) => [x.label, (x.items as { name: string }[]).map((i) => i.name)])).toEqual([
      ["5+ days", ["Summit", "Priya Natarajan"]],
      ["Less than 5 days", ["Oakline"]],
    ]);
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

  it("writes Waiting on and the Follow up to a person", () => {
    expect(replyWaitText("East Tennessee owners")).toBe("A reply to: East Tennessee owners");
    expect(replyWaitText("")).toBe("A reply to: your email");
    expect(replyWaitText("x".repeat(200))).toHaveLength(120);
    const d = personFollowUpDraft({ name: "Rita Caldwell", waitingOn: "A reply to: Member survey project", days: 4 });
    expect(d.subject).toBe("Following up: Member survey project");
    expect(d.body).toContain("Hi Rita,");
    expect(d.body).toContain("your reply to my email about Member survey project. It has been 4 days");
    expect(personFollowUpDraft({ name: "Priya", waitingOn: "Two intros", days: 1 }).body).toContain("still waiting on two intros.\n");
  });
});
