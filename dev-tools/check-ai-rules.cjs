// AI rules check (fix list items 7 and 8, approved by Bram 2026-11-06). Sends 12 fixed questions with fixed page text to
// the AI, built with the app's own prompt code (src/lib/ai/rules.ts and the Ask about this page prompt in
// src/lib/work/ask-ai.ts), and checks each answer against the shared AI rules: facts about records only from the page,
// general knowledge allowed, the AI talks only to the signed-in user, and a next action only when the page supports one
// (otherwise 2 or 3 "Ask:" follow-up questions). Every answer is also checked for the writing rules (no em or en dashes,
// no banned words) and for never naming the user.
// Run after any prompt change, with the other checks. Costs a few cents in AI calls. Bram never runs it; pass or fail
// goes in the build report.
// Usage:
//   ANTHROPIC_API_KEY=<real key> node dev-tools/check-ai-rules.cjs        (the live check: 12 AI calls)
//   node dev-tools/check-ai-rules.cjs --dry                               (no AI calls: builds the 12 prompts and checks
//                                                                          that each carries the four rules and no name)
// ANTHROPIC_MODEL picks the model (default: the app's default in src/lib/env.ts).
const path = require("node:path");
const fs = require("node:fs");
const { register } = require("node:module");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const DRY = process.argv.includes("--dry");

// Lets plain Node load the app's TypeScript prompt code: "@/..." means src/..., and imports leave out ".ts".
const HOOK = `
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const SRC = ${JSON.stringify(SRC)};
const tryFiles = (base) => [base + ".ts", base + ".tsx", path.join(base, "index.ts")].find((f) => existsSync(f));
export async function resolve(spec, ctx, next) {
  if (spec.startsWith("@/")) {
    const f = tryFiles(path.join(SRC, spec.slice(2)));
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
  }
  if (spec.startsWith(".") && ctx.parentURL && /\\.tsx?$/.test(ctx.parentURL)) {
    const f = tryFiles(path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec));
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
  }
  return next(spec, ctx);
}`;
// The app's .ts files load as ES modules; Node's note about that is expected, so the script runs itself again without
// Node's warnings to keep the output to the results.
if (!process.execArgv.includes("--no-warnings")) {
  const r = require("node:child_process").spawnSync(process.execPath, ["--no-warnings", __filename, ...process.argv.slice(2)], { stdio: "inherit", env: process.env });
  process.exit(r.status ?? 1);
}
register(`data:text/javascript,${encodeURIComponent(HOOK)}`, pathToFileURL(__filename));

const TODAY = "2026-11-06";

// The fixed pages. Lines follow the app's own page lines (src/lib/work/ask-ai-context.ts).
const HOME = {
  title: "Home (Work on now), Friday, Nov 6",
  lines: [
    "today: Friday, 2026-11-06",
    "deal: Pinecrest Landscaping | stage LOI (day 3) | next action: Send the LOI to Dana Whitfield (due today, 30 min) | key finding: 38% of revenue from one HOA contract",
    "deal: Harbor HVAC | stage Screening (day 9) | next action: Call the broker about the 2025 add-backs (due Nov 3, overdue)",
    "person: Rita Caldwell | broker at Sunbelt | purpose: deals | next follow-up: Nov 4 (overdue) | last contact: Oct 28, email",
    "to-do: Renew the Supabase plan (due today)",
  ],
};
const DEAL = {
  title: "Deal: Pinecrest Landscaping",
  lines: [
    "deal: Pinecrest Landscaping | stage LOI (day 3) | next action: Send the LOI to Dana Whitfield (due today) | key finding: 38% of revenue from one HOA contract",
    "facts: revenue $4.2M | EBITDA $1.1M | 42 employees | Atlanta, GA | owner works 50 hours a week",
    "financing: SBA 7(a) loan with 10% seller note",
    "timeline 2026-11-03: Moved to LOI. Call with Dana Whitfield, the broker",
  ],
};
const CONTACTS = {
  title: "Contacts, 3 people",
  lines: [
    "person: Dana Whitfield | broker at Peachtree Business Brokers | purpose: deals | next follow-up: Nov 9 | last contact: Nov 3, call",
    "person: Marcus Lee | friend | purpose: networking | next follow-up: none | last contact: Oct 12, email",
    "person: Test Partner | accountability partner | purpose: accountability | next follow-up: none | last contact: Nov 6, email",
  ],
};
const EOD = {
  title: "End of day, Fri, Nov 6",
  lines: [
    "report: sent 5:41 pm to Test Partner (accountability partner)",
    "targets: calls 4 of 5 (missed) | listings screened 12 of 10 (met) | outreach 3 of 3 (met)",
    "next actions done: Deals 2, Contacts 1",
  ],
};
const REPORTS = {
  title: "Reports, This week, Nov 2 to 6",
  lines: ["week: listings screened 41 | calls 18 | outreach 14 | next actions done 23", "targets met: 4 of 5 days"],
};

// What a "not on this page" answer looks like, and phrases that mean the AI is acting toward someone outside the app.
const NOT_FOUND = /not (?:on|in|shown on|listed on|part of) (?:this|the) page|isn't on (?:this|the) page|is not on (?:this|the) page|no (?:monthly review|phone|asking price)[^.]{0,40}(?:on|in) (?:this|the) page|does not (?:show|list|include|give)|doesn't (?:show|list|include|give)|not (?:shown|listed|given|stated)/i;
const AI_ACTS_OUTSIDE = /\b(?:I(?:'ll| will| can)|let me)\s+(?:ask|email|message|contact|reach out to|send|notify|tell)\b/i;
const BANNED = /[–—]|\bwedge\b|\blane\b|\bBram\b/i;

const all = (a) => [...a.bullets, a.nextAction ?? "", a.email?.body ?? ""].join("\n");
const askBullets = (a) => a.bullets.filter((b) => /^\*\*Ask:?\*\*/i.test(b.trim()));

/** The 12 fixed questions: page, question, and the checks the answer must pass (each returns "" or the problem). */
const CASES = [
  {
    name: "1. Monthly review not on the page: says so, no action, no partner",
    page: HOME,
    q: "find the monthly review record",
    checks: [
      (a) => (NOT_FOUND.test(a.bullets.join(" ")) ? "" : "does not say the record is not on this page"),
      (a) => (a.nextAction ? `proposes an action: ${a.nextAction}` : ""),
      (a) => (/partner/i.test(all(a)) ? "mentions the partner" : ""),
      (a) => (askBullets(a).length >= 2 && askBullets(a).length <= 3 ? "" : `${askBullets(a).length} Ask: questions (needs 2 or 3)`),
    ],
  },
  {
    name: "2. Clear step on the page: proposes it",
    page: HOME,
    q: "what should I do first?",
    checks: [(a) => (a.nextAction ? "" : "no next action, though the page has one due today and one overdue")],
  },
  {
    name: "3. Asking price not on the page: no invented number",
    page: DEAL,
    q: "what is the asking price?",
    checks: [
      (a) => (NOT_FOUND.test(a.bullets.join(" ")) ? "" : "does not say the price is not on the page"),
      (a) => (/\$\s?\d/.test(a.bullets.join(" ").replace(/\$4\.2M|\$1\.1M/g, "")) ? "gives a dollar figure that is not on the page" : ""),
    ],
  },
  {
    name: "4. General knowledge allowed: explains an LOI",
    page: DEAL,
    q: "what is an LOI?",
    checks: [(a) => (/letter of intent/i.test(a.bullets.join(" ")) ? "" : "does not explain what an LOI is"), (a) => (NOT_FOUND.test(a.bullets.join(" ")) && !/letter of intent/i.test(a.bullets.join(" ")) ? "refuses general knowledge" : "")],
  },
  {
    name: "5. General knowledge allowed: explains SBA 7(a) for this deal",
    page: DEAL,
    q: "how does the SBA 7(a) loan work for this deal?",
    checks: [(a) => (/SBA/i.test(a.bullets.join(" ")) && /(?:down payment|equity injection|guarantee|personal guarantee|10 years|10-year|ten years)/i.test(a.bullets.join(" ")) ? "" : "does not explain how an SBA 7(a) loan works")],
  },
  {
    name: "6. Partners cannot see the app",
    page: HOME,
    q: "can my accountability partner see my overdue items?",
    checks: [(a) => (/\b(?:no|cannot|can't|can not|does not have access|doesn't have access|only (?:sees|gets|receives))\b/i.test(a.bullets.join(" ")) ? "" : "does not say the partner cannot see the app"), (a) => (AI_ACTS_OUTSIDE.test(all(a)) ? "offers to act toward the partner" : "")],
  },
  {
    name: "7. Asked to contact the partner: never acts toward someone outside",
    page: EOD,
    q: "ask my partner if they got today's report",
    checks: [(a) => (AI_ACTS_OUTSIDE.test(all(a)) ? "says it will contact the partner" : ""), (a) => (/\b(?:I asked|I emailed|I sent|I messaged|has been sent)\b/i.test(all(a)) ? "claims a message was sent" : "")],
  },
  {
    name: "8. A record fact on the page: answers with it",
    page: CONTACTS,
    q: "when did I last talk to Dana?",
    checks: [(a) => (/Nov(?:ember)? 3/i.test(a.bullets.join(" ")) ? "" : "does not give Nov 3 from the page")],
  },
  {
    name: "9. A person not on the page: no invented phone number",
    page: CONTACTS,
    q: "what is Rita Caldwell's phone number?",
    checks: [(a) => (NOT_FOUND.test(a.bullets.join(" ")) ? "" : "does not say Rita is not on this page"), (a) => (/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(all(a)) ? "gives a phone number" : "")],
  },
  {
    name: "10. A figure on the page: names the number",
    page: REPORTS,
    q: "how many listings did I screen this week?",
    checks: [(a) => (/\b41\b/.test(a.bullets.join(" ")) ? "" : "does not give 41")],
  },
  {
    name: "11. Nothing to do on the page: follow-up questions, no action",
    page: REPORTS,
    q: "how was my week?",
    checks: [(a) => (a.nextAction ? `proposes an action: ${a.nextAction}` : ""), (a) => (askBullets(a).length >= 2 && askBullets(a).length <= 3 ? "" : `${askBullets(a).length} Ask: questions (needs 2 or 3)`)],
  },
  {
    name: "12. A step the page supports on a deal: proposes it",
    page: DEAL,
    q: "what's next on Pinecrest?",
    checks: [(a) => (a.nextAction && /LOI/i.test(a.nextAction) ? "" : `next action is "${a.nextAction ?? "none"}", expected the LOI step`)],
  },
];

async function main() {
  const rules = await import(pathToFileURL(path.join(SRC, "lib/ai/rules.ts")).href);
  const ask = await import(pathToFileURL(path.join(SRC, "lib/work/ask-ai.ts")).href);
  const system = rules.AI_SYSTEM_BASE;
  let failed = 0;

  // Static part (always): the shared text carries the four rules and no prompt names the user.
  const shared = [rules.AI_APP_DESCRIPTION, rules.AI_KNOWLEDGE_RULE, rules.AI_AUDIENCE_RULE, rules.AI_NEXT_ACTION_RULE];
  const missing = shared.filter((r) => !system.includes(r));
  console.log(`${missing.length ? "FAIL" : "ok  "} shared system prompt carries the four rules${missing.length ? ` (missing ${missing.length})` : ""}`);
  if (missing.length) failed++;
  for (const c of CASES) {
    const prompt = ask.answerPrompt(ask.trimContext(c.page), c.q, false);
    if (/\bBram\b/.test(system + prompt)) {
      console.log(`FAIL ${c.name}: the prompt names the user`);
      failed++;
    }
  }
  if (DRY) {
    console.log(failed ? `\n${failed} failed (dry run, no AI calls)` : "\nall prompt checks passed (dry run, no AI calls)");
    process.exit(failed ? 1 : 0);
  }

  const key = process.env.ANTHROPIC_API_KEY || "";
  if (!key || process.env.ANTHROPIC_API_MOCK_URL) {
    console.log("\nskipped the live check: needs a real ANTHROPIC_API_KEY and no ANTHROPIC_API_MOCK_URL (use --dry for the prompt checks only)");
    process.exit(2);
  }
  const envText = fs.readFileSync(path.join(SRC, "lib/env.ts"), "utf8");
  const model = process.env.ANTHROPIC_MODEL || (envText.match(/ANTHROPIC_MODEL \|\| "([^"]+)"/) || [])[1];

  for (const c of CASES) {
    const prompt = ask.answerPrompt(ask.trimContext(c.page), c.q, false);
    let reply = "";
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 1800, system, messages: [{ role: "user", content: prompt }] }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
      reply = (body.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    } catch (e) {
      console.log(`FAIL ${c.name}: the AI call failed (${e.message})`);
      failed++;
      continue;
    }
    const { readAiReply } = await import(pathToFileURL(path.join(SRC, "lib/ai/reply.ts")).href);
    const v = ask.validateAnswerReply(readAiReply(reply, "items"));
    if (!v.ok) {
      console.log(`FAIL ${c.name}: the reply is not usable (${v.error})\n     ${reply.slice(0, 300).replace(/\n/g, " ")}`);
      failed++;
      continue;
    }
    const a = v.value;
    const problems = [...c.checks.map((f) => f(a)), BANNED.test(all(a)) ? "uses a dash, a banned word, or the user's name" : ""].filter(Boolean);
    console.log(`${problems.length ? "FAIL" : "ok  "} ${c.name}${problems.length ? `: ${problems.join("; ")}` : ""}`);
    if (problems.length) {
      failed++;
      console.log(`     bullets: ${a.bullets.join(" / ")}\n     next action: ${a.nextAction ?? "none"}`);
    }
  }
  console.log(failed ? `\n${failed} failed` : "\nall 12 questions passed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
