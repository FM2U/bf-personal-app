/**
 * The report's opening with bold and bullets (Bram, 2026-11-23; claude/2026-11-23-report-fixes-build-plan.md), pure and
 * tested in src/lib/accountability/opening-format.test.ts. The opening is saved as text: "**" around bold words and
 * "- " at the start of a bullet line. An opening saved before this release has neither and shows as it did.
 * - openingLines / openingInlineHtml: what the report (email and report window) draws.
 * - openingPlain: the same words with no marks (the email's plain-text part, the checklist).
 * - openingToEditorHtml / editorHtmlToOpening: to and from the editor on End of day (the Email window's editor with
 *   only Bold and Bulleted list).
 */

/** The longest opening saved (characters, marks included). */
export const OPENING_MAX = 1500;

export type OpeningLine = { bullet: boolean; text: string };

const BULLET = /^\s*[-*•]\s+(?=\S)/;

/** The lines as written: blank lines out, a line starting with "- " (or "* ", "•") is a bullet. */
export function openingLines(text: string | null | undefined): OpeningLine[] {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim())
    // "**Heading:** text" starts with "*" but no space after it, so it is never read as a "* " bullet.
    .map((l) => (BULLET.test(l) ? { bullet: true, text: l.replace(BULLET, "").trim() } : { bullet: false, text: l.trim() }));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One line's text as HTML: escaped, "**words**" in <b>. A "**" with no partner stays out of the text. */
export function openingInlineHtml(text: string, boldTag: "b" | "strong" = "b"): string {
  const parts = text.split("**");
  // An odd count of parts means every "**" has a partner; otherwise the last one is dropped.
  let html = "";
  parts.forEach((part, i) => {
    const bold = i % 2 === 1 && i < parts.length - 1;
    if (!part) return;
    html += bold ? `<${boldTag}>${esc(part)}</${boldTag}>` : esc(part);
  });
  return html;
}

/** The words with no marks: "**" out, bullets as "- ". */
export function openingPlain(text: string | null | undefined): string {
  return openingLines(text)
    .map((l) => `${l.bullet ? "- " : ""}${l.text.replace(/\*\*/g, "")}`)
    .join("\n");
}

/** The saved opening as the editor's HTML: a paragraph per line, bullets in one list, bold as <strong>. */
export function openingToEditorHtml(text: string | null | undefined): string {
  const lines = openingLines(text);
  let html = "";
  let inList = false;
  for (const l of lines) {
    if (l.bullet) {
      if (!inList) html += "<ul>";
      inList = true;
      html += `<li><p>${openingInlineHtml(l.text, "strong")}</p></li>`;
    } else {
      if (inList) html += "</ul>";
      inList = false;
      html += `<p>${openingInlineHtml(l.text, "strong")}</p>`;
    }
  }
  if (inList) html += "</ul>";
  return html;
}

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");

/**
 * The editor's HTML as the saved opening. Paragraphs and line breaks are lines, list items are "- " lines, <strong>
 * and <b> are "**"; every other tag (italic, links, numbered lists) leaves only its words.
 */
export function editorHtmlToOpening(html: string | null | undefined): string {
  const src = String(html ?? "");
  const out: string[] = [];
  let line = "";
  let bold = 0;
  let li = 0;
  let lineIsBullet: boolean = false;
  const flush = () => {
    // Bold marks that hug their words: "** x **" would not read back as bold.
    const t = line
      .replace(/\*\*(\s*)\*\*/g, "$1")
      .replace(/\*\*(\s+)/g, "$1**")
      .replace(/(\s+)\*\*/g, "**$1");
    const fixed = rebalance(t).replace(/\s+/g, " ").trim();
    if (fixed.replace(/\*\*/g, "").trim()) out.push(`${lineIsBullet ? "- " : ""}${fixed}`);
    line = "";
    lineIsBullet = false;
  };
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[3] !== undefined) {
      const t = decode(m[3]).replace(/\*\*/g, "");
      if (t) {
        if (li > 0 && !line) lineIsBullet = true;
        line += t;
      }
      continue;
    }
    const close = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (tag === "strong" || tag === "b") {
      if (!close) {
        if (bold === 0) {
          if (li > 0 && !line) lineIsBullet = true;
          line += "**";
        }
        bold++;
      } else if (bold > 0) {
        bold--;
        if (bold === 0) line += "**";
      }
    } else if (tag === "li") {
      if (!close) {
        flush();
        li++;
      } else {
        closeBold();
        flush();
        li = Math.max(0, li - 1);
      }
    } else if (tag === "p" || tag === "div" || tag === "ul" || tag === "ol" || tag === "br") {
      const wasBullet: boolean = lineIsBullet || (li > 0 && !!line);
      const reopen = bold > 0;
      closeBold(false);
      lineIsBullet = wasBullet;
      flush();
      if (reopen) line += "**";
    }
  }
  closeBold();
  flush();
  return out.join("\n");

  /** Ends an open bold at a line's end (the editor's bold can run across lines; the saved marks never do). */
  function closeBold(reset = true) {
    if (bold > 0 && line) line += "**";
    if (reset) bold = 0;
  }
}

/** Marks in pairs: a line that ends with an open "**" loses it. */
function rebalance(t: string): string {
  const n = t.split("**").length - 1;
  if (n % 2 === 0) return t;
  const at = t.lastIndexOf("**");
  return t.slice(0, at) + t.slice(at + 2);
}

/** Words in a text (the Upside line's count; "Why it fits" on a record). */
export function wordCount(text: string | null | undefined): number {
  return String(text ?? "")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
