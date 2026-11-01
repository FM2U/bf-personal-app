import { describe, expect, it } from "vitest";
import { buildWorkSample, WORK_SAMPLE_NAMES } from "./sample";
import { checkBuyBox } from "./buy-box";
import { STAGE_DEFAULTS, WORK_STAGES } from "./stages";
import { outreachSections, parsePurposes } from "./outreach";

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
    expect(dates.history.map((h) => h.stageName)).toEqual(["Interested", "NDA signed", "Broker call"]);
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

  it("marks every listing with the buy box check, has example.com emails, and lists every name", () => {
    for (const i of w.items.filter((x) => x.screened === false)) {
      const f = w.financials.find((x) => x.item_id === i.id);
      expect(i.buy_box_note).toBe(checkBuyBox({ name: String(i.name), whatItDoes: i.what_it_does as string, industry: i.industry as string, location: i.location as string, ebitda: f?.ebitda as number, sde: f?.sde as number }).label);
    }
    expect(w.contacts.every((c) => String(c.email).endsWith("@example.com"))).toBe(true);
    for (const r of [...w.items, ...w.contacts, ...w.organizations]) expect(WORK_SAMPLE_NAMES).toContain(r.name);
    const ids = [...w.items, ...w.financials, ...w.contacts, ...w.organizations, ...w.communications, ...w.notes, ...w.todos].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
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

  it("has calls and emails on the timelines, three incoming replies waiting (two on Mark Reed), tasks on people, and five to-dos", () => {
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
    expect(b.todos.filter((t) => t.deal_id)).toHaveLength(5);
    expect(b.personalTodos.map((t) => t.due_on)).toEqual(["2026-10-30", null, "2026-11-04", "2026-11-03", "2026-11-13"]);
    expect(b.notes.filter((n) => n.record_type === "contacts")).toHaveLength(2);
  });
});
