/**
 * The AI reply reader (Edit batch B, item 2; pure, tested in src/lib/ai/reply.test.ts), one for every AI feature:
 * the first JSON value in a reply (fenced or bare), a bare JSON string, or plain text read as the shape the feature
 * asked for (one text, or lines as items). The strict checks of each feature then run on the value, and callForJson
 * (src/lib/ai/claude.ts) asks once more with only JSON accepted when the check fails.
 */

/** Extract the first JSON value from a model reply. */
export function parseJsonFromText<T>(s: string): T | null {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = m ? m[1] : s;
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  try {
    return JSON.parse(body.slice(start)) as T;
  } catch {
    const end = Math.max(body.lastIndexOf("]"), body.lastIndexOf("}"));
    try {
      return JSON.parse(body.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}

/**
 * How a plain-text reply is read when the AI does not answer with JSON (Edit batch B, item 2): "text" takes the
 * whole reply as one text (a field draft, the weekly focus); "items" takes its lines as a list (tasks, questions,
 * next steps, the AI order); "none" accepts only JSON (the listing fields).
 */
export type ReplyShape = "text" | "items" | "none";

const BULLET = /^\s*(?:[-*\u2022]|\d+[.)])\s+/;

/** A short line ending in a colon between bulleted lines: a group heading ("Ask the broker:"), kept for the grouped readers. */
const HEADING = /^\s*[^-*\u2022\d][^:]{0,22}:\s*$/;

/**
 * The lines of a plain-text reply as a list: when the reply has bulleted or numbered lines, only those and the short
 * group headings between them (a lead-in such as "Here are a few things to do:" and a closing remark are not items);
 * otherwise every non-empty line. Bullets, numbers, and surrounding quotes are stripped.
 */
export function replyLines(raw: string): string[] {
  const lines = raw.replace(/```[a-z]*\s*|```/g, "").split(/\r?\n/);
  const bulleted = lines.filter((l) => BULLET.test(l));
  return (bulleted.length ? lines.filter((l) => BULLET.test(l) || HEADING.test(l)) : lines)
    .map((l) => l.replace(BULLET, "").trim())
    .map((l) => l.replace(/^["\u201c](.*)["\u201d],?$/, "$1").trim())
    .filter(Boolean);
}

/**
 * The AI reply reader, one for every feature. In order: the first JSON value in the reply (fenced or bare); a bare
 * JSON string ("...") read as text; otherwise the plain text as the shape asks: {text} with the whole reply, or
 * {items} with its lines. Returns null only for the "none" shape without JSON. The validators then check the value.
 */
export function readAiReply(raw: string, shape: ReplyShape = "none"): unknown {
  const text = String(raw ?? "").trim();
  const parsed = parseJsonFromText<unknown>(text);
  if (parsed !== null && typeof parsed === "object") return parsed;
  const unfenced = text.replace(/^```[a-z]*\s*|```$/g, "").trim();
  if (/^"[^]*"$/.test(unfenced)) {
    try {
      const str = JSON.parse(unfenced) as unknown;
      if (typeof str === "string") return shape === "items" ? { items: replyLines(str) } : { text: str.trim() };
    } catch {
      /* not a JSON string: read as plain text below */
    }
  }
  if (shape === "none") return null;
  if (!unfenced) return null;
  if (shape === "items") return { items: replyLines(unfenced) };
  const lines = replyLines(unfenced);
  return { text: lines.length === 1 ? lines[0] : unfenced };
}

/** The first 300 characters of a reply, on one line, for the "could not be used" message. */
export function replySnippet(raw: string, max = 300): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

