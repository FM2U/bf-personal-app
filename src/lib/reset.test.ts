import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { DEFAULT_INITIATIVES, exportIsRecent, RESET_DELETE_TABLES, RESET_KEEP_TABLES, RESET_PARTIAL_TABLES, resetSummaryRows } from "./reset";
import { EXPORT_TABLES } from "./resources";

const dir = path.join(__dirname, "../../supabase/migrations");
const sql = readFileSync(path.join(dir, "0014_initiative_builder_reset.sql"), "utf8");
const fn = sql.slice(sql.indexOf("create or replace function public.reset_all_data"));
const listIn = (name: string, text: string) => text.match(new RegExp(`${name} text\\[\\] := array\\[([\\s\\S]*?)\\];`))![1].match(/'([^']+)'/g)!.map((s) => s.slice(1, -1));

describe("Reset all data: keep and delete lists", () => {
  it("the database function deletes exactly RESET_DELETE_TABLES, in the same order", () => {
    expect(listIn("delete_order", fn)).toEqual([...RESET_DELETE_TABLES]);
  });

  it("keeps the default initiatives named in the function", () => {
    expect(listIn("default_initiatives", fn)).toEqual(DEFAULT_INITIATIVES);
  });

  it("every table in the database is in exactly one list (delete, partial, or keep)", () => {
    const tables = new Set<string>();
    for (const f of readdirSync(dir)) for (const m of readFileSync(path.join(dir, f), "utf8").matchAll(/create table (?:if not exists )?public\.([a-z_]+)/g)) tables.add(m[1]);
    const lists = [...RESET_DELETE_TABLES, ...RESET_PARTIAL_TABLES, ...RESET_KEEP_TABLES];
    expect(new Set(lists).size).toBe(lists.length);
    expect([...tables].sort()).toEqual([...lists].sort());
  });

  it("keeps the setup the owner asked to keep", () => {
    for (const t of ["pipelines", "pipeline_stages", "stage_tasks", "targets", "task_templates", "categories", "categorization_rules", "inputs", "owner_profile", "google_connections", "plaid_items", "ai_usage", "change_log"]) {
      expect(RESET_KEEP_TABLES as readonly string[]).toContain(t);
    }
    for (const t of ["transactions", "accounts", "contacts", "pipeline_items", "tasks", "documents", "checklists", "ai_conversations", "record_links", "decision_conditions"]) {
      expect(RESET_DELETE_TABLES as readonly string[]).toContain(t);
    }
  });

  it("every exported table is covered", () => {
    const lists = new Set<string>([...RESET_DELETE_TABLES, ...RESET_PARTIAL_TABLES, ...RESET_KEEP_TABLES]);
    for (const t of EXPORT_TABLES) expect(lists.has(t)).toBe(true);
  });

  it("the function checks the owner and the typed RESET, and resets target start dates", () => {
    expect(fn).toMatch(/not public\.is_owner\(v_owner\)/);
    expect(fn).toMatch(/<> 'RESET'/);
    expect(fn).toMatch(/update targets set start_date = v_today/);
    expect(fn).toMatch(/'all_data_reset'/);
  });
});

describe("Reset all data: export first, and the summary", () => {
  it("needs an export downloaded in the last 2 hours", () => {
    const now = new Date("2026-10-27T15:00:00Z");
    expect(exportIsRecent("2026-10-27T14:10:00.000Z", now)).toBe(true);
    expect(exportIsRecent(encodeURIComponent("2026-10-27T14:10:00.000Z"), now)).toBe(true);
    expect(exportIsRecent("2026-10-27T12:30:00.000Z", now)).toBe(false);
    expect(exportIsRecent(null, now)).toBe(false);
    expect(exportIsRecent("yesterday", now)).toBe(false);
  });

  it("lists deleted counts largest first without zeros", () => {
    expect(resetSummaryRows({ transactions: 420, accounts: 5, notes: 0 })).toEqual([
      { table: "transactions", label: "Transactions", count: 420 },
      { table: "accounts", label: "Accounts", count: 5 },
    ]);
  });
});
