import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PDFDocument } from "pdf-lib";
import { pdfSafe, reportPdf, reportPdfName } from "./report-pdf";
import { STARTER_TEMPLATES } from "./calc/partner-report";
import { buildMimeMessage, safeFileName } from "./gmail-mime";

const week = {
  start: "2026-10-23",
  end: "2026-10-29",
  commitments: { met: 9, missed: 1, pct: 90, missedTitles: ["Call “Sample” Broker – today"] },
  tasks: { done: 12, overdue: 3 },
  moves: Array.from({ length: 6 }, (_, i) => ({ pipeline: `Pipeline ${i + 1}`, count: i })),
};
const input = {
  partnerName: "Sample Partner A",
  report: { period_start: "2026-10-23", period_end: "2026-10-29", summary: "- One\n- Two", snapshot: { measures: { week, two_weeks: week, month: week } } },
  templates: [STARTER_TEMPLATES[2], STARTER_TEMPLATES[0]],
  link: "https://app.example.com/report/abc",
};

describe("partner report PDF", () => {
  it("makes a valid PDF with the report on it", async () => {
    const bytes = await reportPdf(input);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getTitle()).toBe("Accountability report for Sample Partner A");
  });
  it("replaces characters the PDF font cannot draw", () => {
    expect(pdfSafe("“Quote” – dash… 😀")).toBe('"Quote" - dash... ??');
    expect(reportPdfName("2026-10-23", "2026-10-29")).toBe("Accountability report 2026-10-23 to 2026-10-29.pdf");
  });
});

describe("email with an attachment", () => {
  it("wraps the two message parts in multipart/mixed and attaches the file", () => {
    const raw = buildMimeMessage({ to: "a@example.com", subject: "S", body: "Text", html: "<table><tr><td>Hi</td></tr></table>", attachments: [{ filename: "Report: 1/2.pdf", contentType: "application/pdf", data: new Uint8Array([37, 80, 68, 70]) }], boundary: "B" });
    expect(raw).toContain('Content-Type: multipart/mixed; boundary="B_mixed"');
    expect(raw).toContain('Content-Type: multipart/alternative; boundary="B"');
    expect(raw).toContain('Content-Disposition: attachment; filename="Report 12.pdf"');
    expect(raw.trimEnd().endsWith("--B_mixed--")).toBe(true);
    const html = raw.split("Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n")[1].split("\r\n--B")[0];
    expect(Buffer.from(html.replace(/\r\n/g, ""), "base64").toString()).toContain("<table><tr><td>Hi</td></tr></table>");
  });
  it("keeps the app's HTML as is (no editor cleaning) and stays multipart/alternative without files", () => {
    const raw = buildMimeMessage({ to: "a@example.com", subject: "S", body: "Text", html: '<table style="max-width:600px"><tr><td>Hi</td></tr></table>', boundary: "B" });
    expect(raw).toContain('Content-Type: multipart/alternative; boundary="B"');
    expect(raw).not.toContain("multipart/mixed");
    expect(safeFileName("Ré/port<>.pdf")).toBe("Report.pdf");
  });
});
