/**
 * A small, safe reader for the markdown the AI writes: bullets (nested by 2 spaces), numbered items,
 * **bold**, line breaks, and short bold section labels. Headings ("#") become short bold labels.
 * It returns plain data; the AiText component turns it into React elements, so no HTML is ever injected.
 * Also: the dash fixer used on all AI text, and a plain-text version for emails and letters.
 */

export type InlinePart = { text: string; bold: boolean };
export type Inline = InlinePart[];
export type MdItem = { inline: Inline; children: MdList[] };
export type MdList = { kind: "list"; ordered: boolean; items: MdItem[] };
export type MdBlock = { kind: "label"; inline: Inline } | { kind: "paragraph"; lines: Inline[] } | MdList;

const DASHES = "‒–—―";
const DASH = `[${DASHES}]`;

/**
 * Replaces em dashes and en dashes used as punctuation with a comma or a period.
 * A dash before a capital letter or at the end of a line becomes a period; other dashes become a comma.
 * Number ranges ("3–5") become "3-5". A dash used as a bullet at the start of a line becomes "- ".
 */
export function fixDashes(s: string): string {
  if (!s) return s;
  return s
    .split("\n")
    .map((line) => {
      if (new RegExp(`^\\s*${DASH}+\\s*$`).test(line)) return "";
      let l = line;
      l = l.replace(new RegExp(`^(\\s*)${DASH}\\s+`), "$1- ");
      l = l.replace(new RegExp(`(\\d)\\s*${DASH}\\s*(?=\\d)`, "g"), "$1-");
      l = l.replace(new RegExp(`([.!?:;,])\\s*${DASH}+\\s*`, "g"), "$1 ");
      l = l.replace(new RegExp(`\\s*${DASH}+\\s*$`), ".");
      l = l.replace(new RegExp(`\\s*${DASH}+\\s*(?=(\\*\\*)?[A-Z])`, "g"), ". ");
      l = l.replace(new RegExp(`\\s*${DASH}+\\s*`, "g"), ", ");
      l = l.replace(/,\s*\./g, ".").replace(/([.!?])\s*,/g, "$1").replace(/ +$/, "");
      return l;
    })
    .join("\n");
}

function cleanInlineMarkup(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1") // links: keep the text
    .replace(/`([^`]*)`/g, "$1") // code marks
    .replace(/(^|[\s(])\*(?!\*)([^*\n]+?)\*(?!\*)(?=[\s).,:;!?]|$)/g, "$1$2") // *italic*
    .replace(/(^|[\s(])_([^_\n]+?)_(?=[\s).,:;!?]|$)/g, "$1$2"); // _italic_
}

/** Splits a line into plain and **bold** parts. Unmatched ** marks are dropped. */
export function parseInline(s: string): Inline {
  const text = cleanInlineMarkup(s);
  const pieces = text.split("**");
  const parts: Inline = [];
  const closed = pieces.length % 2 === 1;
  pieces.forEach((p, i) => {
    if (!p) return;
    const bold = closed ? i % 2 === 1 : false;
    const prev = parts[parts.length - 1];
    if (prev && prev.bold === bold) prev.text += p;
    else parts.push({ text: p, bold });
  });
  return parts.length ? parts : [{ text: "", bold: false }];
}

const LIST_RE = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;
const HEADING_RE = /^\s{0,3}#{1,6}\s*(.*?)\s*#*\s*$/;
const RULE_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const BOLD_LINE_RE = /^\s*\*\*([^*]+)\*\*\s*:?\s*$/;

/** Reads AI text into blocks: labels, paragraphs, and (nested) lists. */
export function parseMarkdown(src: string): MdBlock[] {
  const lines = (src ?? "").replace(/\r\n?/g, "\n").replace(/\t/g, "  ").split("\n");
  const blocks: MdBlock[] = [];
  let para: Inline[] | null = null;
  let stack: { indent: number; list: MdList }[] = [];

  const closePara = () => {
    if (para) blocks.push({ kind: "paragraph", lines: para });
    para = null;
  };
  const closeLists = () => {
    stack = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      closePara();
      // A blank line ends a list only when the next text line is not a list item or a continuation.
      const next = lines.slice(i + 1).find((l) => l.trim());
      if (!next || !(LIST_RE.test(next) || (stack.length && /^\s{2,}\S/.test(next)))) closeLists();
      continue;
    }
    if (RULE_RE.test(line)) {
      closePara();
      closeLists();
      continue;
    }
    const li = line.match(LIST_RE);
    if (li) {
      closePara();
      const indent = li[1].length;
      const ordered = /\d/.test(li[2]);
      const item: MdItem = { inline: parseInline(li[3]), children: [] };
      while (stack.length && stack[stack.length - 1].indent > indent) stack.pop();
      const top = stack[stack.length - 1];
      if (top && top.indent === indent) {
        top.list.items.push(item);
      } else if (top && top.indent < indent) {
        const parentItem = top.list.items[top.list.items.length - 1];
        const child: MdList = { kind: "list", ordered, items: [item] };
        parentItem.children.push(child);
        stack.push({ indent, list: child });
      } else {
        const list: MdList = { kind: "list", ordered, items: [item] };
        blocks.push(list);
        stack = [{ indent, list }];
      }
      continue;
    }
    const heading = line.match(HEADING_RE);
    if (heading && line.trim().startsWith("#")) {
      closePara();
      closeLists();
      if (heading[1]) blocks.push({ kind: "label", inline: stripBold(parseInline(heading[1])) });
      continue;
    }
    // A text line indented under a list item continues that item.
    if (stack.length && /^\s{2,}\S/.test(line)) {
      const top = stack[stack.length - 1];
      const item = top.list.items[top.list.items.length - 1];
      item.inline = [...item.inline, { text: " ", bold: false }, ...parseInline(line.trim())];
      continue;
    }
    const boldLine = line.match(BOLD_LINE_RE);
    if (boldLine || (/:\s*$/.test(line) && line.trim().length <= 60 && !para)) {
      closePara();
      closeLists();
      const label = (boldLine ? boldLine[1] : line.trim().replace(/:\s*$/, "")).trim();
      blocks.push({ kind: "label", inline: stripBold(parseInline(label)) });
      continue;
    }
    closeLists();
    if (!para) para = [];
    para.push(parseInline(line.trim()));
  }
  closePara();
  return blocks;
}

function stripBold(inline: Inline): Inline {
  return [{ text: inline.map((p) => p.text).join(""), bold: true }];
}

function inlineText(inline: Inline): string {
  return inline.map((p) => p.text).join("");
}

/** Plain text for emails, letters, and the clipboard: "- " bullets with 2-space nesting, no ** marks. */
export function markdownToPlain(src: string): string {
  const out: string[] = [];
  const walk = (list: MdList, depth: number) => {
    list.items.forEach((it, i) => {
      out.push(`${"  ".repeat(depth)}${list.ordered ? `${i + 1}.` : "-"} ${inlineText(it.inline)}`);
      it.children.forEach((c) => walk(c, depth + 1));
    });
  };
  parseMarkdown(src).forEach((b, i) => {
    if (b.kind === "label") {
      if (i > 0) out.push("");
      out.push(inlineText(b.inline));
    } else if (b.kind === "paragraph") {
      if (i > 0 && out[out.length - 1] !== "") out.push("");
      b.lines.forEach((l) => out.push(inlineText(l)));
    } else {
      walk(b, 0);
    }
  });
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
