/**
 * The End of day report to a partner (batch C; push B edits, 2026-11-03), pure and tested in
 * src/lib/accountability/report-email.test.ts: the email exactly as it is sent. The header (the small label, the
 * date, the status pill, the hairline), the greeting, then each section the partner gets today
 * (src/lib/accountability/report-sections.ts): number tiles for Today and The week, parent and child bullets for
 * every list section, the bold tomorrow line, and today's note under a section (thin rule on the left); then "Nothing is required from you" and "Thank you, Bram". Inline
 * styles and simple ul/li only, so it reads well in Gmail. The same parts make the report window on End of day, so
 * what Bram reviews is what is sent. The same data makes the plain-text part.
 */
import { barHtml, EMAIL_COLORS, escapeHtml, FONT, pillHtml, type TileStatus } from "@/lib/calc/partner-report";
import { judgedMark, MARK_WORD, type Judged, type ReportTile } from "@/lib/accountability/targets";
import { blocksText, boxText, buildSections, parseEdited, pickText, pipelineText, sentSections, tilesText, workedText, type Block, type BuiltSection, type Line, type ReportChoices, type ReportData } from "@/lib/accountability/report-sections";
import { subjectCounts, type TodayCount, type WorkedRecord } from "@/lib/accountability/report-worked";
import type { PipelineCol, ReportPick } from "@/lib/accountability/report-v8";
import { signOff } from "@/lib/work/names";
import { openingInlineHtml, openingLines, openingPlain } from "@/lib/accountability/opening-format";

export type { ReportData, ReportChoices };

const C = EMAIL_COLORS;
const p = (html: string, extra = "") => `<p style="margin:0 0 8px 0;font-size:14px;line-height:20px;color:${C.ink};${FONT}${extra}">${html}</p>`;
/** The note look (fix list item 6): dark text, a 3px cobalt left line. Also the tomorrow line's look (2026-11-06). */
const NOTE_STYLE = `margin:6px 0 8px 0;padding:2px 0 2px 10px;border-left:3px solid ${C.cobalt};font-size:13px;line-height:19px;color:${C.ink};${FONT}`;
const muted = (text: string) => `<div style="font-size:13px;line-height:18px;color:${C.muted};${FONT}">${escapeHtml(text)}</div>`;

/** The small-caps heading over a section, on a hairline. */
export function headingHtml(text: string): string {
  return `<div style="padding:0 0 4px 0;margin-bottom:8px;border-bottom:1px solid ${C.border};font-size:11px;line-height:16px;letter-spacing:1px;text-transform:uppercase;font-weight:bold;color:${C.text.neutral};${FONT}">${escapeHtml(text)}</div>`;
}

/** One tile: the label, the number with its small part ("3 of 5"), the bar, and the note. */
function tile(t: ReportTile): string {
  const color = t.status === "missed" ? C.text.missed : t.status === "met" ? C.text.met : C.ink;
  return (
    `<div data-tile="1" style="display:inline-block;width:100%;max-width:180px;vertical-align:top;padding:3px;box-sizing:border-box;text-align:left">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border:1px solid ${C.border};border-radius:8px;background-color:#ffffff"><tr><td style="padding:8px 10px;${FONT}">` +
    `<div style="font-size:12px;line-height:16px;color:${C.muted}">${escapeHtml(t.label)}</div>` +
    `<div style="font-size:19px;line-height:24px;font-weight:bold;white-space:nowrap;color:${color}">${escapeHtml(t.value)}${t.small ? ` <span style="font-size:12px;font-weight:normal;color:${C.muted}">${escapeHtml(t.small)}</span>` : ""}</div>` +
    (t.pct !== null ? barHtml(t.pct, t.status) : "") +
    (t.note ? `<div style="font-size:11px;line-height:15px;color:${C.muted}">${escapeHtml(t.note)}</div>` : "") +
    // Monday's report (Bram, 2026-11-09): the weekend's number under a hairline, in the small gray of "of 5", the number bold.
    (t.weekend !== undefined ? `<div data-weekend="1" style="margin-top:6px;padding-top:4px;border-top:1px solid ${C.border};font-size:12px;line-height:16px;color:${C.muted}">Weekend <b>${escapeHtml(t.weekend)}</b></div>` : "") +
    `</td></tr></table></div>`
  );
}

function tilesHtml(list: readonly ReportTile[]): string {
  return `<div style="font-size:0;line-height:0;text-align:left;margin:0 -3px">${list.map(tile).join("")}</div>`;
}

const TONE: Record<string, string> = { red: C.text.missed, amber: C.text.soon, green: C.text.met };

function lineHtml(l: Line): string {
  return `${l.lead ? `<b>${escapeHtml(l.lead)}:</b> ` : ""}${l.label ? `<span style="color:${C.muted}">${escapeHtml(l.label)}:</span> ` : ""}${escapeHtml(l.text)}${l.todo ? `<span style="color:${C.text.soon}">${escapeHtml(l.todo)}</span>` : ""}`;
}

const UL = `margin:2px 0 0 0;padding:0 0 0 18px;list-style-type:disc;font-size:13px;line-height:19px;color:${C.ink};${FONT}`;
const LI = "margin:0 0 2px 0";

/** Parent and child bullets: the parent line in bold (red, amber, green, or ink), its children as a simple list. */
export function blocksHtml(blocks: readonly Block[]): string {
  return blocks
    .map((b) => {
      const title = b.title ? `<div style="font-size:13px;line-height:19px;font-weight:bold;color:${b.tone ? TONE[b.tone] : C.ink};${FONT}">${escapeHtml(b.title)}</div>` : "";
      const items = b.items.length ? `<ul style="${UL}">${b.items.map((it) => `<li style="${LI}">${lineHtml(it.line)}${it.sub?.length ? `<ul style="${UL};margin-top:1px;list-style-type:circle;color:${C.muted}">${it.sub.map((s) => `<li style="${LI}">${lineHtml(s)}</li>`).join("")}</ul>` : ""}</li>`).join("")}</ul>` : "";
      return `<div style="margin:0 0 8px 0">${title}${items}</div>`;
    })
    .join("");
}

/**
 * The opening as sent (2026-11-23, the approved layout H mockup: claude/2026-11-23-report-layout-h.html): a bold
 * heading on its own line for each kind of work, its one or two bullets under it in the quiet color. A line right above
 * bullets is a heading whether or not it carries bold marks; "**words**" anywhere else is bold; a line with no bullets
 * under it (an opening written as sentences) reads as plain text. `h` is layout H's calm type; `lead` the space above
 * the first line.
 */
export function openingBodyHtml(text: string, h = false, lead = 0): string {
  const lines = openingLines(text);
  const size = h ? `font-size:14.5px;line-height:23px;${H_FONT}` : `font-size:13px;line-height:19px;${FONT}`;
  const ink = h ? H.ink : C.ink;
  const quiet = h ? H.ink2 : C.muted;
  const ul = `margin:${h ? 6 : 2}px 0 0 0;padding:0 0 0 18px;list-style-type:disc;${size};color:${quiet}`;
  const li = `margin:${h ? 2 : 0}px 0 ${h ? 0 : 2}px 0`;
  let html = "";
  let inList = false;
  lines.forEach((l, i) => {
    if (l.bullet) {
      if (!inList) html += `<ul style="${ul}">`;
      inList = true;
      html += `<li style="${li}">${openingInlineHtml(l.text)}</li>`;
      return;
    }
    if (inList) html += "</ul>";
    inList = false;
    const heading = !!lines[i + 1]?.bullet;
    // A heading is bold as a whole, so its own marks are left out.
    const inner = heading ? openingInlineHtml(l.text.replace(/\*\*/g, "")) : openingInlineHtml(l.text);
    html += `<div${heading ? ' data-opening-heading="1"' : ""} style="${size};color:${ink};margin:${i ? (heading ? (h ? 14 : 6) : h ? 10 : 4) : lead}px 0 0 0;${heading ? `font-weight:${h ? 600 : "bold"};` : ""}">${inner}</div>`;
  });
  if (inList) html += "</ul>";
  return `<div data-opening="1">${html}</div>`;
}

/** A section as rewritten with Edit: lines starting with "- " become bullets (indent for a level deeper). */
export function editedHtml(text: string, h = false): string {
  const lines = parseEdited(text);
  const size = h ? `font-size:14.5px;line-height:23px;color:${H.ink};${H_FONT}` : `font-size:13px;line-height:19px;color:${C.ink};${FONT}`;
  const ul = h ? `margin:4px 0 0 0;padding:0 0 0 18px;list-style-type:disc;${size}` : UL;
  let html = "";
  let open = 0;
  const close = (to: number) => {
    while (open > to) {
      html += "</li></ul>";
      open--;
    }
  };
  lines.forEach((l, i) => {
    if (!l.bullet) {
      close(0);
      const parent = lines[i + 1]?.bullet;
      html += `<div style="${size};${parent ? `font-weight:${h ? 600 : "bold"};margin-top:${h ? 14 : 4}px;` : "margin:0 0 4px 0;"}">${escapeHtml(l.text)}</div>`;
      return;
    }
    if (l.depth > open) {
      while (open < l.depth) {
        html += `<ul style="${ul}${open ? `;color:${h ? H.ink2 : C.muted}` : ""}"><li style="${LI}">`;
        open++;
      }
    } else {
      close(l.depth);
      html += `</li><li style="${LI}">`;
    }
    html += escapeHtml(l.text);
  });
  close(0);
  return html;
}

// ---------- The new layout (v8, approved 2026-11-15: claude/2026-11-15-report-redesign-decisions-log.md) ----------

const STRENGTH: Record<string, { label: string; color: string }> = { hot: { label: "Hot", color: "#dc2626" }, warm: { label: "Warm", color: "#d97706" }, cold: { label: "Cold", color: "#2563eb" } };
const MUTED_SPAN = (t: string) => `<span style="color:${C.muted}">${t}</span>`;

/**
 * One pick: its number in cobalt, the name in bold with its facts, the stage chip and How strong, then Why, Now, Next.
 * Spacing (Bram, 2026-11-16): the line spacing stays 19 px; gaps between the lines instead (about 6 px above the chip
 * row, 10 px above Why, 5 px above Now and Next; 16 px between picks), and the labels in the number's cobalt. Each line
 * is a table row with top padding, which Gmail and every Outlook show the same.
 */
export function pickHtml(pk: ReportPick, last: boolean): string {
  const st = pk.strength ? STRENGTH[pk.strength] : null;
  const facts = [
    pk.stage ? `<span style="display:inline-block;padding:0 7px;border-radius:999px;border:1px solid ${C.border};background:#f8fafc;font-size:11.5px;line-height:17px;color:#334155">${escapeHtml(pk.stage)}</span>` : "",
    st ? `<span style="font-size:11.5px;font-weight:bold;color:${st.color}">&#9679; ${st.label}</span>` : "",
    pk.since ? `<span style="font-size:11.5px;color:${C.muted}">${st || pk.stage ? "&middot; " : ""}${escapeHtml(pk.since)}</span>` : "",
    pk.moved ? `<span style="font-size:11.5px;font-weight:bold;color:${C.text.met}">&middot; &#9650; ${escapeHtml(pk.moved)}</span>` : "",
  ].filter(Boolean).join(" ");
  const label = (t: string) => `<span style="color:${C.cobalt}">${t}</span>`;
  // One table row per line, the gap as the cell's top padding: classic Outlook for Windows ignores padding on a div.
  const row = (gap: number, html: string) => `<tr><td style="padding-top:${gap}px;font-size:13px;line-height:19px;color:${C.ink};${FONT}">${html}</td></tr>`;
  const lines = [
    row(0, `<b>${escapeHtml(pk.name)}</b>${pk.meta ? ` ${MUTED_SPAN(`&middot; ${escapeHtml(pk.meta)}`)}` : ""}`),
    facts ? row(6, facts) : "",
    pk.why ? row(10, `${label("Why:")} ${escapeHtml(pk.why)}`) : "",
    pk.now ? row(pk.why ? 5 : 10, `${label("Now:")} ${escapeHtml(pk.now)}`) : "",
    pk.next ? row(pk.why || pk.now ? 5 : 10, `${label("Next:")} ${pk.next.amber ? `<span style="color:${C.text.soon}">${escapeHtml(pk.next.words)}</span>` : escapeHtml(pk.next.words)}`) : "",
  ].filter(Boolean);
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" data-pick="1" style="border-collapse:collapse;margin-bottom:${last ? 4 : 16}px"><tr>` +
    `<td width="22" valign="top" style="font-size:13px;line-height:19px;font-weight:bold;color:${C.cobalt};${FONT}">${pk.number}</td>` +
    `<td valign="top" style="font-size:13px;line-height:19px;color:${C.ink};${FONT}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">${lines.join("")}</table></td></tr></table>`
  );
}

/** "Decided this week: ..." under the picks, lined up with the names. */
function decidedHtml(t: string): string {
  return `<div data-decided="1" style="font-size:12px;line-height:17px;color:${C.muted};margin:2px 0 6px 22px;${FONT}"><b style="color:#334155">Decided this week:</b> ${escapeHtml(t)}.</div>`;
}

/** The Pipeline table of the older layout (v8 picks, before release 4): kept for reports built that way. */
export function pipelineHtmlV8(cols: readonly PipelineCol[]): string {
  const cell = "padding:3px 6px;font-size:13px;line-height:18px;font-weight:bold;border-left:1px solid #eef1f4";
  const head = cols.map((c) => `<td align="center" style="padding:6px 6px 4px 6px;font-size:11px;line-height:14px;color:${C.muted};border-left:1px solid #eef1f4;${FONT}">${escapeHtml(c.label)}</td>`).join("");
  const added = cols.map((c) => `<td align="center" style="${cell};color:${c.added ? C.text.met : "#cbd5e1"};${FONT}">${c.added ? `+${c.added}` : "&ndash;"}</td>`).join("");
  const inStage = cols.map((c) => (c.inStage === null ? `<td align="center" style="${cell};font-weight:normal;color:#cbd5e1;${FONT}">&ndash;</td>` : `<td align="center" style="padding:3px 6px 6px 6px;font-size:15px;line-height:20px;font-weight:bold;color:${C.ink};border-left:1px solid #eef1f4;${FONT}">${c.inStage}</td>`)).join("");
  const label = (t: string) => `<td style="padding:3px 10px 3px 10px;font-size:11px;line-height:14px;color:${C.muted};white-space:nowrap;${FONT}">${t}</td>`;
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" data-pipeline="1" style="margin:17px 0 15px 0;border-collapse:separate;border:1px solid ${C.border};border-radius:8px;background:#f8fafc;width:100%;table-layout:fixed"><col style="width:118px">` +
    `<tr><td width="118" style="padding:6px 10px 4px 10px;font-size:10.5px;line-height:14px;letter-spacing:1px;text-transform:uppercase;font-weight:bold;color:#334155;${FONT}">Pipeline</td>${head}</tr>` +
    `<tr>${label("Added this week")}${added}</tr><tr>${label("In stage today")}${inStage}</tr></table>`
  );
}

// ---------- Layout H (Bram, 2026-11-23: claude/2026-11-23-report-layout-h.html) ----------
//
// Calm cards on the paper color: the opening card with the six day counts, one card per record worked on today
// (numbered 1 to N, "◆ top priority" for a pick), Today and Next, then Upside and Size under a hairline, the pipeline
// card per track, and the tomorrow line and the week in one card. Tables and inline styles only (Gmail, Apple Mail,
// Outlook); labels and text share one line height on the same baseline, so a label stays level with the first line
// of its text however many lines the text runs.

export const H = { paper: "#faf9f7", card: "#ffffff", ink: "#1c1917", ink2: "#635d58", faint: "#8b847e", line: "#ecebe8", hair: "#f1f0ee", rowLine: "#f4f3f1", indigo: "#3b4a8c", hot: "#c2410c", warm: "#b5650d", cold: "#4a6fa5", ok: "#3f7d58", amber: "#b5650d", zero: "#c9c6c2" } as const;
export const H_FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
/** The widest the report gets (Bram, 2026-11-23: 640px; a phone shows it at its own width). */
export const H_WIDTH = 640;
const H_STRENGTH: Record<string, { label: string; color: string }> = { hot: { label: "Hot", color: H.hot }, warm: { label: "Warm", color: H.warm }, cold: { label: "Cold", color: H.cold } };
const LH = "22px";

/** A white card on the paper: 12px corners, a hairline border. */
function cardHtml(inner: string, pad = "22px 24px 18px 24px", gap = 10, attr = ""): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"${attr} style="border-collapse:separate;margin-top:${gap}px;background-color:${H.card};border:1px solid ${H.line};border-radius:12px"><tr><td style="padding:${pad};${H_FONT};color:${H.ink}">${inner}</td></tr></table>`;
}

/** A small-capitals label (MONDAY, THE WEEK, STAGE). */
function capsHtml(t: string, extra = ""): string {
  return `<div style="font-size:11px;line-height:16px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;color:${H.faint};${H_FONT}${extra}">${escapeHtml(t)}</div>`;
}

/** A label in the fixed 56px column and its text, on the same baseline (Bram, 2026-11-23). */
function labeledRow(label: string, html: string, o: { size?: string; color?: string; top?: number } = {}): string {
  const top = o.top ?? 10;
  return `<tr><td width="56" style="width:56px;vertical-align:baseline;padding-top:${top}px;font-size:12.5px;line-height:${LH};color:${H.faint};${H_FONT}">${escapeHtml(label)}</td><td style="vertical-align:baseline;padding-top:${top}px;font-size:${o.size ?? "14.5px"};line-height:${LH};color:${o.color ?? H.ink};${H_FONT}">${html}</td></tr>`;
}

/** "ask for tax returns, Mon, Nov 23" with the date in gray after a dot. */
function nextHtml(next: string): string {
  const m = /^(.*), ((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]{2} \d{1,2})$/.exec(next);
  return m ? `${escapeHtml(m[1])} <span style="color:${H.faint}">&middot; ${escapeHtml(m[2])}</span>` : escapeHtml(next);
}

/** "moved from Broker call today" as "▲ moved up from Broker call". */
function movedWords(moved: string): string {
  const m = /^moved from (.+?)(?: today)?$/.exec(moved);
  return m ? `moved up from ${m[1]}` : moved;
}

/** The Size line: small gray label, bold figure, a thin divider between figures. */
function sizeHtml(size: readonly { label: string; value: string }[]): string {
  const divider = `<span style="display:inline-block;width:1px;height:12px;background-color:${H.line};margin:0 16px;vertical-align:-1px"></span>`;
  return size.map((f) => `<span style="white-space:nowrap"><span style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${H.faint}">${escapeHtml(f.label)}</span>&nbsp;&nbsp;<span style="font-size:14px;font-weight:600;color:${H.ink}">${escapeHtml(f.value)}</span></span>`).join(divider);
}

/**
 * One record worked on today (layout H): its number (1 to N, in the order shown), the name, "◆ top priority" at the
 * right for a pick, the line with the stage, How strong, day N or "new today" and "▲ moved up from X"; Today and Next;
 * under a hairline the Upside and the Size line (each only when there is one).
 */
export function workedHtml(w: WorkedRecord, n: number): string {
  const st = w.strength ? H_STRENGTH[w.strength] : null;
  const since = w.since ? w.since.replace(/ since (first contact|start)$/, "") : null;
  const status = [
    w.stage ? escapeHtml(w.stage) : "",
    st ? `<span style="color:${st.color}">&#9679; ${st.label}</span>` : "",
    since ? escapeHtml(since) : "",
    w.moved ? `<span style="color:${H.ok}">&#9650; ${escapeHtml(movedWords(w.moved))}</span>` : "",
  ].filter(Boolean).join(" &middot; ");
  const pick = typeof w.mark === "number";
  const num = `<div style="width:22px;height:22px;border-radius:11px;border:1px solid ${H.line};background-color:${H.paper};color:${H.ink2};font-size:12px;font-weight:600;line-height:20px;text-align:center;box-sizing:border-box;${H_FONT}">${n}</div>`;
  const top =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>` +
    `<td width="34" valign="top" style="width:34px;vertical-align:top">${num}</td>` +
    `<td valign="top" style="vertical-align:top;${H_FONT}"><div style="font-size:16px;font-weight:600;line-height:${LH};color:${H.ink}">${escapeHtml(w.name)}</div>${status ? `<div style="font-size:13px;line-height:20px;color:${H.ink2};margin-top:6px">${status}</div>` : ""}</td>` +
    `<td valign="top" align="right" style="vertical-align:top;text-align:right;line-height:${LH};white-space:nowrap;${H_FONT}">${pick ? `<span data-priority="1" style="font-size:12.5px;color:${H.indigo}"><span style="font-size:11px">&#9670;</span>&nbsp; top priority</span>` : ""}</td>` +
    `</tr></table>`;
  const work = [w.today ? labeledRow("Today", escapeHtml(w.today)) : "", w.next ? labeledRow("Next", nextHtml(w.next)) : ""].join("");
  const size = w.size ?? [];
  const below = [w.upside ? labeledRow("Upside", escapeHtml(w.upside), { size: "13px", color: H.ink2, top: 12 }) : "", size.length ? labeledRow("Size", sizeHtml(size), { size: "14px", top: w.upside ? 14 : 12 }) : ""].join("");
  // The work and the background lines sit under the name (34px in), full width to the card's right edge.
  const workHtml = work ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:8px">${work}</table>` : "";
  const belowHtml = below ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:16px;border-top:1px solid ${H.hair}">${below}</table>` : "";
  const inner = top + (workHtml || belowHtml ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td style="padding-left:34px">${workHtml}${belowHtml}</td></tr></table>` : "");
  return cardHtml(inner, "22px 26px 18px 26px", 10, ` data-worked="1"`);
}

/**
 * The six day counts along the bottom of the opening card: large quiet numbers, small labels. Each count is a 96px
 * block, so a laptop shows the six in one row and a phone wraps them into rows of three (no media query needed);
 * classic Outlook for Windows gets the same six as table cells.
 */
export function boxHtml(box: readonly TodayCount[]): string {
  // 2026-11-23 (Bram, 8:40 pm): calmer spacing. The counts share the card's width in equal columns (never narrower than
  // 96px, so a phone still wraps them into rows of three), with more room above the numbers, between a number and its
  // label, and under the row.
  // Rounded down, so the columns never add up to more than the row (16.67% six times wraps the last count).
  const pct = (Math.floor(10000 / Math.max(1, box.length)) / 100).toFixed(2);
  const one = (c: TodayCount) => `<div style="font-size:22px;line-height:28px;font-weight:500;color:${H.ink};${H_FONT}">${c.value}</div><div style="font-size:11.5px;line-height:16px;color:${H.faint};margin-top:5px;${H_FONT}">${escapeHtml(c.label)}</div>`;
  const blocks = box.map((c) => `<!--[if mso]><td valign="top" width="${pct}%" style="padding-top:20px"><![endif]--><div style="display:inline-block;width:${pct}%;min-width:96px;box-sizing:border-box;padding-right:14px;vertical-align:top;padding-top:20px">${one(c)}</div><!--[if mso]></td><![endif]-->`).join("");
  return `<div data-today-box="1" style="margin-top:20px;padding-bottom:10px;border-top:1px solid ${H.line};font-size:0;line-height:0"><!--[if mso]><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><![endif]-->${blocks}<!--[if mso]></tr></table><![endif]--></div>`;
}

const PIPELINE_SUB: Record<string, string> = {
  Acquisition: "Each stage from first look to offer: deals in it now, and deals that reached it this week.",
  "Job search": "Each stage from lead to offer: jobs in it now, and jobs that reached it this week.",
  Consulting: "Each stage from lead to paid: leads in it now, and leads that reached it this week.",
};
/** 2026-11-25 (Bram: "cryptic"): one plain line per column, under the card's title. */
const PIPELINE_WORD: Record<string, string> = { Acquisition: "deals", "Job search": "jobs", Consulting: "leads" };

/**
 * The pipeline card (layout H). Since 2026-11-25 (Bram): Stage, In process (in the stage right now, with a short bar),
 * Today (reached the stage today), This week (reached it since the week's first day, today included), with a line
 * under the title saying what each column counts. A report built before then has no Today figure and keeps its two
 * columns. Today and This week are narrow number columns, so the card still fits a phone.
 */
export function pipelineHtml(cols: readonly PipelineCol[], track = "Acquisition", weekFrom: string | null = null): string {
  const withToday = cols.some((c) => c.today !== undefined);
  const max = Math.max(1, ...cols.map((c) => c.inStage ?? 0));
  const sep = `border-left:1px solid ${H.line};padding-left:${withToday ? 12 : 18}px`;
  const head = (t: string, extra = "") => `<td style="padding-bottom:10px;font-size:11px;line-height:16px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;color:${H.faint};${H_FONT}${extra}">${t}</td>`;
  const plus = (n: number | null | undefined) => (n ? `<span style="font-size:16px;font-weight:600;color:${H.ok}">+${n}</span>` : `<span style="font-size:16px;font-weight:600;color:${H.zero}">0</span>`);
  const rows = cols
    .map((c) => {
      const b = `padding:11px 0;border-top:1px solid ${H.rowLine};${H_FONT}`;
      const bar = (n: number) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;display:inline-table;vertical-align:middle"><tr><td style="width:${Math.max(2, Math.round(((withToday ? 32 : 70) * n) / max))}px;height:6px;line-height:6px;font-size:0;border-radius:3px;background-color:${n ? "#9ba3c9" : "#e6e8f3"}">&nbsp;</td></tr></table>`;
      const now = c.inStage === null ? `<span style="font-size:13px;color:${H.faint}">moves on the same day</span>` : `<span style="display:inline-block;width:24px;font-size:16px;font-weight:600;color:${H.ink}">${c.inStage}</span>${bar(c.inStage)}`;
      // No align attribute on the number cells: the app's report window stacks td[align=right] on a phone (a rule made
      // for the status pill), which would pull Today and This week out of their columns.
      // A stage name stays on one line when the card is wide; on a phone a name of three or more words breaks only
      // before its last word, so the name takes two lines at most and the columns keep their places.
      const stageName = (label: string) => {
        const words = escapeHtml(label).split(" ");
        const keep = (t: string) => `<span style="white-space:nowrap">${t}</span>`;
        return words.length <= 2 ? keep(words.join(" ")) : `${keep(words.slice(0, -1).join(" "))} ${words[words.length - 1]}`;
      };
      if (withToday) return `<tr><td width="150" style="${b};width:150px;padding-right:8px;font-size:14.5px;line-height:19px;color:${H.ink}">${stageName(c.label)}</td><td style="${b};white-space:nowrap">${now}</td><td width="78" style="${b};${sep};width:78px;padding-right:12px;text-align:right;white-space:nowrap">${plus(c.today)}</td><td width="84" style="${b};${sep};width:84px;text-align:right;white-space:nowrap">${plus(c.added)}</td></tr>`;
      const week = c.added ? `<span style="font-size:16px;font-weight:600;color:${H.ok}">+${c.added}</span> <span style="font-size:13px;color:${H.ok}">new</span>` : `<span style="font-size:16px;font-weight:600;color:${H.zero}">0</span> <span style="font-size:13px;color:${H.faint}">new</span>`;
      return `<tr><td width="118" style="${b};width:118px;font-size:14.5px;color:${H.ink}">${escapeHtml(c.label)}</td><td style="${b}">${now}</td><td width="96" align="right" style="${b};${sep};width:96px;text-align:right;white-space:nowrap">${week}</td></tr>`;
    })
    .join("");
  const word = PIPELINE_WORD[track] ?? "deals";
  const sub = withToday
    ? `<b style="font-weight:600;color:${H.ink}">In process:</b> ${word} in the stage right now. <b style="font-weight:600;color:${H.ink}">Today:</b> ${word} that reached the stage today. <b style="font-weight:600;color:${H.ink}">This week:</b> ${word} that reached the stage since ${escapeHtml(weekFrom ?? "the week started")}, today included.`
    : PIPELINE_SUB[track] ?? PIPELINE_SUB.Acquisition;
  const heads = withToday
    ? `${head("Stage", ";width:150px")}${head("In process")}${head("Today", `;${sep};padding-right:12px;text-align:right;width:78px`)}${head("This week", `;${sep};text-align:right;width:84px`)}`
    : `${head("Stage", ";width:118px")}${head("In process")}${head("This week", `;${sep};text-align:right`)}`;
  const inner =
    `<div style="font-size:15px;line-height:20px;font-weight:600;color:${H.ink};${H_FONT}">${escapeHtml(track)} pipeline</div>` +
    `<div style="font-size:13px;line-height:19px;color:${H.ink2};margin-top:6px;${H_FONT}">${sub}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:18px"><tr>${heads}</tr>${rows}</table>`;
  return cardHtml(inner, "22px 30px 22px 30px", 24, ` data-pipeline="1"`);
}

/** The heading over a track's cards: "Acquisition · 4 deals worked on today". */
function trackHeadingHtml(title: string): string {
  return `<div style="padding:30px 6px 0 6px;font-size:17px;line-height:24px;font-weight:600;color:${H.ink};${H_FONT}">${escapeHtml(title)}</div>`;
}

/** A worked section's pipeline card, or "" (also drawn on its own by the report window, under the cards with their Edit links). */
export function workedPipelineHtml(s: BuiltSection): string {
  const track = s.key === "jobs" ? "Job search" : s.key === "consulting" ? "Consulting" : s.key === "startup" ? "Startup" : "Acquisition";
  return s.pipeline ? pipelineHtml(s.pipeline, track, s.pipeline.find((c) => c.since)?.since ?? null) : "";
}

function workedSectionHtml(s: BuiltSection): string {
  const list = s.worked ?? [];
  return list.map((w, n) => workedHtml(w, n + 1)).join("") + workedPipelineHtml(s);
}

function prioritiesHtml(s: BuiltSection): string {
  const picks = s.picks ?? [];
  // Every pick hidden with Change: nothing in their place (the quiet line is for a track with no picks at all).
  const allHidden = !picks.length && !!s.choices?.length;
  const body = picks.length ? picks.map((pk, n) => pickHtml(pk, n === picks.length - 1)).join("") : allHidden ? "" : muted(s.quiet ?? "No top priorities chosen.");
  return body + (s.decided ? decidedHtml(s.decided) : "") + (s.pipeline ? pipelineHtmlV8(s.pipeline) : "");
}

/** The body of a section as sent (no heading): its edited text, its tiles or lists, or its line. */
export function sectionBodyHtml(s: BuiltSection): string {
  // Layout H (2026-11-23): the opening in the calm type, the six day counts under it, also after Edit.
  if (s.key === "opening" && s.box) return (s.edited || s.line ? openingBodyHtml(s.edited ?? s.line ?? "", true, 14) : `<div style="font-size:14px;line-height:20px;color:${H.amber};margin-top:14px;${H_FONT}">(no opening yet)</div>`) + boxHtml(s.box);
  // Release 4 (kept for reports built before layout H; not reached now that the box is drawn above).
  if (s.key === "opening" && s.box) return (s.edited || s.line ? openingBodyHtml(s.edited ?? s.line ?? "") : `<div style="font-size:13px;line-height:18px;color:${C.text.soon};${FONT}">(no opening yet)</div>`) + boxHtml(s.box);
  if (s.edited) return editedHtml(s.edited);
  if (s.kind === "priorities") return prioritiesHtml(s);
  if (s.kind === "worked") return workedSectionHtml(s);
  // v8: the opening is a plain paragraph (no rule, no heading in the email).
  if (s.key === "opening") return s.line ? p(escapeHtml(s.line).replace(/\n/g, "<br>")) : `<div style="font-size:13px;line-height:18px;color:${C.text.soon};${FONT}">(no opening yet)</div>`;
  if (s.kind === "tiles") return s.tiles.length ? tilesHtml(s.tiles) : muted("Nothing shown in this section today.");
  // 2026-11-06 (Bram): the tomorrow line in the note look (dark text, cobalt left line), not bold.
  if (s.kind === "line") return s.line ? `<div data-line="1" style="${NOTE_STYLE}">${escapeHtml(s.line)}</div>` : `<div style="font-size:13px;line-height:18px;color:${C.text.soon};${FONT}">(no line yet)</div>`;
  if (s.blocks.length) return blocksHtml(s.blocks);
  return muted(s.quiet ?? "Nothing shown in this section today.");
}

/**
 * Today's note under a section ("+ Note", 2026-11-05): the user's own words, set off with a rule on the left, line
 * breaks kept. Fix list item 6 (approved 2026-11-06): the normal dark reading color (not muted) and a cobalt left line,
 * slightly thicker (3px). The same HTML in the email, the report window, and every re-shown sent report.
 */
export function noteHtml(note: string | null | undefined, h = false): string {
  const t = String(note ?? "").trim();
  if (!t) return "";
  const style = h ? `margin:10px 6px 4px 6px;padding:2px 0 2px 12px;border-left:3px solid ${H.indigo};font-size:14px;line-height:22px;color:${H.ink};${H_FONT}` : NOTE_STYLE;
  return `<div data-note="1" style="${style}">${escapeHtml(t).replace(/\n/g, "<br>")}</div>`;
}

/** The note in the plain-text part: each line after "| ", the same rule on the left. */
export function noteText(note: string | null | undefined): string {
  const t = String(note ?? "").trim();
  return t ? t.split("\n").map((l) => (l.trim() ? `| ${l}` : "|")).join("\n") : "";
}

/** The header: "Daily report" (or "Daily report, with the week"), the date, the status pill. */
export function headerHtml(d: ReportData): string {
  // Layout H (2026-11-23): "Daily report" over the date, no rule (the report window shows the same as the email).
  if (isLayoutH(d)) return `<div style="padding:0 0 4px 0;${H_FONT}"><div style="font-size:13px;line-height:18px;color:${H.faint}">Daily report</div><div style="font-size:22px;line-height:28px;font-weight:600;color:${H.ink};margin-top:2px">${escapeHtml(d.dateShort)}</div></div>`;
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>` +
    `<td valign="middle" style="padding:0 0 10px 0;${FONT}"><div style="font-size:12px;line-height:16px;color:${C.muted}">${d.withWeek && d.layout !== "v8" ? "Daily report, with the week" : "Daily report"}</div>` +
    `<div style="font-size:18px;line-height:24px;font-weight:bold;color:${C.ink}">${escapeHtml(d.dateLong)}</div></td>` +
    // v8 (2026-11-15): no status pill; the targets stay in the app.
    `<td valign="middle" align="right" style="padding:0 0 10px 0;${FONT}">${d.layout === "v8" ? "" : pillHtml(d.pill)}</td>` +
    `</tr><tr><td colspan="2" style="height:1px;line-height:1px;font-size:0;background-color:${C.rule}">&nbsp;</td></tr></table>`
  );
}

/** Whether the report uses layout H (2026-11-23): the new layout with the records worked on today and the day counts. */
export function isLayoutH(d: ReportData): boolean {
  return d.layout === "v8" && !!d.worked && !!d.box;
}

export function greetingHtml(d: ReportData): string {
  if (isLayoutH(d)) {
    const t = (html: string, extra = "") => `<div style="font-size:14.5px;line-height:23px;color:${H.ink};${H_FONT}${extra}">${html}</div>`;
    return `<div style="margin-top:12px">${t(`Hey ${escapeHtml(d.partnerFirst)},`)}${d.intro?.trim() ? t(escapeHtml(d.intro.trim()).replace(/\n/g, "<br>"), ";margin-top:6px") : ""}${t(`Here is my report for ${escapeHtml(d.dateShort)}.`, d.intro?.trim() ? ";margin-top:6px" : "")}</div>`;
  }
  // Send a report (Bram, 2026-11-07): a short note of your own under the greeting, for that send only.
  const intro = d.intro?.trim() ? p(escapeHtml(d.intro.trim()).replace(/\n/g, "<br>"), ";margin-bottom:2px") : "";
  const weekNote = d.withWeek && d.layout !== "v8" ? ` It is ${escapeHtml(d.dateShort.split(",")[0])}, so the week is at the end.` : "";
  return p(`Hey ${escapeHtml(d.partnerFirst)},`, ";margin-top:12px;margin-bottom:2px") + intro + p(`Here is my report for ${escapeHtml(d.dateShort)}.${weekNote}`);
}

/** The closing; the name under "Thank you," is the Name in Settings (fix list item 10), none when not set. */
export function closingHtml(signName?: string | null, v8 = false, h = false): string {
  if (h) return `<div style="font-size:14.5px;line-height:23px;color:${H.ink};${H_FONT}">${signName ? `Thank you,<br>${escapeHtml(signName)}` : "Thank you,"}</div>`;
  // v8 (2026-11-15): no "Nothing is required" line.
  const lead = v8 ? "" : p("Nothing is required from you. Reply to this email if you want to talk.", `;color:${C.muted};font-size:13px;margin-top:4px`);
  return lead + p(signName ? `Thank you,<br>${escapeHtml(signName)}` : "Thank you,", ";margin-bottom:0");
}

/** The inner card of the email (what is sent, and what Sent reports shows): the sections this partner gets today. */
export function reportInnerHtml(d: ReportData): string {
  if (isLayoutH(d)) return reportInnerHtmlH(d);
  const row = (inner: string, pad: string) => `<tr><td style="padding:${pad}">${inner}</td></tr>`;
  const parts = [row(headerHtml(d), "16px 20px 0 20px"), row(greetingHtml(d), "0 20px 0 20px")];
  // 2026-11-06 (Bram): a note sits first, under the heading and above the section's items.
  for (const s of sentSections(d)) {
    // v8: the opening reads as part of the greeting (no heading).
    if (d.layout === "v8" && s.key === "opening") {
      // An empty opening is left out of the email (the window shows "(no opening yet)"); the Today box stays.
      if (s.box) parts.push(row((s.line || s.edited ? sectionBodyHtml(s) : boxHtml(s.box)) + noteHtml(s.note), "0 20px 4px 20px"));
      else if (s.line || s.edited || s.note) parts.push(row((s.line || s.edited ? sectionBodyHtml(s) : "") + noteHtml(s.note), "0 20px 4px 20px"));
    }
    else parts.push(row(headingHtml(s.title) + noteHtml(s.note) + sectionBodyHtml(s), "8px 20px 4px 20px"));
  }
  parts.push(row(closingHtml(d.signName, d.layout === "v8"), "10px 20px 18px 20px"));
  return `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;border-collapse:separate;background-color:#ffffff;border:1px solid ${C.border};border-radius:10px">${parts.join("")}</table>`;
}

/**
 * Layout H (Bram, 2026-11-23): the report on the paper color, at most 640px wide (a phone shows it at its own width).
 * The date, the opening card (greeting, opening, the six day counts), each track's heading and cards with its pipeline
 * card, the tomorrow line and the week in one card, and the closing.
 */
export function reportInnerHtmlH(d: ReportData): string {
  const out: string[] = [];
  out.push(`<div style="padding:16px 6px 4px 6px;${H_FONT}"><div style="font-size:13px;line-height:18px;color:${H.faint}">Daily report</div><div style="font-size:22px;line-height:28px;font-weight:600;color:${H.ink};margin-top:2px">${escapeHtml(d.dateShort)}</div></div>`);
  const text = (html: string, extra = "") => `<div style="font-size:14.5px;line-height:23px;color:${H.ink};${H_FONT}${extra}">${html}</div>`;
  const greeting = text(`Hey ${escapeHtml(d.partnerFirst)},`) + (d.intro?.trim() ? text(escapeHtml(d.intro.trim()).replace(/\n/g, "<br>"), ";margin-top:6px") : "") + text(`Here is my report for ${escapeHtml(d.dateShort)}.`, d.intro?.trim() ? ";margin-top:6px" : "");
  const sections = sentSections(d);
  const opening = sections.find((s) => s.key === "opening");
  // An empty opening is left out of the email (the window shows "(no opening yet)"); the counts stay.
  const openBody = opening ? ((opening.line || opening.edited ? sectionBodyHtml(opening) : opening.box ? boxHtml(opening.box) : "") + noteHtml(opening.note, true)) : "";
  out.push(cardHtml(greeting + openBody, "22px 26px 22px 26px", 12));
  let rest = "";
  for (const s of sections) {
    if (s.key === "opening") continue;
    if (s.kind === "worked") {
      out.push(trackHeadingHtml(s.title) + noteHtml(s.note, true) + (s.edited ? cardHtml(editedHtml(s.edited, true)) : sectionBodyHtml(s)));
      continue;
    }
    const body = s.edited ? editedHtml(s.edited, true) : s.kind === "line" ? (s.line ? text(escapeHtml(s.line), ";margin-top:8px") : text("(no line yet)", `;margin-top:8px;color:${H.amber}`)) : sectionBodyHtml(s);
    rest += `<div data-section="${escapeHtml(s.key)}" style="${rest ? "margin-top:18px" : ""}">${capsHtml(s.title)}${noteHtml(s.note, true)}${body}</div>`;
  }
  if (rest) out.push(cardHtml(rest, "20px 26px 20px 26px", 12));
  out.push(`<div style="padding:22px 6px 0 6px;font-size:14.5px;line-height:23px;color:${H.ink};${H_FONT}">${d.signName ? `Thank you,<br>${escapeHtml(d.signName)}` : "Thank you,"}</div>`);
  return `<table role="presentation" width="${H_WIDTH}" cellpadding="0" cellspacing="0" border="0" data-layout="h" style="width:100%;max-width:${H_WIDTH}px;border-collapse:collapse;background-color:${H.paper}"><tr><td style="padding:0 0 8px 0">${out.join("")}</td></tr></table>`;
}

/** The email around the report: the full-width background (the paper color for layout H) with the report centered. */
export function reportEmailHtml(inner: string): string {
  const bg = inner.includes('data-layout="h"') ? H.paper : "#f8fafc";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;background-color:${bg}"><tr><td align="center" style="padding:12px 6px">${inner}</td></tr></table>`;
}

export function reportSubject(d: ReportData): string {
  // Release 4 (2026-11-16): the day's counts after the date, as in the report Bram sent on Nov 16.
  const counts = d.layout === "v8" && d.worked && d.box ? subjectCounts(d.box) : "";
  if (counts) return `Daily report: ${d.dateShort} · ${counts}`;
  if (d.layout === "v8") return `Daily report: ${d.dateLong}`;
  return `${d.withWeek ? "Daily report with the week" : "Daily report"}: ${d.dateLong}`;
}

/** The plain-text part, from the same sections. */
export function reportText(d: ReportData): string {
  const v8 = d.layout === "v8";
  const lines: string[] = [`Hey ${d.partnerFirst},`, "", ...(d.intro?.trim() ? [d.intro.trim(), ""] : []), `Here is my report for ${d.dateShort}.${d.withWeek && !v8 ? ` It is ${d.dateShort.split(",")[0]}, so the week is at the end.` : ""}`, ...(v8 ? [] : [`${d.pill.text}.`])];
  for (const s of sentSections(d)) {
    if (v8 && s.key === "opening") {
      if (s.edited || s.line) lines.push("", openingPlain(s.edited ?? s.line));
      if (s.box) lines.push("", boxText(s.box));
      if (s.note) lines.push(noteText(s.note));
      continue;
    }
    lines.push("", s.title.toUpperCase());
    if (s.note) lines.push(noteText(s.note), "");
    if (s.edited) lines.push(s.edited.trim());
    else if (s.kind === "tiles") lines.push(tilesText(s.tiles).split("\n").map((x) => `- ${x}`).join("\n"));
    else if (s.kind === "worked") lines.push([...(s.worked ?? []).map(workedText), s.pipeline ? pipelineText(s.pipeline) : ""].filter(Boolean).join("\n"));
    else if (s.kind === "priorities") lines.push([...(s.picks ?? []).map(pickText), s.decided ? `Decided this week: ${s.decided}.` : "", s.pipeline ? pipelineText(s.pipeline) : "", !(s.picks ?? []).length && !s.choices?.length ? (s.quiet ?? "") : ""].filter(Boolean).join("\n"));
    else if (s.kind === "line") lines.push(s.line ? noteText(s.line) : "(no line yet)");
    else lines.push(s.blocks.length ? blocksText(s.blocks) : (s.quiet ?? ""));
  }
  lines.push("", ...(v8 ? [] : ["Nothing is required from you. Reply to this email if you want to talk.", ""]), ...signOff("Thank you", d.signName).split("\n"));
  return lines.join("\n");
}

/**
 * "Listings screened: 3 of 5 today, 8 of 10 this week" as a target's line in the report. The week's number is the
 * target times the weekdays counted so far (less a skipped day), as on Targets: on a Wednesday "13 of 15", on Friday
 * "19 of 25". The Rosara focus reads "Rosara focus: done" or "not yet".
 */
export function targetLine(j: Judged, weekSum: number | null, countedDays = 5): string {
  if (j.key === "rosara_focus_done") return `${j.name.replace(/\s+done$/i, "")}: ${j.met ? "done" : j.judged ? "not done" : "not yet"}`;
  const base = `${j.name}: ${j.figure}`;
  if (j.cadence === "day" && weekSum !== null && countedDays === 0) return `${j.name}: ${j.value} today, ${weekSum} this week`;
  return j.cadence === "day" && weekSum !== null ? `${base} today, ${weekSum} of ${j.number * Math.max(1, countedDays)} this week` : base;
}

/** The group a judged target sits in: Met, Missed, or Under way (Edit batch C round 2, item 7). */
export function targetGroup(j: { met: boolean; judged: boolean }): "met" | "missed" | "now" {
  return judgedMark(j);
}

export { MARK_WORD };

/** "3 of 6 targets met" (Friday) or "Listings screened met" / "2 targets missed" for the pill. */
export function pillOf(judged: readonly Judged[], withWeek: boolean): { text: string; status: TileStatus } {
  const today = judged.filter((j) => j.judged);
  if (!today.length) return { text: "No targets judged today", status: "neutral" };
  const met = today.filter((j) => j.met).length;
  if (withWeek || today.length > 1) return { text: `${met} of ${today.length} targets met`, status: met === today.length ? "met" : "missed" };
  return { text: `${today[0].name} ${today[0].met ? "met" : "missed"}`, status: today[0].met ? "met" : "missed" };
}

/** One partner's copy of the day's report (push B): their name in the greeting, their standing sections, today's choices. */
export function reportFor(base: ReportData, partner: { name: string; first: string; sections: readonly string[] }, choices?: ReportChoices | null): ReportData {
  return { ...base, partnerName: partner.name, partnerFirst: partner.first, sections: [...partner.sections], choices: choices ?? null };
}

export { buildSections, sentSections };
