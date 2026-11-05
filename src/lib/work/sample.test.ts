import { describe, expect, it } from "vitest";
import { buildWorkSample } from "./sample";
import { STAGE_DEFAULTS, WORK_STAGES } from "./stages";
import { outreachSections, parsePurposes } from "./outreach";
import { addDaysISO } from "@/lib/calc/dates";
import { buildFacts } from "@/lib/accountability/facts";
import { countIn, workWeekOf } from "@/lib/accountability/targets";

const stages = Object.fromEntries([...WORK_STAGES, "Closed", "Passed", "Lost"].map((n, i) => [n, `st-${i}`]));
let n = 0;
const w = buildWorkSample({ pipelineId: "p-acq", stages }, () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, "2026-10-30");
const byName = (name: string) => w.items.find((i) => i.name === name)!;

describe("the Work module's sample data", () => {
  it("has 7 listings to screen (3 fit, one from the network), 9 deals across the stages, 3 passed, 1 lost", () => {
    const listings = w.items.filter((i) => i.screened === false);
    expect(listings).toHaveLength(7);
    expect(listings.every((i) => i.stage_id === null)).toBe(true);
    expect(listings.filter((i) => String(i.buy_box_note) === "Fits")).toHaveLength(3);
    expect(listings.filter((i) => i.source === "Network")).toHaveLength(1);
    const deals = w.items.filter((i) => i.screened !== false);
    const active = deals.filter((i) => ![stages.Passed, stages.Lost].includes(String(i.stage_id)));
    expect(active).toHaveLength(9);
    expect(new Set(active.map((i) => i.stage_id)).size).toBe(8);
    expect(deals.filter((i) => i.stage_id === stages.Passed)).toHaveLength(3);
    expect(deals.filter((i) => i.stage_id === stages.Passed).every((i) => i.pass_reason)).toBe(true);
    expect(deals.filter((i) => i.stage_id === stages.Lost)).toHaveLength(1);
    expect(active.every((i) => i.next_action && i.next_action_due)).toBe(true);
  });

  it("has five next actions due today or earlier and two waits over 5 days", () => {
    const due = w.items.filter((i) => i.screened !== false && i.next_action_due && String(i.next_action_due) <= "2026-10-30" && ![stages.Passed, stages.Lost].includes(String(i.stage_id)));
    expect(due.map((i) => i.name).sort()).toEqual(["00 Fleet Repair Shop, Jacksonville", "BrightPath Home Care", "Dalton Services", "Hilltop Pest Solutions", "Meridian Industrial Coatings"].sort());
    const waits = w.items.filter((i) => i.waiting_on).map((i) => ({ name: i.name, since: i.waiting_since }));
    expect(waits.filter((x) => String(x.since) <= "2026-10-25")).toHaveLength(2);
    expect(byName("Summit Logistics Group").waiting_since).toBe("2026-10-19");
    expect(byName("Pinecrest Landscaping").waiting_since).toBe("2026-10-24");
  });

  it("uses the stage default as the next action where Done should ask about the next stage", () => {
    expect(byName("Hilltop Pest Solutions").next_action).toBe(STAGE_DEFAULTS.Interested.title);
    expect(byName("00 Fleet Repair Shop, Jacksonville").next_action).toBe(STAGE_DEFAULTS["Seller call"].title);
    expect(byName("Dalton Services").next_action).toBe("Review the CIM and write the key finding");
  });

  it("gives Dalton Services its numbers, findings, timeline, and documents", () => {
    const dalton = byName("Dalton Services");
    const fin = w.financials.find((f) => f.item_id === dalton.id)!;
    expect(fin).toMatchObject({ revenue: 5_600_000, ebitda: 1_700_000, asking_price: 6_000_000 });
    expect(String(dalton.key_finding)).toContain("70% of revenue");
    const q = dalton.open_questions_json as { seller: string[]; broker: string[]; self: string[] };
    expect(q.seller.length).toBeGreaterThanOrEqual(3);
    expect(q.broker.length).toBeGreaterThanOrEqual(2);
    expect(q.self.length).toBeGreaterThanOrEqual(2);
    expect(w.todos.filter((t) => t.deal_id === dalton.id)).toHaveLength(3);
    expect(w.todos.every((t) => t.text && t.position > 0)).toBe(true);
    expect(w.communications.filter((c) => c.pipeline_item_id === dalton.id)).toHaveLength(3);
    expect(w.notes.filter((x) => x.record_id === dalton.id)).toHaveLength(1);
    expect(w.documents.filter((d) => d.itemId === dalton.id).map((d) => d.fileName)).toEqual(["Dalton_CIM.pdf", "Dalton_PL_2023_2025.csv"]);
    const dates = w.stageDates.find((d) => d.itemId === dalton.id)!;
    expect(dates.enteredDaysAgo).toBe(3);
    expect(dates.history.map((h) => h.stageName)).toEqual(["Interested", "NDA signed", "CIM review"]);
  });

  it("has one listing with a placeholder name and no company name, and one deal with both names", () => {
    const placeholder = w.items.find((i) => i.name === "00 Medicaid Transport Provider")!;
    expect(placeholder.screened).toBe(false);
    expect(placeholder.company_name).toBeNull();
    const both = w.items.find((i) => i.company_name === "Coastal Fleet Maintenance")!;
    expect(both.name).toBe("00 Fleet Repair Shop, Jacksonville");
    expect(both.screened).toBe(true);
    expect(w.items.filter((i) => i.open_questions_json)).toHaveLength(3);
  });
});

describe("the Outreach sample (batch B)", () => {
  let k = 0;
  const b = buildWorkSample({ pipelineId: "p-acq", stages, batchB: true }, () => `00000000-0000-4000-8000-${String(++k).padStart(12, "0")}`, "2026-10-30");
  const people = b.contacts.map((c) => ({ id: String(c.id), name: String(c.name), purposes: parsePurposes(c.purposes), nextFollowUp: c.follow_up_date ? String(c.follow_up_date) : null }));

  it("has 16 people with roles and purposes in every section, and nothing of it without batch B", () => {
    expect(people).toHaveLength(16);
    expect(b.contacts.every((c) => c.outreach_role && parsePurposes(c.purposes).length > 0 && c.notes)).toBe(true);
    const sections = outreachSections(people, "2026-10-30");
    expect(sections.overdue.map((p) => p.name)).toEqual(["Priya Natarajan", "Mark Reed"]);
    expect(sections.today.map((p) => p.name).sort()).toEqual(["Carla Jenkins", "Denise Walker", "Tom Alvarez"]);
    expect(sections.week).toHaveLength(6);
    expect(sections.later).toHaveLength(3);
    expect(sections.nodate.map((p) => p.name).sort()).toEqual(["Nina Reyes", "Sam Patel"]);
    for (const purpose of ["off_market_deals", "job_search", "consulting", "rosara"]) expect(people.some((p) => p.purposes.includes(purpose as never))).toBe(true);
    expect(w.contacts).toHaveLength(4);
    expect(w.contacts.every((c) => c.outreach_role === undefined)).toBe(true);
    expect(w.personalTodos).toHaveLength(0);
  });

  it("has calls and emails on the timelines, three incoming replies waiting (two on Mark Reed), tasks on people, and seven to-dos", () => {
    const reed = b.contacts.find((c) => c.name === "Mark Reed")!;
    const incoming = b.communications.filter((c) => c.awaiting_log);
    expect(incoming).toHaveLength(3);
    expect(incoming.filter((c) => c.contact_id === reed.id)).toHaveLength(2);
    expect(incoming.every((c) => c.direction === "incoming" && c.method === "email")).toBe(true);
    const calls = b.communications.filter((c) => c.method === "call" || c.method === "meeting");
    expect(calls.length).toBeGreaterThanOrEqual(10);
    expect(calls.every((c) => Number(c.call_minutes) > 0)).toBe(true);
    // Every person has at least one logged email or call (a last contact).
    for (const p of people) expect(b.communications.some((c) => c.contact_id === p.id && !c.awaiting_log)).toBe(true);
    expect(b.todos.filter((t) => t.record_type === "contacts")).toHaveLength(3);
    expect(b.todos.filter((t) => t.deal_id)).toHaveLength(9);
    expect(b.personalTodos.map((t) => t.due_on)).toEqual(["2026-10-30", null, "2026-11-04", "2026-10-31", "2026-11-13", "2026-10-30", "2026-11-01", "2026-11-02"]);
    // Push D: one repeating to-do has an end date (weekly, three weeks out).
    expect(b.personalTodos.filter((t) => t.repeat_until).map((t) => [t.text, t.repeat, t.repeat_until])).toEqual([["Post the job search update in the alumni group", "weekly", "2026-11-20"]]);
    // Push C: two repeat, one is linked to a deal; record tasks carry dates and one repeats every week.
    expect(b.personalTodos.filter((t) => t.repeat).map((t) => t.repeat)).toEqual(["monthly", "weekdays", "weekly"]);
    expect(b.personalTodos.filter((t) => t.record_type === "pipeline_items")).toHaveLength(1);
    expect(b.todos.filter((t) => t.due_on).length).toBeGreaterThanOrEqual(8);
    expect(b.todos.filter((t) => t.repeat === "weekly")).toHaveLength(2);
    // Two blocks today, one on a deal's next action and one on a dated task.
    expect(b.timeBlocks.map((x) => String(x.row_key).split(":")[0])).toEqual(["deal", "todo"]);
    expect(b.timeBlocks.every((x) => String(x.starts_at) < String(x.ends_at))).toBe(true);
    expect(b.notes.filter((n) => n.record_type === "contacts")).toHaveLength(2);
  });
});

describe("the push E sample (No reply yet, a person waited on, Replied)", () => {
  let k = 0;
  const b = buildWorkSample({ pipelineId: "p-acq", stages, batchB: true }, () => `00000000-0000-4000-8000-${String(++k).padStart(12, "0")}`, "2026-11-05");
  const id = (name: string) => String((b.items.find((i) => i.name === name) ?? b.contacts.find((c) => c.name === name))!.id);
  const threaded = b.communications.filter((c) => String(c.gmail_thread_id ?? "").startsWith("sample-thread-e"));
  it("has two emails with no reply (one on a deal, one to a person with no deal) and the Pinecrest email with its reply", () => {
    const sent = threaded.filter((c) => c.direction === "outgoing");
    expect(sent.map((c) => [c.subject, c.pipeline_item_id ?? null]).sort()).toEqual([["Member survey project", null], ["Oakline CIM", id("Oakline Dental Lab")], ["Pinecrest LOI", id("Pinecrest Landscaping")]]);
    const reply = threaded.find((c) => c.direction === "incoming")!;
    expect(reply.gmail_thread_id).toBe(sent.find((c) => c.subject === "Pinecrest LOI")!.gmail_thread_id);
    expect(String(reply.occurred_at) > String(sent.find((c) => c.subject === "Pinecrest LOI")!.occurred_at)).toBe(true);
  });
  it("waits on Priya, and Pinecrest's wait came from its LOI email", () => {
    const priya = b.contacts.find((c) => c.name === "Priya Natarajan")!;
    expect(priya.waiting_on).toBeTruthy();
    expect(priya.waiting_since).toBe("2026-10-30");
    const pine = b.items.find((i) => i.name === "Pinecrest Landscaping")!;
    expect(pine.waiting_on).toBe("A reply to: Pinecrest LOI");
    expect(b.waitLinks).toEqual([{ table: "pipeline_items", id: id("Pinecrest Landscaping"), commId: threaded.find((c) => c.subject === "Pinecrest LOI")!.id }]);
  });
});

describe("the batch B2 sample (projects, opportunities, consulting)", () => {
  let k = 0;
  const jobs = { pipelineId: "p-job", stages: Object.fromEntries(["Contact", "Conversation", "Interview", "Offer", "Accepted", "Declined", "Not chosen"].map((n, i) => [n, `j-${i}`])) };
  const consulting = { pipelineId: "p-con", stages: Object.fromEntries(["Lead", "Proposal", "Engagement", "Paid", "Done", "Lost"].map((n, i) => [n, `c-${i}`])) };
  const b = buildWorkSample({ pipelineId: "p-acq", stages, batchB: true, batchB2: true, jobs, consulting }, () => `00000000-0000-4000-8000-${String(++k).padStart(12, "0")}`, "2026-10-30");
  it("has five open opportunities across the four stages plus three closed, with one waiting and one without a next action", () => {
    const opps = b.items.filter((i) => i.pipeline_id === "p-job");
    const open = opps.filter((i) => ["j-0", "j-1", "j-2", "j-3"].includes(String(i.stage_id)));
    expect(open).toHaveLength(5);
    expect(new Set(open.map((i) => i.stage_id)).size).toBe(4);
    expect(opps.filter((i) => i.stage_id === jobs.stages.Declined)).toHaveLength(2);
    expect(opps.filter((i) => i.stage_id === jobs.stages["Not chosen"])).toHaveLength(1);
    expect(open.filter((i) => !i.next_action).map((i) => i.name)).toEqual(["Peachtree Logistics"]);
    expect(b.noActionItems).toEqual([opps.find((i) => i.name === "Peachtree Logistics")!.id]);
    expect(open.filter((i) => i.waiting_on)).toHaveLength(1);
    const harbor = opps.find((i) => i.name === "Harbor Health Partners")!;
    expect(harbor.next_action_due).toBe("2026-10-30");
    expect(harbor.pay_range).toBe("$150K to $170K");
    expect((harbor.open_questions_json as { self: string[] }).self).toHaveLength(3);
    expect(b.communications.filter((c) => c.pipeline_item_id === harbor.id)).toHaveLength(2);
    expect(open.every((i) => i.role_title && i.contact_name)).toBe(true);
  });

  it("has four open consulting items, one per stage, plus Lost and Done, with fees, scopes, and start dates", () => {
    const cons = b.items.filter((i) => i.pipeline_id === "p-con");
    const open = cons.filter((i) => ["c-0", "c-1", "c-2", "c-3"].includes(String(i.stage_id)));
    expect(open).toHaveLength(4);
    expect(new Set(open.map((i) => i.stage_id)).size).toBe(4);
    expect(cons.filter((i) => i.stage_id === consulting.stages.Lost)).toHaveLength(1);
    expect(cons.filter((i) => i.stage_id === consulting.stages.Done)).toHaveLength(1);
    expect(open.every((i) => Number(i.fee) > 0 && i.what_it_does && i.contact_name)).toBe(true);
    expect(b.consultingDetails).toHaveLength(4);
    expect(b.consultingDetails.every((d) => d.scope_notes)).toBe(true);
    const proposal = cons.find((i) => i.stage_id === consulting.stages.Proposal)!;
    expect(proposal.next_action).toBe("Send the scope and fee");
    expect(b.stageDates.filter((d) => cons.some((i) => i.id === d.itemId))).toHaveLength(6);
  });
});

describe("the batch C sample (Jake, End of day rows, work events)", () => {
  let k = 0;
  // Friday, Oct 30, 2026: the four weekdays before it are Thu Oct 29 (skipped), Wed 28, Tue 27, Mon 26 (sent).
  const c = buildWorkSample({ pipelineId: "p-acq", stages, batchB: true, batchB2: true, batchC: true }, () => `00000000-0000-4000-8000-${String(++k).padStart(12, "0")}`, "2026-10-30");

  it("has Jake (weekdays) and Sarah (Fridays) as partners, the sent reports with their threads, one skipped day, and replies", () => {
    const partners = c.contacts.filter((p) => p.outreach_role === "accountability_partner");
    expect(partners.map((p) => [p.name, p.report_days, p.report_sections])).toEqual([
      ["Jake Morgan", [1, 2, 3, 4, 5], ["today", "targets", "top", "active", "waiting", "jobs", "week", "review", "tomorrow"]],
      ["Sarah Klein", [5], ["targets", "week", "review", "tomorrow"]],
    ]);
    const [jake, sarah] = partners;
    // Four weekdays before Fri Oct 30 (none a Friday), plus the Friday before them (Oct 23), sent to both partners.
    expect(c.endOfDay.map((r) => [r.day, r.status]).sort((a, b) => String(b[0]).localeCompare(String(a[0])))).toEqual([["2026-10-29", "skipped"], ["2026-10-28", "sent"], ["2026-10-27", "sent"], ["2026-10-26", "sent"], ["2026-10-23", "sent"]]);
    expect(c.partnerReports).toHaveLength(5);
    expect(c.partnerReports.filter((r) => r.contact_id === jake.id)).toHaveLength(4);
    expect(c.partnerReports.filter((r) => r.contact_id === sarah.id).map((r) => r.period_start)).toEqual(["2026-10-23"]);
    expect(c.partnerReports.every((r) => r.report_kind === "end_of_day" && r.status === "finalized" && r.sent_at && String(r.gmail_thread_id).startsWith("sample-thread-"))).toBe(true);
    expect(c.partnerReports.filter((r) => r.partner_comment)).toHaveLength(0);
    // The replies are incoming emails linked to their report, once each by Gmail id.
    const replies = c.communications.filter((m) => m.direction === "incoming" && m.partner_report_id);
    expect(replies.map((m) => m.gmail_message_id)).toEqual(["sample-reply-1", "sample-reply-2", "sample-reply-3"]);
    expect(replies.every((m) => c.partnerReports.some((r) => r.id === m.partner_report_id && r.contact_id === m.contact_id))).toBe(true);
    // Sarah's copy has only her sections.
    const sarahHtml = String((c.partnerReports.find((r) => r.contact_id === sarah.id)!.snapshot as { html: string }).html);
    expect(sarahHtml).toContain("Hello Sarah,");
    expect(sarahHtml).not.toContain("Summit Logistics Group");
    const sent = c.endOfDay.filter((r) => r.status === "sent");
    expect(sent.every((r) => String(r.report_html).includes("Hello Jake,") && String(r.report_html).includes("Thank you,<br>Bram") && c.partnerReports.some((p) => p.id === r.report_id))).toBe(true);
    expect(sent.every((r) => !/#(c9a227|b8860b|d4a017|daa520|caa53d)/i.test(String(r.report_html)))).toBe(true);
    // Push D: the past Friday has its Weekly review answers, and the Friday copies show them.
    const friday = c.endOfDay.find((r) => r.day === "2026-10-23")!;
    expect(Object.keys(friday.weekly_review as object)).toEqual(["well", "slipped", "focus"]);
    expect(sarahHtml).toContain("Weekly review");
    expect(c.endOfDay.filter((r) => r.weekly_review)).toHaveLength(1);
  });

  it("push D: a finished monthly review for the month before last and one still to do for last month", () => {
    expect(c.monthlyReviews.map((r) => [r.month, !!r.finished_at, !!r.exported_at])).toEqual([["2026-08-01", true, true], ["2026-09-01", false, false]]);
    expect((c.monthlyReviews[0].results as unknown[]).length).toBe(6);
    expect((c.monthlyReviews[0].next_targets as unknown[]).length).toBe(6);
  });

  it("puts details, tasks, and a note on Transworld, and the consulting clients get their role", () => {
    const tw = c.organizations.find((o) => o.name === "Transworld Business Advisors")!;
    expect(tw).toMatchObject({ kind: "broker", region: "Knoxville and Chattanooga, TN", next_action: "Ask for their full East Tennessee listing sheet" });
    expect(c.todos.filter((t) => t.record_type === "organizations" && t.record_id === tw.id)).toHaveLength(3);
    expect(c.notes.filter((n) => n.record_type === "organizations" && n.record_id === tw.id)).toHaveLength(1);
    expect(c.contacts.filter((p) => p.outreach_role === "consulting_client").map((p) => p.name)).toEqual(["Greg Thornton", "Rita Caldwell"]);
    expect(c.organizations.find((o) => o.name === "Sullivan Wickley")!.kind).toBe("consulting_client");
  });

  it("the skipped day keeps its judgment, so the reason it owes is asked on the next End of day", () => {
    const skipped = c.endOfDay.find((r) => r.status === "skipped")!;
    expect(skipped.skip_reason).toBe("Travel day, Chattanooga site visit");
    const judged = skipped.judged as { judged: boolean; met: boolean; commitment: boolean }[];
    expect(judged.some((j) => j.judged && !j.met && j.commitment)).toBe(true);
  });

  it("has work events over the past weeks and nothing of batch C without the update", () => {
    expect(c.workEvents.filter((e) => e.kind === "follow_up_done").length).toBeGreaterThan(10);
    expect(c.workEvents.filter((e) => e.kind === "follow_up_done" && e.on_time === false).length).toBeGreaterThan(0);
    expect(c.workEvents.filter((e) => e.kind === "focus_done")).toHaveLength(6);
    expect(c.workEvents.every((e) => String(e.happened_on) < "2026-10-30")).toBe(true);
    expect(w.contacts.filter((p) => p.outreach_role === "accountability_partner")).toHaveLength(0);
    expect(w.endOfDay).toHaveLength(0);
    expect(w.workEvents).toHaveLength(0);
  });
});

describe("the sample's week figures (Edit batch C, item 6), counted by the app's one counting function", () => {
  const jobsStages = ["Contact", "Conversation", "Interview", "Offer", "Accepted", "Declined", "Not chosen"];
  const consultingStages = ["Lead", "Proposal", "Engagement", "Paid", "Done", "Lost"];
  const dealStages = [...WORK_STAGES, "Closed", "Passed", "Lost"];
  const outcome = (name: string) => (["Passed", "Lost", "Declined", "Not chosen"].includes(name) ? "lost" : ["Accepted", "Done", "Closed"].includes(name) ? "won" : "open");
  const ids = (pipe: string, names: string[]) => Object.fromEntries(names.map((n, i) => [n, `${pipe}-${i}`]));
  const pipes: Record<string, Record<string, string>> = { "p-acq": ids("st", dealStages), "p-job": ids("j", jobsStages), "p-con": ids("c", consultingStages) };
  const stageById = Object.fromEntries(Object.values(pipes).flatMap((m) => Object.entries(m).map(([name, id]) => [id, { name, outcome: outcome(name) }])));

  /** The sample as the app reads it after the load: the rows, the stage history with its dates, then the facts. */
  const weekOf = (today: string) => {
    let k = 0;
    const s = buildWorkSample({ pipelineId: "p-acq", stages: pipes["p-acq"], batchB: true, batchB2: true, batchC: true, jobs: { pipelineId: "p-job", stages: pipes["p-job"] }, consulting: { pipelineId: "p-con", stages: pipes["p-con"] } }, () => `00000000-0000-4000-8000-${String(++k).padStart(12, "0")}`, today);
    const at = (daysAgo: number, hour: number) => `${addDaysISO(today, -daysAgo)}T${hour}:00:00Z`;
    const history = s.stageDates.flatMap((d) => {
      const item = s.items.find((i) => i.id === d.itemId)!;
      const map = pipes[String(item.pipeline_id)];
      return [...d.history.map((h) => ({ item_id: d.itemId, stage_id: map[h.stageName], entered_at: at(h.daysAgo, 13) })), { item_id: d.itemId, stage_id: item.stage_id, entered_at: at(d.enteredDaysAgo, 14) }];
    });
    const since = addDaysISO(workWeekOf(today).start, -63);
    const { facts } = buildFacts({ items: s.items, history, comms: s.communications, events: s.workEvents, people: s.contacts, stageById, laneOf: { "p-acq": "Deals", "p-job": "Job search", "p-con": "Consulting" }, since, local: (ts) => ts.slice(0, 10) });
    const week = workWeekOf(today);
    const count = (key: "deals_moved" | "outreach_contacts" | "listings_screened", start = week.start, end = week.end) => countIn(key, facts, start, end).value;
    return { s, facts, count, week };
  };

  it.each([
    ["Wednesday", "2026-11-04", 3],
    ["Thursday", "2026-11-05", 4],
    ["Friday", "2026-11-06", 5],
  ])("on a %s: deals moved 2 to 3, outreach 6 to 12, listings a few short of 5 a weekday", (_, today, days) => {
    const { count } = weekOf(today);
    expect(count("deals_moved")).toBeGreaterThanOrEqual(2);
    expect(count("deals_moved")).toBeLessThanOrEqual(3);
    expect(count("outreach_contacts")).toBeGreaterThanOrEqual(6);
    expect(count("outreach_contacts")).toBeLessThanOrEqual(12);
    const screened = count("listings_screened");
    expect(screened).toBeLessThan(5 * days);
    expect(screened).toBeGreaterThanOrEqual(5 * days - 4);
  });

  it("early in the week the figures are small, never more than a week's target", () => {
    for (const today of ["2026-11-02", "2026-11-03"]) {
      const { count } = weekOf(today);
      expect(count("deals_moved")).toBeLessThanOrEqual(1);
      expect(count("outreach_contacts")).toBeLessThanOrEqual(5);
      expect(count("listings_screened")).toBeLessThan(10);
    }
  });

  it.each(["2026-11-04", "2026-11-06"])("the past weeks look like weeks (today %s): moves spread out (never 12 of 2), outreach met some weeks, listings met some weeks", (today) => {
    const { count, week } = weekOf(today);
    const weeks = [1, 2, 3, 4].map((w) => ({ start: addDaysISO(week.start, -7 * w), end: addDaysISO(week.start, -7 * w + 4) }));
    const moves = weeks.map((p) => count("deals_moved", p.start, p.end));
    const outreach = weeks.map((p) => count("outreach_contacts", p.start, p.end));
    const listings = weeks.map((p) => count("listings_screened", p.start, p.end));
    expect(Math.max(...moves)).toBeLessThanOrEqual(6);
    expect(outreach.some((n) => n >= 10) && outreach.some((n) => n < 10)).toBe(true);
    expect(listings.some((n) => n >= 25) && listings.some((n) => n < 25)).toBe(true);
    expect(Math.max(...outreach)).toBeLessThanOrEqual(14);
  });
});
