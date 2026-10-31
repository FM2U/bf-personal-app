import { describe, expect, it } from "vitest";
import { buildWorkSample, WORK_SAMPLE_NAMES } from "./sample";
import { checkBuyBox } from "./buy-box";
import { STAGE_DEFAULTS, WORK_STAGES } from "./stages";

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
    expect(due.map((i) => i.name).sort()).toEqual(["BrightPath Home Care", "Coastal Fleet Maintenance", "Dalton Services", "Hilltop Pest Solutions", "Meridian Industrial Coatings"].sort());
    const waits = w.items.filter((i) => i.waiting_on).map((i) => ({ name: i.name, since: i.waiting_since }));
    expect(waits.filter((x) => String(x.since) <= "2026-10-25")).toHaveLength(2);
    expect(byName("Summit Logistics Group").waiting_since).toBe("2026-10-19");
    expect(byName("Pinecrest Landscaping").waiting_since).toBe("2026-10-24");
  });

  it("uses the stage default as the next action where Done should ask about the next stage", () => {
    expect(byName("Hilltop Pest Solutions").next_action).toBe(STAGE_DEFAULTS.Interested.title);
    expect(byName("Coastal Fleet Maintenance").next_action).toBe(STAGE_DEFAULTS["Seller call"].title);
    expect(byName("Dalton Services").next_action).toBe("Review the CIM and write the key finding");
  });

  it("gives Dalton Services its numbers, findings, timeline, and documents", () => {
    const dalton = byName("Dalton Services");
    const fin = w.financials.find((f) => f.item_id === dalton.id)!;
    expect(fin).toMatchObject({ revenue: 5_600_000, ebitda: 1_700_000, asking_price: 6_000_000 });
    expect(String(dalton.key_finding)).toContain("70% of revenue");
    expect(String(dalton.open_questions).split("\n")).toHaveLength(3);
    expect(w.communications.filter((c) => c.pipeline_item_id === dalton.id)).toHaveLength(3);
    expect(w.notes.filter((x) => x.record_id === dalton.id)).toHaveLength(1);
    expect(w.documents.filter((d) => d.itemId === dalton.id).map((d) => d.fileName)).toEqual(["Dalton_CIM.pdf", "Dalton_PL_2023_2025.csv"]);
    const dates = w.stageDates.find((d) => d.itemId === dalton.id)!;
    expect(dates.enteredDaysAgo).toBe(3);
    expect(dates.history.map((h) => h.stageName)).toEqual(["Interested", "NDA signed", "Broker call"]);
  });

  it("marks every listing with the buy box check, has example.com emails, and lists every name", () => {
    for (const i of w.items.filter((x) => x.screened === false)) {
      const f = w.financials.find((x) => x.item_id === i.id);
      expect(i.buy_box_note).toBe(checkBuyBox({ name: String(i.name), whatItDoes: i.what_it_does as string, industry: i.industry as string, location: i.location as string, ebitda: f?.ebitda as number, sde: f?.sde as number }).label);
    }
    expect(w.contacts.every((c) => String(c.email).endsWith("@example.com"))).toBe(true);
    for (const r of [...w.items, ...w.contacts, ...w.organizations]) expect(WORK_SAMPLE_NAMES).toContain(r.name);
    const ids = [...w.items, ...w.financials, ...w.contacts, ...w.organizations, ...w.communications, ...w.notes].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
