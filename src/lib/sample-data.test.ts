import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildSampleData, SAMPLE_NAME_FIELDS, SAMPLE_SOFTWARE, SAMPLE_TABLES, type SampleSetup } from "./sample-data";

const CATS = ["Housing", "Utilities", "Phone and Internet", "Groceries", "Dining", "Transportation", "Insurance", "Health", "Storage", "Software and Subscriptions", "Shopping", "Consulting Income", "Other Income"];
const setup: SampleSetup = {
  today: "2026-10-27",
  personalEntityId: "e-p",
  llcEntityId: "e-llc",
  categories: Object.fromEntries(CATS.map((c) => [c, `cat-${c}`])),
  budgetId: "b-1",
  budgetedCategoryIds: ["cat-Housing"],
  acquisitions: { pipelineId: "p-acq", stages: { Sourced: "s1", Screened: "s2", "NDA signed": "s3" } },
  consulting: { pipelineId: "p-con", stages: { Active: "c7", Signed: "c6" } },
};
let n = 0;
const { batches, counts } = buildSampleData(setup, () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
const rows = (t: string) => batches.find((b) => b.table === t)?.rows ?? [];

describe("sample data: marking and fake names", () => {
  it("gives every row its own id, so every row can be recorded in sample_records", () => {
    const all = batches.flatMap((b) => b.rows.map((r) => r.id));
    expect(all.every((id) => typeof id === "string" && id.length === 36)).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });

  it("uses only obviously fake names and example.com emails", () => {
    for (const [table, field] of Object.entries(SAMPLE_NAME_FIELDS)) {
      for (const r of rows(table)) expect(String(r[field])).toMatch(/^Sample /);
    }
    const emails = batches.flatMap((b) => b.rows.map((r) => r.email).filter(Boolean));
    expect(emails.length).toBeGreaterThan(5);
    expect(emails.every((e) => String(e).endsWith("@example.com"))).toBe(true);
  });

  it("writes only to tables that insert_record_batch allows, in the order of SAMPLE_TABLES", () => {
    const sql = readFileSync(path.join(__dirname, "../../supabase/migrations/0014_initiative_builder_reset.sql"), "utf8");
    const allowed = sql.match(/allowed text\[\] := array\[([\s\S]*?)\];/)![1].match(/'([a-z_]+)'/g)!.map((s) => s.slice(1, -1));
    for (const b of batches) expect(allowed).toContain(b.table);
    const order = batches.map((b) => b.table);
    expect(order).toEqual(SAMPLE_TABLES.filter((t) => order.includes(t)));
  });
});

describe("sample data: realistic amounts", () => {
  const tx = rows("transactions");
  const monthly = (merchants: RegExp) => {
    const list = tx.filter((t) => merchants.test(String(t.merchant_name)) && Number(t.amount) < 0);
    const months = new Set(list.map((t) => String(t.date).slice(0, 7)));
    return -list.reduce((s, t) => s + Number(t.amount), 0) / Math.max(1, months.size);
  };

  it("has 12 months of transactions up to today", () => {
    const months = new Set(tx.map((t) => String(t.date).slice(0, 7)));
    expect(months.size).toBe(12);
    expect(tx.every((t) => String(t.date) <= "2026-10-27")).toBe(true);
  });

  it("3 storage units total about $1,000 a month and food is about $1,500 a month", () => {
    const storage = tx.filter((t) => t.category_id === "cat-Storage");
    expect(new Set(storage.map((t) => t.merchant_name)).size).toBe(3);
    expect(monthly(/Storage Co\.|Self Storage/)).toBe(1000);
    const food = tx.filter((t) => t.category_id === "cat-Groceries" || t.category_id === "cat-Dining");
    const fullMonths = food.filter((t) => String(t.date) < "2026-10-01");
    const avg = -fullMonths.reduce((s, t) => s + Number(t.amount), 0) / 11;
    expect(avg).toBeGreaterThan(1350);
    expect(avg).toBeLessThan(1650);
  });

  it("has 5 software subscriptions, 2 never confirmed as used, consulting income, and debts on both cards", () => {
    expect(SAMPLE_SOFTWARE.filter((s) => !s.used).map((s) => s.name)).toEqual(["Sample Design App", "Sample Video Streaming"]);
    expect(tx.some((t) => t.merchant_name === "Sample Video Streaming")).toBe(true);
    expect(tx.filter((t) => t.category_id === "cat-Consulting Income" && Number(t.amount) > 0).length).toBeGreaterThanOrEqual(12);
    expect(rows("debts").map((d) => d.account_id).sort()).toEqual(rows("accounts").filter((a) => a.kind === "credit_card").map((a) => a.id).sort());
    expect(rows("accounts").filter((a) => a.entity_id === "e-llc")).toHaveLength(1);
  });

  it("has proprietary and brokered deals, a consulting engagement, deal-source contacts, friends, and a partner", () => {
    expect(rows("pipeline_items").map((i) => i.deal_source_type).filter(Boolean).sort()).toEqual(["brokered", "brokered", "proprietary"]);
    expect(rows("consulting_details")).toHaveLength(1);
    expect(rows("contacts").filter((c) => c.is_deal_source).length).toBeGreaterThanOrEqual(2);
    expect(rows("contacts").filter((c) => /Friend/.test(String(c.name)))).toHaveLength(2);
    expect(rows("partners")).toHaveLength(1);
    expect(rows("budget_lines").some((l) => l.category_id === "cat-Housing")).toBe(false); // an existing line is not replaced
    expect(counts.transactions).toBe(tx.length);
  });
});
