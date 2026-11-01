import type { Row } from "@/lib/types";

/** One line of a record's timeline (notes, emails, calls, stage moves), shared by the deal page and the person page. */
export type TimelineEvent = { id: string; kind: "note" | "email" | "call" | "move" | "other"; when: string; date: string; title: string; detail: string | null; href: string | null };

/** "Email received: CIM received", "Call with Rachel Kim, 20 min" (no "Call:" twice), "Meeting: ...". */
export function commTitle(c: Row): string {
  const kind = c.method === "email" ? (c.direction === "incoming" ? "Email received" : "Email sent") : c.method === "call" ? "Call" : c.method === "meeting" ? "Meeting" : c.method === "video" ? "Video call" : "Contact";
  const subject = c.subject ? String(c.subject).slice(0, 120) : "";
  const minutes = c.call_minutes && c.method !== "email" && !/\d+ min\b/.test(subject) ? `, ${Number(c.call_minutes)} min` : "";
  if (!subject) return `${kind}${minutes}`;
  if (new RegExp(`^${c.method === "email" ? "email" : kind}\\b`, "i").test(subject)) return `${subject}${minutes}`;
  return `${kind}: ${subject}${minutes}`;
}

/** The timeline kind of a communication: email, call (calls, meetings, video), or other. */
export function commKind(method: unknown): TimelineEvent["kind"] {
  return method === "email" ? "email" : method === "call" || method === "meeting" || method === "video" ? "call" : "other";
}
