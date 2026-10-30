import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { combinedOverall, dailyLevel, dayDetailOf, EMAIL_COLORS, initiativeTiles, outcomeLine, outcomesOverall, periodText, reportSections, summaryLines, type ReportInput, type Tile } from "@/lib/calc/partner-report";

/**
 * The partner report as a PDF (the optional "Attach a PDF" choice when sending): the same header, gold line, tiles,
 * misses, and summary as the email. Made with pdf-lib (plain JavaScript, built-in Helvetica, no browser), so it runs
 * in a Vercel serverless function. Letter size, one or more pages.
 */

const W = 612;
const H = 792;
const M = 40;

function hex(c: string) {
  const n = parseInt(c.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Helvetica in a PDF can draw only Latin-1 (WinAnsi) characters: replace the rest with plain ones. */
export function pdfSafe(s: string): string {
  return String(s ?? "")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[   ]/g, " ")
    .replace(/[^\x20-\x7e\xa1-\xff]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fit(text: string, font: PDFFont, size: number, width: number): string {
  let t = pdfSafe(text);
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
  return `${t}...`;
}

export async function reportPdf(input: ReportInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`Accountability report for ${input.partnerName}`));
  doc.setCreator("BF Personal App");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const sections = reportSections(input);
  // A daily report with its day content (the focused version): outcomes, progress by initiative, changes, tomorrow.
  const day = dayDetailOf(input);
  const overall = day ? outcomesOverall(day.outcomes) : combinedOverall(sections);
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const ensure = (needed: number) => {
    if (y - needed < M) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
  };
  const text = (s: string, x: number, size: number, opts: { font?: PDFFont; color?: string } = {}) =>
    page.drawText(pdfSafe(s), { x, y, size, font: opts.font ?? regular, color: hex(opts.color ?? EMAIL_COLORS.ink) });

  // Header: label, period, overall result on the right, then the thin gold line.
  text(day ? "Daily accountability report" : "Accountability report", M, 10, { color: EMAIL_COLORS.muted });
  y -= 20;
  text(day ? periodText(day.date, day.date) : sections[0]?.period ?? "", M, 18, { font: bold });
  const pill = pdfSafe(overall.text);
  const pw = bold.widthOfTextAtSize(pill, 11) + 30;
  page.drawRectangle({ x: W - M - pw, y: y - 6, width: pw, height: 22, color: hex(EMAIL_COLORS.tint[overall.status]), borderColor: hex(EMAIL_COLORS.bar[overall.status]), borderWidth: 1 });
  page.drawCircle({ x: W - M - pw + 11, y: y + 4.5, size: 4, color: hex(EMAIL_COLORS.bar[overall.status]) });
  page.drawText(pill, { x: W - M - pw + 20, y: y + 1, size: 11, font: bold, color: hex(EMAIL_COLORS.text[overall.status]) });
  y -= 16;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: hex(EMAIL_COLORS.gold) });
  y -= 22;
  text(`For ${input.partnerName}`, M, 11);
  y -= 22;

  const gap = 8;
  const tileW = (W - 2 * M - 2 * gap) / 3;
  const tileH = 66;
  const drawTile = (t: Tile, x: number, top: number) => {
    page.drawRectangle({ x, y: top - tileH, width: tileW, height: tileH, borderColor: hex(EMAIL_COLORS.border), borderWidth: 1, color: rgb(1, 1, 1) });
    page.drawText(fit(t.label, regular, 9, tileW - 16), { x: x + 8, y: top - 15, size: 9, font: regular, color: hex(EMAIL_COLORS.muted) });
    page.drawText(fit(t.value, bold, 16, tileW - 16), { x: x + 8, y: top - 34, size: 16, font: bold, color: hex(t.status === "met" || t.status === "neutral" ? EMAIL_COLORS.ink : EMAIL_COLORS.text[t.status]) });
    const barW = tileW - 16;
    page.drawRectangle({ x: x + 8, y: top - 44, width: barW, height: 4, color: hex(EMAIL_COLORS.track) });
    const p = t.pct === null ? 0 : Math.max(0, Math.min(100, t.pct));
    if (p > 0) page.drawRectangle({ x: x + 8, y: top - 44, width: (barW * p) / 100, height: 4, color: hex(EMAIL_COLORS.bar[t.status]) });
    page.drawText(fit(t.note, regular, 8, tileW - 16), { x: x + 8, y: top - 57, size: 8, font: regular, color: hex(EMAIL_COLORS.muted) });
  };

  const lines = (items: string[], bullet = true) => {
    for (const raw of items) {
      for (const [i, l] of wrap(raw, regular, 10, W - 2 * M - 14).entries()) {
        ensure(14);
        if (bullet && i === 0) text("-", M + 2, 10);
        text(l, bullet ? M + 12 : M, 10);
        y -= 14;
      }
    }
  };
  const title = (s: string) => {
    ensure(30);
    text(s, M, 12, { font: bold });
    y -= 16;
  };
  const tileRows = (tiles: Tile[]) => {
    for (let i = 0; i < tiles.length; i += 3) {
      ensure(tileH + gap);
      tiles.slice(i, i + 3).forEach((t, j) => drawTile(t, M + j * (tileW + gap), y));
      y -= tileH + gap;
    }
  };
  if (day) {
    const level = dailyLevel(input.templates[0]);
    title("Planned outcomes");
    lines(day.outcomes.length ? day.outcomes.map(outcomeLine) : ["No outcomes were planned."], day.outcomes.length > 0);
    y -= 8;
    if (level !== "summary") {
      title("Progress by initiative");
      if (!day.initiatives.length) lines(["No activity was recorded today."], false);
      for (const g of day.initiatives) {
        ensure(16 + tileH);
        text(g.name, M, 11, { font: bold, color: EMAIL_COLORS.cobalt });
        y -= 16;
        tileRows(initiativeTiles(g));
        lines([...g.moved.map((m) => `Moved: ${m.item} to ${m.stage}`), ...g.passes.map((x) => `Passed: ${x.item}${x.reason ? ` (${x.reason})` : ""}`)]);
      }
      y -= 8;
      if (level === "detailed" && sections[0]?.tiles.length) {
        title("Today's numbers");
        tileRows(sections[0].tiles);
        y -= 8;
      }
      title("Changes in plan");
      lines([day.changes ?? "No changes."], false);
      y -= 8;
    }
    title("Tomorrow's top priority");
    lines([day.tomorrow ?? "Not set."], false);
    y -= 8;
  }

  for (const s of day ? [] : sections) {
    ensure(40 + tileH);
    text(s.template.name, M, 12, { font: bold });
    page.drawText(pdfSafe(s.period), { x: M + bold.widthOfTextAtSize(pdfSafe(s.template.name), 12) + 8, y, size: 10, font: regular, color: hex(EMAIL_COLORS.muted) });
    y -= 16;
    if (s.template.note) {
      for (const l of wrap(s.template.note, regular, 10, W - 2 * M)) {
        ensure(14);
        text(l, M, 10);
        y -= 14;
      }
    }
    y -= 2;
    for (let i = 0; i < s.tiles.length; i += 3) {
      ensure(tileH + gap);
      s.tiles.slice(i, i + 3).forEach((t, j) => drawTile(t, M + j * (tileW + gap), y));
      y -= tileH + gap;
    }
    if (!s.exact) {
      ensure(14);
      text("Some measures were not saved in this report (it was made before report templates).", M, 8, { color: EMAIL_COLORS.muted });
      y -= 14;
    }
    y -= 10;
  }

  const misses = day ? [] : [...new Set(sections.flatMap((s) => s.misses))];
  if (misses.length) {
    ensure(30);
    text("Misses", M, 12, { font: bold });
    y -= 16;
    for (const m of misses) {
      for (const [i, l] of wrap(m, regular, 10, W - 2 * M - 14).entries()) {
        ensure(14);
        if (i === 0) page.drawCircle({ x: M + 3, y: y + 3.5, size: 2.5, color: hex(EMAIL_COLORS.bar.missed) });
        text(l, M + 12, 10);
        y -= 14;
      }
    }
    y -= 8;
  }
  const summary = summaryLines(input.report.summary);
  if (summary.length) {
    ensure(30);
    text("Summary", M, 12, { font: bold });
    y -= 16;
    for (const raw of summary) {
      const bullet = raw.startsWith("- ");
      for (const [i, l] of wrap(bullet ? raw.slice(2) : raw, regular, 10, W - 2 * M - 14).entries()) {
        ensure(14);
        if (bullet && i === 0) text("-", M + 2, 10);
        text(l, M + 12, 10);
        y -= 14;
      }
    }
    y -= 8;
  }
  if (input.link) {
    ensure(30);
    text("Full report (no login needed):", M, 9, { color: EMAIL_COLORS.muted });
    y -= 13;
    text(fit(input.link, regular, 9, W - 2 * M), M, 9, { color: EMAIL_COLORS.link });
  }
  return doc.save();
}

/** File name for the attachment, for example "Accountability report 2026-10-23 to 2026-10-29.pdf". */
export function reportPdfName(start: string, end: string): string {
  return `Accountability report ${start} to ${end}.pdf`;
}
