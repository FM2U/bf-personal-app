/**
 * The email message editor (Email button compose box, Outreach Queue Draft message) and the email it sends.
 * Pure functions (browser and server):
 * - textToEditorHtml: plain text (AI drafts, templates, pasted plain text) as editor HTML: one paragraph per line,
 *   runs of "- " lines as a bulleted list, runs of "1. " lines as a numbered list, **bold** as bold.
 * - sanitizeEmailBodyHtml: the signature sanitizer rules (src/lib/email-signature.ts) plus lists (ul, ol, li).
 * - editorHtmlToEmailHtml: the editor HTML the way Gmail writes a message (one div per line, <div><br></div> for a
 *   blank line, lists with Gmail's indent).
 * - emailBodyHtmlToText: the plain text part (bullets as "- ", numbers as "1. ", links as "text (address)").
 * - emailBodyParts / emailHtmlFor: one place that decides the text and HTML of a message, so the confirmation
 *   dialog, Send now, and Save to Gmail drafts all use the same output.
 */

import { decodeEntities, EMAIL_LIST_STYLE, emailHtml, escapeHtml, parseBodyLines, sanitizeHtml } from "./email-signature";

/** Longest message HTML accepted (characters, before cleaning). */
export const BODY_HTML_MAX_LENGTH = 100000;

/** The signature rules plus lists. Pasted content and everything sent by the browser goes through this. */
export function sanitizeEmailBodyHtml(html: string): string {
  return sanitizeHtml(html, { extraTags: ["ul", "ol", "li"], extraAttrs: { ol: ["start"] }, maxLength: BODY_HTML_MAX_LENGTH / 2 });
}

/** One line of plain text as inline editor HTML: text escaped, **bold** as bold. */
function inlineHtml(line: string): string {
  return escapeHtml(line).replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
}

/** Plain text as editor HTML (the same list rules as the email: bodyToHtml). */
export function textToEditorHtml(text: string): string {
  const clean = String(text ?? "")
    .replace(/\r\n|\r/g, "\n")
    .replace(/^\n+/, "")
    .replace(/\s+$/, "");
  if (!clean) return "";
  return parseBodyLines(clean)
    .map((b) => {
      if (b.kind === "text") return b.lines.map((l) => (l.trim() ? `<p>${inlineHtml(l)}</p>` : "<p></p>")).join("");
      const items = b.items.map((x) => `<li><p>${inlineHtml(x)}</p></li>`).join("");
      if (b.kind === "ul") return `<ul>${items}</ul>`;
      return `<ol${b.start !== 1 ? ` start="${b.start}"` : ""}>${items}</ol>`;
    })
    .join("");
}

const TOKEN = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g;
const VOID = new Set(["br", "img"]);
const BLOCK = new Set(["p", "div"]);

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m ? decodeEntities(m[1]) : null;
}

/**
 * The editor HTML as Gmail writes a message: each paragraph is a <div> (an empty one is <div><br></div>, Gmail's
 * blank line), list items hold their text directly (<li>text</li>), lists have no extra space above or below.
 * Blank lines at the end are removed (the signature adds its own). Input is cleaned first.
 */
export function editorHtmlToEmailHtml(html: string): string {
  const clean = sanitizeEmailBodyHtml(html);
  type Frame = { tag: string; skip?: boolean; empty?: boolean; liHasContent?: boolean };
  const stack: Frame[] = [];
  const out: string[] = [];
  const nearestLi = (): Frame | null => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].tag === "li") return stack[i];
      if (stack[i].tag === "ul" || stack[i].tag === "ol") return null;
    }
    return null;
  };
  const markContent = () => {
    for (const f of stack) if (BLOCK.has(f.tag)) f.empty = false;
    const li = nearestLi();
    if (li) li.liHasContent = true;
  };
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(clean))) {
    if (m[4] !== undefined) {
      const inBlock = stack.some((f) => BLOCK.has(f.tag) || f.tag === "li");
      if (!m[4].trim() && !inBlock) continue;
      markContent();
      out.push(m[4]);
      continue;
    }
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    const attrs = m[3];
    if (!closing) {
      if (BLOCK.has(tag)) {
        const li = nearestLi();
        if (li) {
          if (li.liHasContent) out.push("<br>");
          stack.push({ tag, skip: true });
        } else {
          out.push(`<div${tag === "div" ? attrs : ""}>`);
          stack.push({ tag, empty: true });
        }
      } else if (tag === "ul" || tag === "ol") {
        const start = tag === "ol" ? attr(attrs, "start") : null;
        out.push(`<${tag} style="${EMAIL_LIST_STYLE}"${start && start !== "1" ? ` start="${escapeHtml(start)}"` : ""}>`);
        stack.push({ tag });
      } else if (tag === "li") {
        out.push("<li>");
        stack.push({ tag, liHasContent: false });
      } else if (VOID.has(tag)) {
        markContent();
        out.push(m[0]);
      } else {
        out.push(m[0]);
        stack.push({ tag });
      }
      continue;
    }
    if (VOID.has(tag)) continue;
    const at = stack.map((f) => f.tag).lastIndexOf(tag);
    if (at < 0) continue;
    while (stack.length > at) {
      const f = stack.pop()!;
      if (BLOCK.has(f.tag)) {
        if (!f.skip) out.push(f.empty ? "<br></div>" : "</div>");
      } else out.push(`</${f.tag}>`);
    }
  }
  while (stack.length) {
    const f = stack.pop()!;
    if (BLOCK.has(f.tag)) {
      if (!f.skip) out.push(f.empty ? "<br></div>" : "</div>");
    } else out.push(`</${f.tag}>`);
  }
  return out.join("").replace(/(?:<div><br><\/div>)+$/, "");
}

/** A link address as shown in plain text: mailto: and tel: removed. */
function shownAddress(url: string): string {
  return url.replace(/^(mailto:|tel:)/i, "");
}

const bare = (x: string) => x.replace(/^(https?:\/\/|mailto:|tel:)/i, "").replace(/\/$/, "").trim().toLowerCase();

/**
 * The plain text part of the message: one line per paragraph or line break, an empty paragraph is a blank line,
 * bullets as "- ", numbered items as "1. " (nested lists indented by 2 spaces), links as "text (address)" (only the
 * address when the text is the address). Bold and italic have no mark in plain text.
 */
export function emailBodyHtmlToText(html: string): string {
  const clean = sanitizeEmailBodyHtml(html);
  const lines: string[] = [];
  let cur = "";
  let open = false;
  type Block = { tag: string; inLi: boolean; childBlock: boolean; endedWithBr: boolean };
  const blocks: Block[] = [];
  const lists: { ordered: boolean; n: number }[] = [];
  const lis: { hasContent: boolean; indent: string }[] = [];
  const links: { href: string; at: number }[] = [];
  const push = () => {
    lines.push(cur.replace(/\s+$/, ""));
    cur = "";
    open = false;
  };
  /** Ends the line in progress when it holds something. */
  const flush = () => {
    if (open && cur.trim()) push();
    cur = "";
    open = false;
  };
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(clean))) {
    if (m[4] !== undefined) {
      const t = decodeEntities(m[4]).replace(/ /g, " ").replace(/[\r\n\t]+/g, " ");
      if (!t.trim() && !open) continue;
      if (!open && lis.length) cur = cur || lis[lis.length - 1].indent;
      cur += t;
      open = true;
      for (const b of blocks) b.endedWithBr = false;
      if (lis.length && t.trim()) lis[lis.length - 1].hasContent = true;
      continue;
    }
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    const attrs = m[3];
    if (tag === "br") {
      push();
      open = true;
      if (lis.length) cur = lis[lis.length - 1].indent;
      if (blocks.length) blocks[blocks.length - 1].endedWithBr = true;
      continue;
    }
    if (BLOCK.has(tag) || tag === "tr" || tag === "table") {
      const insideLi = lis.length > 0;
      if (!closing) {
        if (insideLi) {
          const li = lis[lis.length - 1];
          if (li.hasContent) {
            flush();
            cur = li.indent;
            open = true;
          }
          blocks.push({ tag, inLi: true, childBlock: false, endedWithBr: false });
        } else {
          flush();
          if (blocks.length) blocks[blocks.length - 1].childBlock = true;
          blocks.push({ tag, inLi: false, childBlock: false, endedWithBr: false });
          open = true;
          cur = "";
        }
        continue;
      }
      const at = blocks.map((b) => b.tag).lastIndexOf(tag);
      if (at < 0) continue;
      const b = blocks[at];
      blocks.length = at;
      if (b.inLi) continue;
      if (b.childBlock || (b.endedWithBr && !cur.trim())) flush();
      else push();
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      if (!closing) {
        flush();
        if (blocks.length) blocks[blocks.length - 1].childBlock = true;
        const start = Number(attr(attrs, "start") ?? "1");
        lists.push({ ordered: tag === "ol", n: Number.isFinite(start) && start > 0 ? start : 1 });
      } else {
        flush();
        lists.pop();
      }
      continue;
    }
    if (tag === "li") {
      if (!closing) {
        flush();
        const list = lists[lists.length - 1] ?? { ordered: false, n: 1 };
        const depth = Math.max(0, lists.length - 1);
        const marker = list.ordered ? `${list.n++}. ` : "- ";
        cur = "  ".repeat(depth) + marker;
        open = true;
        lis.push({ hasContent: false, indent: "  ".repeat(depth) + " ".repeat(marker.length) });
      } else {
        if (open) push();
        lis.pop();
      }
      continue;
    }
    if (tag === "a") {
      if (!closing) links.push({ href: attr(attrs, "href") ?? "", at: cur.length });
      else {
        const l = links.pop();
        if (!l || !l.href) continue;
        const text = cur.slice(Math.min(l.at, cur.length)).trim();
        if (!text) cur += shownAddress(l.href);
        else if (bare(text) !== bare(l.href)) cur += ` (${shownAddress(l.href)})`;
      }
      continue;
    }
    if ((tag === "td" || tag === "th") && closing) cur += "  ";
  }
  if (open && cur.trim()) push();
  return lines
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\s+$/, "");
}

/** True when the editor holds no text. */
export function isEmailBodyEmpty(html: string | null | undefined): boolean {
  return !emailBodyHtmlToText(String(html ?? "")).trim();
}

/**
 * The text and HTML of a message. With editor HTML: the text part is made from it and the HTML part is it in
 * Gmail's form. Without (partner reports, drafts made by a job): the plain text, and HTML made from it later.
 */
export function emailBodyParts(msg: { body?: string | null; bodyHtml?: string | null }): { text: string; html: string | null } {
  const raw = String(msg.bodyHtml ?? "");
  if (raw.trim() && !isEmailBodyEmpty(raw)) return { text: emailBodyHtmlToText(raw), html: editorHtmlToEmailHtml(raw) };
  return { text: String(msg.body ?? ""), html: null };
}

/** The full HTML part (message, then the signature) for a message from the editor or plain text. */
export function emailHtmlFor(msg: { body?: string | null; bodyHtml?: string | null }, signatureHtml?: string | null): string {
  const p = emailBodyParts(msg);
  return emailHtml(p.text, signatureHtml, p.html);
}
