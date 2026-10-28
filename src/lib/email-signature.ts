/**
 * Gmail signature on emails sent or drafted from the app. Pure functions (browser and server):
 * - sanitizeSignatureHtml: keeps only safe tags and attributes (links, images over https, basic formatting, simple
 *   tables, limited inline styles). Scripts, event handlers (onclick, onerror), and javascript: links are removed.
 * - signatureHtmlToText: the plain text version of a signature (for the text part of the email).
 * - bodyToHtml / emailHtml / emailText: the message as Gmail would send it (body, then the signature with Gmail's
 *   normal spacing: a blank line, "-- ", then the signature).
 */

export const SIGNATURE_MAX_LENGTH = 20000;

/** Tags kept as they are (attributes filtered). Any other tag is removed but its text is kept. */
const ALLOWED_TAGS = new Set(["a", "br", "p", "div", "span", "b", "strong", "i", "em", "u", "img", "table", "tbody", "thead", "tr", "td", "th", "font"]);
/** Tags removed together with everything inside them. */
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math", "head", "title", "textarea", "select", "button", "form", "frame", "frameset", "applet", "audio", "video", "canvas", "xml"]);
const VOID_TAGS = new Set(["br", "img"]);

const COMMON_ATTRS = ["style", "dir", "align"];
const ALLOWED_ATTRS: Record<string, string[]> = {
  a: ["href", "title", "target"],
  img: ["src", "alt", "width", "height", "title"],
  font: ["color", "size", "face"],
  table: ["cellpadding", "cellspacing", "border", "width", "bgcolor"],
  td: ["colspan", "rowspan", "width", "height", "valign", "bgcolor"],
  th: ["colspan", "rowspan", "width", "height", "valign", "bgcolor"],
  tr: ["valign", "bgcolor"],
};

const STYLE_PROPS = new Set([
  "color", "background-color", "font-family", "font-size", "font-weight", "font-style", "font-variant", "text-decoration", "text-align", "text-transform",
  "line-height", "letter-spacing", "vertical-align", "white-space", "width", "height", "max-width", "min-width", "max-height",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left", "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border", "border-top", "border-right", "border-bottom", "border-left", "border-color", "border-width", "border-style", "border-collapse", "border-spacing", "border-radius",
]);

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", copy: "\u00a9", reg: "\u00ae", middot: "\u00b7", bull: "\u2022", ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", trade: "\u2122" };

/** Decodes HTML character references (&amp;, &#106;, &#x6a;, and common named ones). */
export function decodeEntities(s: string): string {
  return String(s ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);?/gi, (m, ref: string) => {
    if (ref[0] === "#") {
      const n = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return "";
      try {
        return String.fromCodePoint(n);
      } catch {
        return "";
      }
    }
    const v = NAMED[ref.toLowerCase()];
    return v ?? m;
  });
}

export function escapeHtml(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Text between tags: keeps valid character references, escapes everything else that could start markup. */
function cleanText(s: string): string {
  return s.replace(/&(?!(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A link or image address with whitespace and control characters removed (browsers ignore them in a scheme). */
function compactUrl(raw: string): string {
  return decodeEntities(raw).replace(/[\u0000-\u0020\u007f-\u009f]/g, "");
}

export function safeHref(raw: string): string | null {
  const v = decodeEntities(raw).trim();
  const scheme = compactUrl(v).toLowerCase();
  if (/^(https?:\/\/|mailto:|tel:)/.test(scheme)) return v;
  return null;
}

export function safeImageSrc(raw: string): string | null {
  const v = decodeEntities(raw).trim();
  return /^https:\/\//.test(compactUrl(v).toLowerCase()) && !/[\s"'<>]/.test(v) ? v : null;
}

const SAFE_COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,20}|rgba?\(\s*[\d.%\s,]+\)|hsla?\(\s*[\d.%\s,deg]+\))$/i;

/** Keeps only allowed inline style properties with plain values (no url(), expression(), or escapes). */
export function sanitizeStyle(style: string): string {
  const out: string[] = [];
  for (const decl of decodeEntities(style).split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    let value = decl.slice(i + 1).trim().replace(/\s*!important$/i, "");
    if (!STYLE_PROPS.has(prop) || !value) continue;
    const lower = value.toLowerCase();
    if (/url\s*\(|expression|javascript|vbscript|@import|behavior|binding|[\\<>{}]|\/\*/.test(lower)) continue;
    if (!/^[#a-z0-9\s.,%'"()\-+]+$/i.test(value)) continue;
    // Parentheses only for colors: rgb(), rgba(), hsl(), hsla().
    const fns = lower.match(/[a-z-]+\s*\(/g) ?? [];
    if (fns.some((f) => !/^(rgba?|hsla?)\s*\($/.test(f))) continue;
    if (lower.includes("(") && fns.length === 0) continue;
    value = value.replace(/\s+/g, " ");
    out.push(`${prop}: ${value}`);
  }
  return out.join("; ");
}

function attrValue(tag: string, name: string, raw: string): string | null {
  const v = decodeEntities(raw).trim();
  switch (name) {
    case "href":
      return safeHref(raw);
    case "src":
      return safeImageSrc(raw);
    case "style": {
      const s = sanitizeStyle(raw);
      return s || null;
    }
    case "target":
      return v === "_blank" ? "_blank" : null;
    case "dir":
      return /^(ltr|rtl|auto)$/i.test(v) ? v.toLowerCase() : null;
    case "align":
      return /^(left|right|center|justify)$/i.test(v) ? v.toLowerCase() : null;
    case "valign":
      return /^(top|middle|bottom|baseline)$/i.test(v) ? v.toLowerCase() : null;
    case "width":
    case "height":
      return /^\d{1,4}(%|px)?$/.test(v) ? v : null;
    case "colspan":
    case "rowspan":
    case "cellpadding":
    case "cellspacing":
    case "border":
      return /^\d{1,3}$/.test(v) ? v : null;
    case "size":
      return tag === "font" && /^[+-]?[1-7]$/.test(v) ? v : null;
    case "color":
    case "bgcolor":
      return SAFE_COLOR.test(v) ? v : null;
    case "face":
      return /^[a-z0-9 ,'"\-]{1,100}$/i.test(v) ? v : null;
    case "alt":
    case "title":
      return v.slice(0, 300);
    default:
      return null;
  }
}

/** Reads the attributes of an opening tag ("a href=x target='_blank'"). */
function parseAttrs(src: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push([m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? ""]);
  return out;
}

/**
 * Keeps only safe HTML for a signature. Output is well formed: unknown tags are unwrapped (text kept), dangerous
 * containers (script, style, iframe, svg...) are removed with their content, comments are removed, every attribute
 * not on the list is dropped (including every on... event handler), links keep only http, https, mailto, and tel
 * addresses, and images keep only https addresses (an image without one is removed).
 */
export function sanitizeSignatureHtml(input: string): string {
  const html = String(input ?? "").slice(0, SIGNATURE_MAX_LENGTH * 2);
  const out: string[] = [];
  const stack: string[] = [];
  let dropping: string | null = null;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) {
      if (!dropping) out.push(cleanText(html.slice(i)));
      break;
    }
    if (lt > i && !dropping) out.push(cleanText(html.slice(i, lt)));
    // Comments, CDATA, doctype, processing instructions: removed.
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const end = html.indexOf(">", lt);
      i = end < 0 ? html.length : end + 1;
      continue;
    }
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(html.slice(lt));
    if (!m) {
      // A "<" that does not start a tag is text.
      if (!dropping) out.push("&lt;");
      i = lt + 1;
      continue;
    }
    i = lt + m[0].length;
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (dropping) {
      if (closing && tag === dropping) dropping = null;
      continue;
    }
    if (DROP_WITH_CONTENT.has(tag)) {
      if (!closing && !/\/\s*$/.test(m[3])) dropping = tag;
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (closing) {
      if (VOID_TAGS.has(tag)) continue;
      const at = stack.lastIndexOf(tag);
      if (at < 0) continue;
      while (stack.length > at) out.push(`</${stack.pop()}>`);
      continue;
    }
    const allowed = new Set([...COMMON_ATTRS, ...(ALLOWED_ATTRS[tag] ?? [])]);
    const attrs: string[] = [];
    const seen = new Set<string>();
    let hasSrc = false;
    for (const [name, raw] of parseAttrs(m[3].replace(/\/\s*$/, ""))) {
      if (!allowed.has(name) || seen.has(name)) continue;
      const v = attrValue(tag, name, raw);
      if (v === null) continue;
      seen.add(name);
      if (name === "src") hasSrc = true;
      attrs.push(`${name}="${escapeHtml(v)}"`);
    }
    if (tag === "img" && !hasSrc) continue;
    if (tag === "a" && seen.has("target")) attrs.push('rel="noopener noreferrer"');
    out.push(`<${tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}>`);
    if (!VOID_TAGS.has(tag)) stack.push(tag);
  }
  while (stack.length) out.push(`</${stack.pop()}>`);
  return out.join("").trim();
}

/**
 * The plain text version of a signature: one line per line shown (br, div, table row), a blank line between
 * paragraphs, cells separated by spaces, links as "text <address>" when the text is not the address itself (phone
 * and email links show their text). Images are left out.
 */
export function signatureHtmlToText(html: string): string {
  const LT = "\u0003";
  const GT = "\u0004";
  let s = sanitizeSignatureHtml(html);
  s = s.replace(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
    const url = decodeEntities(href);
    const text = inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    const shown = escapeHtml(url.replace(/^(mailto:|tel:)/i, ""));
    if (!text) return /^https?:/i.test(url) ? escapeHtml(url) : shown;
    if (/^(mailto:|tel:)/i.test(url)) return text;
    const bare = (x: string) => decodeEntities(x).replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase();
    return bare(text) === bare(url) ? text : `${text} ${LT}${escapeHtml(url)}${GT}`;
  });
  // Images are left out of the plain text (as Gmail does); the HTML part shows them.
  s = s.replace(/<img\b[^>]*>/gi, "");
  const lines: string[] = [""];
  let blankBefore = false;
  const endLine = () => {
    if (lines[lines.length - 1].trim()) lines.push("");
  };
  const re = /<(\/?)([a-z]+)[^>]*>|([^<]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m[3] !== undefined) {
      const t = decodeEntities(m[3]).replace(/\u00a0/g, " ").replace(/[ \t\r\n]+/g, " ");
      if (!t.trim() && !lines[lines.length - 1].trim()) continue;
      if (blankBefore && t.trim()) {
        if (lines.length > 1 && lines[lines.length - 2] !== "") lines.splice(lines.length - 1, 0, "");
        blankBefore = false;
      }
      lines[lines.length - 1] += t;
      continue;
    }
    const tag = m[2].toLowerCase();
    if (tag === "br") lines.push("");
    else if (tag === "p") {
      endLine();
      blankBefore = true;
    } else if (["div", "tr", "table", "tbody", "thead"].includes(tag)) endLine();
    else if ((tag === "td" || tag === "th") && m[1] === "/") lines[lines.length - 1] += "  ";
  }
  const text = lines
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.replace(new RegExp(LT, "g"), "<").replace(new RegExp(GT, "g"), ">");
}

const BULLET = /^\s*(?:[-*\u2022])\s+(.*)$/;

/** The message text as HTML: text escaped, line breaks kept, runs of "- " lines as a bulleted list. */
export function bodyToHtml(body: string): string {
  const lines = String(body ?? "").replace(/\r\n|\r/g, "\n").split("\n");
  const blocks: string[] = [];
  let text: string[] = [];
  let items: string[] = [];
  const flushText = () => {
    if (!text.length) return;
    // A blank line right before a list still shows as a blank line.
    blocks.push(text.map(escapeHtml).join("<br>") + (text.length > 1 && text[text.length - 1] === "" ? "<br>" : ""));
    text = [];
  };
  const flushItems = () => {
    if (!items.length) return;
    blocks.push(`<ul style="margin:0;padding-left:24px">${items.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`);
    items = [];
  };
  for (const line of lines) {
    const b = BULLET.exec(line);
    if (b) {
      flushText();
      items.push(b[1]);
    } else {
      flushItems();
      text.push(line);
    }
  }
  flushText();
  flushItems();
  return blocks.join("");
}

/** What Gmail puts between the message and the signature (a blank line, then "-- " on its own line). */
export const GMAIL_SIGNATURE_PREFIX_HTML = '<br clear="all"><div><br></div><span class="gmail_signature_prefix">-- </span><br>';
export const SIGNATURE_PREFIX_TEXT = "\n\n-- \n";

/** Blank line only, used when the signature already starts with its own "--" line. */
export const SIGNATURE_GAP_HTML = '<br clear="all"><div><br></div>';
export const SIGNATURE_GAP_TEXT = "\n\n";

/**
 * Whether a signature already begins with a "--" separator line (many Gmail signatures do).
 * Then the app adds only a blank line, so the email never shows two "--" lines.
 */
export function signatureHasOwnSeparator(signature: string | null | undefined): boolean {
  const text = String(signature ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&#45;|&minus;|&#8211;|&ndash;|&#8212;|&mdash;/gi, "-")
    .trimStart();
  return /^[-\u2010-\u2015\u2212]{2}(\s|$)/.test(text);
}

/** The HTML part of an email: the message, then the signature (already sanitized when stored; sanitized again here). */
export function emailHtml(body: string, signatureHtml?: string | null): string {
  const sig = signatureHtml ? sanitizeSignatureHtml(signatureHtml) : "";
  const prefix = signatureHasOwnSeparator(sig) ? SIGNATURE_GAP_HTML : GMAIL_SIGNATURE_PREFIX_HTML;
  return `<div dir="ltr">${bodyToHtml(body)}${sig ? `${prefix}<div dir="ltr" class="gmail_signature">${sig}</div>` : ""}</div>`;
}

/** The plain text part of an email: the message, then "-- " (unless the signature has its own) and the plain signature. */
export function emailText(body: string, signatureText?: string | null): string {
  const b = String(body ?? "").replace(/\s+$/, "");
  const sig = String(signatureText ?? "").trim();
  const prefix = signatureHasOwnSeparator(sig) ? SIGNATURE_GAP_TEXT : SIGNATURE_PREFIX_TEXT;
  return sig ? `${b}${prefix}${sig}` : b;
}

/** The saved signature as the app uses it: shown and added only when there is one. */
export type SignatureSetup = { html: string; text: string; on: boolean };

/** Whether a saved signature is added by default (the setting; on when it was never changed). */
export function signatureOn(enabled: boolean | null | undefined, html: string | null | undefined): boolean {
  return !!String(html ?? "").trim() && enabled !== false;
}

/** A full HTML page for the preview frame (Gmail-like font, white background). */
export function previewDocument(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;background:#fff}body{padding:12px 14px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#222;overflow-wrap:anywhere}img{max-width:100%}a{color:#1a56c4}</style></head><body>${html}</body></html>`;
}
