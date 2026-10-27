/**
 * The morning plan is short: "Top 3" (exactly three things to do first) and "Watch" (alerts, runway, open decisions).
 * The full task list is not repeated in it (Home and Productivity show the tasks next to it). Pure functions, tested
 * in src/lib/morning-plan.test.ts; the plan is written in src/lib/engine/run.ts (AI, or the template without AI).
 */

/** The sections a stored plan keeps, in this order, and how many bullets each may have. */
export const PLAN_SECTIONS: { name: string; max: number }[] = [
  { name: "Top 3", max: 3 },
  { name: "Watch", max: 5 },
];

export type PlanSection = { name: string; lines: string[] };

/** A section label: a short bold line ("**Top 3**", "**Watch:**") or a heading ("## Watch"). */
function labelOf(line: string): string | null {
  const t = line.trim();
  const bold = t.match(/^\*\*([^*]{1,40}?)\*\*:?$/) ?? t.match(/^\*\*([^*]{1,40}?):\*\*$/);
  if (bold) return bold[1].trim().replace(/:$/, "");
  const heading = t.match(/^#{1,6}\s+(.{1,40})$/);
  if (heading) return heading[1].replace(/\*\*/g, "").trim().replace(/:$/, "");
  return null;
}

/** The plan's sections in order (text before the first label is a section with an empty name). */
export function planSections(content: string): PlanSection[] {
  const out: PlanSection[] = [];
  let cur: PlanSection = { name: "", lines: [] };
  for (const line of content.split("\n")) {
    const label = labelOf(line);
    if (label !== null) {
      if (cur.name || cur.lines.some((l) => l.trim())) out.push(cur);
      cur = { name: label, lines: [] };
    } else cur.lines.push(line);
  }
  if (cur.name || cur.lines.some((l) => l.trim())) out.push(cur);
  return out.map((s) => ({ ...s, lines: trimBlank(s.lines) }));
}

function trimBlank(lines: string[]): string[] {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
}

const isTopBullet = (l: string) => /^[-*+]\s+/.test(l) || /^\d+[.)]\s+/.test(l);
const sameName = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]/g, "") === b.toLowerCase().replace(/[^a-z0-9]/g, "");

/** At most `max` top-level bullets (each with its own sub-bullets). */
function limitBullets(lines: string[], max: number): string[] {
  const out: string[] = [];
  let count = 0;
  for (const l of lines) {
    if (isTopBullet(l)) {
      count++;
      if (count > max) break;
    }
    if (count === 0 && !l.trim()) continue;
    out.push(l);
  }
  return trimBlank(out);
}

function render(sections: PlanSection[]): string {
  return sections.map((s) => [`**${s.name}**`, ...s.lines].join("\n")).join("\n\n");
}

/**
 * Splits a plan into what Home shows (Top 3 and Watch, bullets limited) and the rest (any other section, such as an
 * older plan's "Also today"), shown only under "Show all".
 */
export function splitMorningPlan(content: string): { main: string; rest: string } {
  const sections = planSections(content);
  const known = PLAN_SECTIONS.map((p) => sections.find((s) => sameName(s.name, p.name)) && { name: p.name, lines: limitBullets(sections.find((s) => sameName(s.name, p.name))!.lines, p.max) }).filter(Boolean) as PlanSection[];
  if (!known.length) return { main: content.trim(), rest: "" };
  const others = sections.filter((s) => s.name && !PLAN_SECTIONS.some((p) => sameName(s.name, p.name)));
  // Bullets cut from a known section move to the rest, so nothing is lost.
  const cut = PLAN_SECTIONS.map((p) => {
    const s = sections.find((x) => sameName(x.name, p.name));
    if (!s) return null;
    const kept = limitBullets(s.lines, p.max).length;
    const extra = trimBlank(s.lines.slice(kept));
    return extra.some((l) => l.trim()) ? { name: `More: ${p.name}`, lines: extra } : null;
  }).filter(Boolean) as PlanSection[];
  return { main: render(known), rest: render([...cut, ...others]) };
}

/** The plan as it is stored: only Top 3 (three bullets) and Watch (up to five). A plan with neither is kept as written. */
export function trimMorningPlan(content: string): string {
  return splitMorningPlan(content).main;
}
