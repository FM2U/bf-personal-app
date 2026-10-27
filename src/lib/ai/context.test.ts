import { describe, expect, it } from "vitest";
import { cleanChatContext, formatPageContext, formatRecordContext } from "./context";

const ID = "3f2b8c1e-1234-4abc-9def-0123456789ab";

describe("Ask AI about this: context", () => {
  it("keeps only a known record type, an id, and short text from the browser", () => {
    expect(cleanChatContext({ table: "pipeline_items", id: ID, label: "Demo HVAC Services Co" })).toEqual({ table: "pipeline_items", id: ID, label: "Demo HVAC Services Co" });
    expect(cleanChatContext({ table: "no_such_table", id: ID, label: "X" })).toEqual({ label: "X" });
    expect(cleanChatContext({ table: "tasks", id: "drop table", label: "Y" })).toEqual({ label: "Y" });
    expect(cleanChatContext(null)).toBeNull();
    expect(cleanChatContext({ label: "  " })).toBeNull();
  });
  it("writes the record for the AI: type, title, next action, fields, linked records, tasks, activity", () => {
    const text = formatRecordContext({
      singular: "Pipeline item",
      table: "pipeline_items",
      id: ID,
      title: "Demo HVAC Services Co",
      fields: [{ label: "Stage", value: "CIM reviewed" }, { label: "Deal source", value: "Proprietary" }],
      next: { text: "Send IOI draft to broker", due: "2026-10-28" },
      linked: [{ type: "Contact", title: "Alex Example" }],
      tasks: [{ title: "Decide: IOI or pass", due: "2026-11-01" }],
      activity: [{ date: "2026-10-25", text: "call: Intro call" }],
    });
    expect(text).toContain('pipeline item "Demo HVAC Services Co"');
    expect(text).toContain(`id "${ID}"`);
    expect(text).toContain("Next required action: Send IOI draft to broker (due 2026-10-28)");
    expect(text).toContain("- Stage: CIM reviewed");
    expect(text).toContain("- Contact: Alex Example");
    expect(text).toContain("- Decide: IOI or pass (due 2026-11-01)");
    expect(text).toContain("- 2026-10-25: call: Intro call");
    expect(text).toContain("proposal Bram approves");
  });
  it("a page gives its name and address", () => {
    expect(formatPageContext({ label: "Targets", path: "/accountability/targets" })).toContain('page "Targets" (/accountability/targets)');
  });
});
