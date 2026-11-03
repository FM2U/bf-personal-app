/**
 * The End of day report to the partner (batch C), pure and tested in src/lib/accountability/targets.test.ts:
 * the email exactly as it is sent, in the partner report layout the app already sends (the small label, the date, the
 * status pill, the hairline, the greeting, number tiles with bars, the bold tomorrow line, "Nothing is required from
 * you", "Thank you, Bram"; src/lib/calc/partner-report.ts draws the tiles, bars, and pill). Sections: Today, Deals,
 * Targets, The week (Fridays), Tomorrow or Monday, the closing lines. A short version keeps the header, the Targets
 * list with the reasons, the week tiles, and the tomorrow line. The same data makes the plain-text part.
 */
import { barHtml, EMAIL_COLORS, escapeHtml, FONT, pillHtml, type TileStatus } from "@/lib/calc/partner-report";
import { judgedMark, MARK_WORD, type Judged, type ReportTile } from "@/lib/accountability/targets";
import { hasSection } from "@/lib/accountability/partners";

export type ReportData = {
  partnerName: string;
  /** The partner's first name ("Jake"). */
  partnerFirst: string;
  /** "Friday, Oct 31, 2026". */
  dateLong: string;
  /** "Friday, Oct 31". */
  dateShort: string;
  /** The Friday report adds the week. */
  withWeek: boolean;
  pill: { text: string; status: TileStatus };
  today: ReportTile[];
  /** The Deals bullets: moves with their key finding, the waits over the threshold. */
  deals: string[];
  targets: { met: boolean; judged: boolean; line: string; commitment: boolean; reason: string | null }[];
  /** Reasons owed from a skipped day, already in words ("Wednesday, Listings screened 2 of 5: travel day"). */
  owed: string[];
  week: { label: string; tiles: ReportTile[] } | null;
  tomorrow: { label: "Tomorrow" | "Monday"; text: string | null };
  /**
   * The sections this partner gets (push B): today, targets, waiting, moved, tomorrow, week. Null or missing: every
   * section (the reports built before push B). The greeting, the pill, and the closing lines are always there.
   */
  sections?: string[] | null;
  /** The Deals bullets split in two (push B), so a partner can get the moves, the waits, or both. */
  dealMoves?: string[];
  dealWaits?: string[];
};

/** The Deals lines this partner gets, and the line shown when there are none (null: no Deals section at all). */
function dealsFor(d: ReportData): { lines: string[]; empty: string } | null {
  const moved = hasSection(d.sections, "moved");
  const waiting = hasSection(d.sections, "waiting");
  if (!moved && !waiting) return null;
  if (!d.dealMoves && !d.dealWaits) return { lines: d.deals, empty: "No move today." };
  const lines = [...(moved ? (d.dealMoves ?? []) : []), ...(waiting ? (d.dealWaits ?? []) : [])];
  return { lines, empty: moved ? "No move today." : "No deal is waiting on a broker." };
}

const p = (html: string, extra = "") => `<p style="margin:0 0 10px 0;font-size:14px;line-height:20px;color:${EMAIL_COLORS.ink};${FONT}${extra}">${html}</p>`;
const heading = (text: string) => `<div style="padding:0 0 4px 0;margin-bottom:6px;border-bottom:1px solid ${EMAIL_COLORS.border};font-size:12px;line-height:16px;letter-spacing:1px;text-transform:uppercase;color:${EMAIL_COLORS.text.neutral};${FONT}">${escapeHtml(text)}</div>`;
const muted = (text: string) => `<div style="font-size:13px;line-height:18px;color:${EMAIL_COLORS.muted};${FONT}">${escapeHtml(text)}</div>`;
const section = (inner: string) => `<tr><td style="padding:10px 20px 4px 20px">${inner}</td></tr>`;

/** One tile with an optional small part after the number ("3 of 5"), the bar, and the note; the same box as the partner report tiles. */
function tile(t: ReportTile): string {
  const color = t.status === "neutral" || t.status === "met" ? EMAIL_COLORS.ink : EMAIL_COLORS.text[t.status];
  return (
    `<div style="display:inline-block;width:100%;max-width:140px;vertical-align:top;padding:4px;box-sizing:border-box;text-align:left">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border:1px solid ${EMAIL_COLORS.border};border-radius:8px;background-color:#ffffff"><tr><td style="padding:8px 10px;${FONT}">` +
    `<div style="height:32px;overflow:hidden;font-size:12px;line-height:16px;color:${EMAIL_COLORS.muted}">${escapeHtml(t.label)}</div>` +
    `<div style="font-size:20px;line-height:26px;font-weight:bold;white-space:nowrap;color:${color}">${escapeHtml(t.value)}${t.small ? ` <span style="font-size:12px;font-weight:normal;color:${EMAIL_COLORS.muted}">${escapeHtml(t.small)}</span>` : ""}</div>` +
    (t.pct !== null ? barHtml(t.pct, t.status) : `<div style="height:14px;line-height:14px;font-size:0">&nbsp;</div>`) +
    `<div style="height:30px;overflow:hidden;font-size:11px;line-height:15px;color:${EMAIL_COLORS.muted}">${escapeHtml(t.note)}</div>` +
    `</td></tr></table></div>`
  );
}

function tiles(list: ReportTile[]): string {
  return `<div style="font-size:0;line-height:0;text-align:left;margin:0 -4px">${list.map(tile).join("")}</div>`;
}

function targetRows(d: ReportData): string {
  const rows = d.targets.map((t) => {
    // Met as soon as reached, under way while below target and not yet judged (Edit batch C round 2, item 7).
    const mark = judgedMark(t);
    const st: TileStatus = mark === "now" ? "neutral" : mark;
    const word = MARK_WORD[mark];
    const reason = t.judged && !t.met && t.commitment ? `<div style="font-size:13px;line-height:18px;color:${EMAIL_COLORS.muted}">Commitment. ${escapeHtml(t.reason?.trim() || "(reason still to give)")}</div>` : "";
    return (
      `<tr><td valign="top" width="14" style="width:14px;padding:3px 0;color:${EMAIL_COLORS.bar[st]};font-size:13px;line-height:18px;${FONT}">&#9679;</td>` +
      `<td style="padding:3px 0 5px 0;font-size:13px;line-height:18px;color:${EMAIL_COLORS.ink};${FONT}"><span style="font-weight:bold;color:${st === "neutral" ? EMAIL_COLORS.muted : EMAIL_COLORS.text[st]}">${word}</span>&nbsp; ${escapeHtml(t.line)}${reason}</td></tr>`
    );
  });
  const owed = d.owed.map((o) => `<tr><td valign="top" width="14" style="width:14px;padding:3px 0;color:${EMAIL_COLORS.bar.missed};font-size:13px;line-height:18px;${FONT}">&#9679;</td><td style="padding:3px 0 5px 0;font-size:13px;line-height:18px;color:${EMAIL_COLORS.ink};${FONT}"><span style="font-weight:bold;color:${EMAIL_COLORS.text.missed}">Owed</span>&nbsp; ${escapeHtml(o)}</td></tr>`);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">${[...rows, ...owed].join("")}</table>`;
}

function headerRows(d: ReportData, short: boolean): string[] {
  return [
    `<tr><td style="padding:16px 20px 12px 20px">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>` +
      `<td valign="middle" style="${FONT}"><div style="font-size:12px;line-height:16px;color:${EMAIL_COLORS.muted}">${d.withWeek ? "Daily report, with the week" : "Daily report"}${short ? ", short version" : ""}</div>` +
      `<div style="font-size:18px;line-height:24px;font-weight:bold;color:${EMAIL_COLORS.ink}">${escapeHtml(d.dateLong)}</div></td>` +
      `<td valign="middle" align="right" style="${FONT}">${pillHtml(d.pill)}</td>` +
      `</tr></table></td></tr>`,
    `<tr><td style="padding:0 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="height:1px;line-height:1px;font-size:0;background-color:${EMAIL_COLORS.rule}">&nbsp;</td></tr></table></td></tr>`,
  ];
}

function closingRows(d: ReportData): string {
  return (
    (hasSection(d.sections, "tomorrow") ? section(heading(d.tomorrow.label) + (d.tomorrow.text ? `<div style="font-size:14px;line-height:20px;font-weight:bold;color:${EMAIL_COLORS.ink};${FONT}">${escapeHtml(d.tomorrow.text)}</div>` : muted("(no line yet)"))) : "") +
    `<tr><td style="padding:14px 20px 18px 20px">${p("Nothing is required from you. Reply to this email if you want to talk.", `;color:${EMAIL_COLORS.muted};font-size:13px`)}${p("Thank you,<br>Bram", ";margin-bottom:0")}</td></tr>`
  );
}

/** The inner card of the email (what the End of day preview and the Sent report drawer show). */
export function reportInnerHtml(d: ReportData, short = false): string {
  const parts = headerRows(d, short);
  parts.push(`<tr><td style="padding:14px 20px 0 20px">${p(`Hello ${escapeHtml(d.partnerFirst)},`)}${p(short ? `The short version for ${escapeHtml(d.dateShort)}.` : `Here is my report for ${escapeHtml(d.dateShort)}.${d.withWeek ? " It is Friday, so the week is at the end." : ""}`)}</td></tr>`);
  if (!short) {
    if (hasSection(d.sections, "today")) parts.push(section(heading("Today") + tiles(d.today)));
    const deals = dealsFor(d);
    if (deals) parts.push(section(heading("Deals") + (deals.lines.length ? `<ul style="margin:0;padding-left:18px;font-size:13px;line-height:19px;color:${EMAIL_COLORS.ink};${FONT}">${deals.lines.map((x) => `<li style="margin:0 0 4px 0">${escapeHtml(x)}</li>`).join("")}</ul>` : muted(deals.empty))));
  }
  if (hasSection(d.sections, "targets")) parts.push(section(heading("Targets") + (d.targets.length ? targetRows(d) : muted("No targets yet."))));
  if (d.week && hasSection(d.sections, "week")) parts.push(section(heading(d.week.label) + tiles(d.week.tiles)));
  parts.push(closingRows(d));
  return `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;background-color:#ffffff;border:1px solid ${EMAIL_COLORS.border};border-radius:10px">${parts.join("")}</table>`;
}

export function reportSubject(d: ReportData): string {
  return `${d.withWeek ? "Daily report with the week" : "Daily report"}: ${d.dateLong}`;
}

/** The plain-text part, from the same data (the edited HTML uses the HTML-to-text reader instead). */
export function reportText(d: ReportData, short = false): string {
  const lines: string[] = [`Hello ${d.partnerFirst},`, "", short ? `The short version for ${d.dateShort}.` : `Here is my report for ${d.dateShort}.${d.withWeek ? " It is Friday, so the week is at the end." : ""}`, `${d.pill.text}.`];
  const tileLines = (list: ReportTile[]) => list.map((t) => `- ${t.label}: ${t.value}${t.small ? ` ${t.small}` : ""}${t.note ? ` (${t.note})` : ""}`);
  if (!short) {
    if (hasSection(d.sections, "today")) lines.push("", "TODAY", ...tileLines(d.today));
    const deals = dealsFor(d);
    if (deals) lines.push("", "DEALS", ...(deals.lines.length ? deals.lines.map((x) => `- ${x}`) : [deals.empty]));
  }
  if (hasSection(d.sections, "targets")) {
    lines.push("", "TARGETS");
    for (const t of d.targets) lines.push(`- ${MARK_WORD[judgedMark(t)]}: ${t.line}${t.judged && !t.met && t.commitment ? ` Commitment. ${t.reason?.trim() || "(reason still to give)"}` : ""}`);
    for (const o of d.owed) lines.push(`- Owed: ${o}`);
  }
  if (d.week && hasSection(d.sections, "week")) lines.push("", d.week.label.toUpperCase(), ...tileLines(d.week.tiles));
  if (hasSection(d.sections, "tomorrow")) lines.push("", d.tomorrow.label.toUpperCase(), d.tomorrow.text || "(no line yet)");
  lines.push("", "Nothing is required from you. Reply to this email if you want to talk.", "", "Thank you,", "Bram");
  return lines.join("\n");
}

/** The Deals bullets: each move with its key finding, then the waits over the threshold. */
export function dealBullets(moves: { name: string; to: string; keyFinding: string | null }[], waits: { name: string; days: number; who: string | null }[], threshold: number): string[] {
  const parts = dealBulletParts(moves, waits, threshold);
  return [...parts.moves, ...parts.waits];
}

/** The Deals bullets in two parts (push B): the moves, and the one waits line. */
export function dealBulletParts(moves: { name: string; to: string; keyFinding: string | null }[], waits: { name: string; days: number; who: string | null }[], threshold: number): { moves: string[]; waits: string[] } {
  return {
    moves: moves.map((m) => `${m.name} moved to ${m.to}.${m.keyFinding ? ` Key finding: ${m.keyFinding.replace(/\.?$/, ".")}` : ""}`),
    waits: waits.length ? [`Waiting on brokers over ${threshold} days: ${waits.map((w) => `${w.name} (${w.days} days${w.who ? `, ${w.who}` : ""})`).join(", ")}.`] : [],
  };
}

/**
 * "Met: Listings screened 5 of 5 today, 19 of 25 this week" as the target line of the email (the word is drawn by the
 * row). The week's number is the target times the weekdays counted so far (less a skipped day), as on Targets: on a
 * Wednesday "13 of 15", on Friday "19 of 25".
 */
export function targetLine(j: Judged, weekSum: number | null, countedDays = 5): string {
  if (j.key === "rosara_focus_done") return `${j.name}${j.met ? "" : " not yet"}`;
  const base = `${j.name} ${j.figure}`;
  return j.cadence === "day" && weekSum !== null ? `${base} today, ${weekSum} of ${j.number * Math.max(1, countedDays)} this week` : base;
}

/** "3 of 6 targets met" (Friday) or "Listings screened met" / "2 targets missed" for the pill. */
export function pillOf(judged: readonly Judged[], withWeek: boolean): { text: string; status: TileStatus } {
  const today = judged.filter((j) => j.judged);
  if (!today.length) return { text: "No targets judged today", status: "neutral" };
  const met = today.filter((j) => j.met).length;
  if (withWeek || today.length > 1) return { text: `${met} of ${today.length} targets met`, status: met === today.length ? "met" : "missed" };
  return { text: `${today[0].name} ${today[0].met ? "met" : "missed"}`, status: today[0].met ? "met" : "missed" };
}

/** One partner's copy of the day's report (push B): their name in the greeting and only their sections. */
export function reportFor(base: ReportData, partner: { name: string; first: string; sections: readonly string[] }): ReportData {
  return { ...base, partnerName: partner.name, partnerFirst: partner.first, sections: [...partner.sections] };
}
