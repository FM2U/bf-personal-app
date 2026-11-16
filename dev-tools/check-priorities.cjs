// LOCAL TESTING ONLY: Top priorities (Bram, 2026-11-15; claude/2026-11-15-report-redesign-build-plan.md, step 2).
// The card on Home (four tracks) and on Deals, Job search, Consulting and Rosara (their own track); "+ Choose" adds a
// record; the star pill on a record page moves it to a place or takes it off; the Priority card saves Why it fits, How
// strong and the Next decision, drafts Why it fits with the AI, and Mark decided writes a decision and clears the Next
// decision. A listing and a closed deal show no star. Screenshots go to SHOTS_DIR (default /tmp/priorities-shots).
// Needs a fresh local database and the built app with the stand-ins, on a weekday clock (see all-checks).
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const { cookie } = require("./session.cjs");
const pg = require(path.join(__dirname, "..", "node_modules", "pg"));

const BASE = process.argv[2] || "http://localhost:3000";
const SHOTS = process.env.SHOTS_DIR || "/tmp/priorities-shots";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:5432/bf_dev" });
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const all = async (sql, args = []) => (await db.query(sql, args)).rows;

let failed = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${String(e && e.message ? e.message : e).split("\n").slice(0, 4).join("\n     ")}`);
  }
}
const assert = (c, msg) => {
  if (!c) throw new Error(msg);
};
const until = async (fn, msg, tries = 80) => {
  for (let i = 0; i < tries; i++) {
    if (await fn().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(msg);
};
const ranks = async (kind) => (await all(`select i.name, i.priority_rank from pipeline_items i join pipelines p on p.id = i.pipeline_id where p.kind = $1 and i.priority_rank is not null order by i.priority_rank`, [kind])).map((r) => `${r.priority_rank}:${r.name}`).join(", ");
const idOf = async (name) => (await one("select id from pipeline_items where name = $1 order by created_at limit 1", [name])).id;

(async () => {
  await db.connect();
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ env: { ...process.env, LD_PRELOAD: "", FAKETIME: "" } });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([cookie]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
  const open = async (p) => {
    await page.goto(`${BASE}${p}`);
    await page.waitForLoadState("networkidle");
  };
  const card = () => page.getByTestId("top-priorities");
  const track = (kind) => card().locator(`[data-testid="priority-track"][data-kind="${kind}"]`);
  const picks = async (kind) => (await track(kind).getByTestId("pick-name").allInnerTexts()).join(" | ");
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

  await step("Sample data is loaded (with its picks: three deals, one job, one consulting lead, one Rosara project)", async () => {
    await open("/settings/data");
    if (!(await page.getByText("Sample data loaded").count()) && (await page.getByTestId("sample-load").count())) {
      const confirm = page.getByTestId("sample-confirm-real");
      if (await confirm.count()) await confirm.check();
      await page.getByTestId("sample-load").click();
      await page.getByText("Sample data loaded").first().waitFor({ timeout: 60000 });
    }
    assert((await ranks("acquisition")) === "1:Dalton Services, 2:Meridian Industrial Coatings, 3:Pinecrest Landscaping", await ranks("acquisition"));
  });

  await step("Home: Top priorities above the tiles, four tracks; Dalton is #1 with its stage, Hot, day N, Why and Next; one '+ Choose' slot under a track with fewer than three", async () => {
    await open("/work");
    await card().waitFor({ timeout: 20000 });
    const kinds = await card().getByTestId("priority-track").evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
    assert(kinds.join(",") === "acquisition,job,consulting,startup", kinds.join(","));
    assert((await picks("acquisition")) === "Dalton Services | Meridian Industrial Coatings | Pinecrest Landscaping", await picks("acquisition"));
    const d = track("acquisition").getByTestId("priority-pick").first();
    const t = (await d.innerText()).replace(/\s+/g, " ");
    assert(t.startsWith("1 Dalton Services") && t.includes("Broker call") && t.includes("Hot") && /day \d+/.test(t) && t.includes("Why: Recurring service contracts") && t.includes("Next: go or no-go on an LOI by"), t);
    assert(!(await track("acquisition").getByTestId("priority-choose").count()), "a slot under a full track");
    assert((await track("job").getByTestId("priority-choose").innerText()).includes("Choose a job"), "no job slot");
    assert((await picks("job")) === "Director of Operations, Harbor Health Partners", await picks("job"));
    assert((await picks("consulting")) === "Q1 site selection, Sullivan Wickley", await picks("consulting"));
    assert((await picks("startup")) === "Market research", await picks("startup"));
    assert((await track("acquisition").getByTestId("priority-count").innerText()) === "3 of 3", "count");
    // Picks side by side line up: every pick has the same height.
    const heights = await card().getByTestId("priority-pick").evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().height)))]);
    assert(heights.length === 1, `pick heights ${heights.join(",")}`);
    const cardTop = (await card().boundingBox()).y;
    const tilesTop = (await page.getByTestId("home-tiles").boundingBox()).y;
    assert(cardTop < tilesTop, "the card is not above the tiles");
    await shot("home");
  });

  await step("Deals, Job search, Consulting and Rosara: the card shows the page's own track", async () => {
    for (const [p, kind] of [["/work/deals", "acquisition"], ["/work/jobs", "job"], ["/work/consulting", "consulting"], ["/work/rosara", "startup"]]) {
      await open(p);
      await card().waitFor({ timeout: 20000 });
      const kinds = await card().getByTestId("priority-track").evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
      assert(kinds.join(",") === kind, `${p}: ${kinds.join(",")}`);
      if (kind === "acquisition") await shot("deals");
    }
  });

  await step("Job search: '+ Choose a job' lists the open jobs not picked yet; choosing Lumen makes it #2", async () => {
    await open("/work/jobs");
    await track("job").getByTestId("priority-choose").click();
    const list = page.getByTestId("priority-choices");
    await list.getByTestId("priority-choice").first().waitFor({ timeout: 15000 });
    const names = await list.getByTestId("priority-choice").allInnerTexts();
    assert(names.some((n) => n.includes("Lumen Industrial Holdings")) && !names.some((n) => n.includes("Harbor Health")) && !names.some((n) => n.includes("Atlas Freight")), names.join(" | "));
    await list.getByTestId("priority-find").fill("lumen");
    await list.getByTestId("priority-choice").filter({ hasText: "Lumen" }).click();
    await until(async () => (await ranks("job")) === "1:Harbor Health Partners, 2:Lumen Industrial Holdings", `jobs: ${await ranks("job")}`);
    await until(async () => (await picks("job")).includes("Lumen"), "Lumen is not on the card");
  });

  await step("Deal page: the star pill next to the stage; Meridian moved to #1 puts Dalton at #2 and Pinecrest at #3", async () => {
    await open(`/work/deals/${await idOf("Meridian Industrial Coatings")}`);
    const star = page.getByTestId("priority-star");
    assert((await star.innerText()).includes("Top priority · #2"), await star.innerText());
    await star.click();
    const menu = page.getByTestId("priority-menu");
    assert((await menu.innerText()).includes("now Dalton Services"), await menu.innerText());
    await menu.getByTestId("priority-place").first().click();
    await until(async () => (await ranks("acquisition")) === "1:Meridian Industrial Coatings, 2:Dalton Services, 3:Pinecrest Landscaping", `deals: ${await ranks("acquisition")}`);
    await until(async () => (await page.getByTestId("priority-star").innerText()).includes("#1"), "the pill did not change to #1");
    await shot("deal-page");
  });

  await step("Remove from top priorities: Pinecrest comes off; a deal that is not a pick shows 'Make a top priority'", async () => {
    await open(`/work/deals/${await idOf("Pinecrest Landscaping")}`);
    await page.getByTestId("priority-star").click();
    await page.getByTestId("priority-remove").click();
    await until(async () => (await ranks("acquisition")) === "1:Meridian Industrial Coatings, 2:Dalton Services", `deals: ${await ranks("acquisition")}`);
    await until(async () => (await page.getByTestId("priority-star").innerText()).includes("Make a top priority"), "no Make a top priority");
  });

  await step("Priority card: Why it fits, How strong and the Next decision save; a later date shows 'moved to' in amber on Home", async () => {
    const id = await idOf("Dalton Services");
    await open(`/work/deals/${id}`);
    const c = page.getByTestId("priority-card");
    await c.getByTestId("priority-why").fill("Service contracts · owner retiring · my field ops background");
    await c.getByTestId("priority-strength-option").filter({ hasText: "Cold" }).click();
    await until(async () => (await one("select strength, why_fits from pipeline_items where id = $1", [id])).strength === "cold", "How strong not saved");
    assert((await one("select why_fits from pipeline_items where id = $1", [id])).why_fits === "Service contracts · owner retiring · my field ops background", "Why it fits not saved on leaving the box");
    const was = (await one("select next_decision_on::text d from pipeline_items where id = $1", [id])).d;
    const later = new Date(new Date(`${was}T12:00:00Z`).getTime() + 7 * 86400000).toISOString().slice(0, 10);
    await c.getByTestId("priority-next").fill("Go or no-go on the LOI");
    await c.getByTestId("priority-next-on").fill(later);
    await c.getByTestId("priority-next").click();
    await until(async () => (await one("select next_decision_on::text d, next_decision from pipeline_items where id = $1", [id])).d === later, "the date was not saved");
    await open("/work");
    const pick = track("acquisition").getByTestId("priority-pick").filter({ hasText: "Dalton Services" });
    const next = pick.getByTestId("pick-next");
    assert((await next.getAttribute("data-amber")) === "1" && (await next.innerText()).includes("moved to"), await next.innerText());
    assert((await pick.getByTestId("pick-strength").innerText()).includes("Cold"), "Cold not on the card");
  });

  await step("Draft with AI fills Why it fits and saves it", async () => {
    const id = await idOf("Meridian Industrial Coatings");
    await open(`/work/deals/${id}`);
    const c = page.getByTestId("priority-card");
    const before = await c.getByTestId("priority-why").inputValue();
    await c.getByTestId("priority-draft").click();
    await until(async () => (await c.getByTestId("priority-why").inputValue()) !== before, "the box did not change");
    await until(async () => (await one("select why_fits from pipeline_items where id = $1", [id])).why_fits === (await c.getByTestId("priority-why").inputValue()), "the draft was not saved");
  });

  await step("Mark decided: a No-go with its line is saved for today, the Next decision is cleared, and the line shows under it", async () => {
    const id = await idOf("Meridian Industrial Coatings");
    await open(`/work/deals/${id}`);
    const c = page.getByTestId("priority-card");
    await c.getByTestId("priority-mark-decided").click();
    await c.getByTestId("priority-outcome").filter({ hasText: "No-go" }).click();
    await c.getByTestId("priority-decide-line").fill("Two customers are 60% of revenue");
    await c.getByTestId("priority-decide-save").click();
    await until(async () => !!(await one("select outcome from decisions where pipeline_item_id = $1", [id])), "no decision row");
    const d = await one("select outcome, line, decided_on::text as on_day from decisions where pipeline_item_id = $1", [id]);
    assert(d.outcome === "no_go" && d.line === "Two customers are 60% of revenue", JSON.stringify(d));
    const r = await one("select next_decision, next_decision_on from pipeline_items where id = $1", [id]);
    assert(r.next_decision === null && r.next_decision_on === null, JSON.stringify(r));
    await until(async () => (await page.getByTestId("priority-last-decision").innerText()).includes("no-go (Two customers are 60% of revenue)"), "the decision line is not shown");
  });

  await step("A listing shows no star and no Priority card; a closed pick leaves the card", async () => {
    const listing = await one("select id from pipeline_items where screened = false and status = 'open' limit 1");
    await open(`/work/deals/${listing.id}`);
    assert(!(await page.getByTestId("priority-star").count()) && !(await page.getByTestId("priority-card").count()), "a listing has the priority controls");
    await db.query("update pipeline_items set status = 'lost' where name = 'Dalton Services'");
    await open("/work");
    assert((await picks("acquisition")) === "Meridian Industrial Coatings", await picks("acquisition"));
    await db.query("update pipeline_items set status = 'open' where name = 'Dalton Services'");
  });

  await step("Rosara project page: the star and the Priority card", async () => {
    const p = await one("select id from projects where name = 'Market research'");
    await open(`/work/rosara/${p.id}`);
    assert((await page.getByTestId("priority-star").innerText()).includes("#1"), "no #1 on Market research");
    await page.getByTestId("priority-card").waitFor();
  });

  await step("Report (2026-11-16): Why/Now/Next labels in the number's cobalt with gaps between lines; an unnamed listing shows without '00 '; an Edit box left open while the report changes saves nothing; the gray 'Edited' word never unticks; an Edit goes into every copy", async () => {
    const eod = async () => (await one("select report_edits from end_of_day order by day desc limit 1")) || { report_edits: {} };
    const pick = await one("select p.id, p.name, p.company_name from pipeline_items p where p.priority_rank = 1 and p.status = 'open' and p.pipeline_id = (select id from pipelines where kind = 'acquisition' limit 1)");
    await db.query("update pipeline_items set company_name = null, name = '00 Commercial Test Services' where id = $1", [pick.id]);
    await open("/work/end-of-day");
    await page.getByTestId("report-view").click();
    const prev = page.getByTestId("report-preview");
    await prev.waitFor();
    const html = await prev.innerHTML();
    assert(/color:\s*(#1e40af|rgb\(30, 64, 175\))[^>]*>Why:/.test(html) && /padding-top:\s*10px/.test(html), "the Why label is not cobalt or has no gap above it");
    const text = (await prev.innerText()).replace(/\s+/g, " ");
    assert(text.includes("Commercial Test Services") && !text.includes("00 Commercial Test Services"), "the '00 ' start shows to partners");
    const sec = (k) => page.locator(`[data-testid=report-section][data-section=${k}]`);
    // An Edit box open on Acquisition while its text changes: closing asks nothing and saves no edit.
    await sec("acquisition").getByTestId("section-edit").click();
    await sec("acquisition").getByTestId("section-edit-text").waitFor();
    await db.query("update pipeline_items set next_action = 'Call the owner about the lease' where id = $1", [pick.id]);
    await sec("tomorrow").getByTestId("section-include").uncheck();
    await page.waitForTimeout(2000);
    await sec("tomorrow").getByTestId("section-include").check();
    await page.waitForTimeout(1500);
    await page.getByTestId("report-window-close").click();
    await page.waitForTimeout(800);
    assert(!(await page.getByTestId("unsaved-warning").count()), "closing asked to save text that was never typed");
    const e1 = (await eod()).report_edits || {};
    assert(!(e1._section_edits && e1._section_edits.acquisition) && !Object.values(e1).some((v) => v && v.edits && v.edits.acquisition), `an edit was saved: ${JSON.stringify(e1)}`);
    // A real Edit: saved once for the day; the gray 'Edited' word does not untick the section when clicked.
    await page.getByTestId("report-view").click();
    await prev.waitFor();
    await sec("tomorrow").getByTestId("section-edit").click();
    await sec("tomorrow").getByTestId("section-edit-text").fill("Edited line for every copy");
    await sec("tomorrow").getByTestId("section-edit-save").click();
    await page.waitForTimeout(1500);
    await sec("tomorrow").getByTestId("section-edited-mark").click();
    await page.waitForTimeout(800);
    assert((await sec("tomorrow").getAttribute("data-included")) === "1", "a click on 'Edited' unticked the section");
    const e2 = (await eod()).report_edits || {};
    assert(e2._section_edits && e2._section_edits.tomorrow === "Edited line for every copy", JSON.stringify(e2));
    const other = page.locator("[data-testid=report-tab]").nth(1);
    if (await other.count()) {
      await other.click();
      await page.waitForTimeout(1000);
      assert((await prev.innerText()).includes("Edited line for every copy"), "the Edit is not in the other partner's copy");
    }
    await page.getByTestId("report-window-close").click();
    await db.query("update pipeline_items set name = $2, company_name = $3 where id = $1", [pick.id, pick.name, pick.company_name]);
  });

  await step("No page showed an error in the browser", async () => {
    assert(errors.length === 0, errors.slice(0, 3).join("\n"));
  });

  await browser.close();
  await db.end();
  console.log(failed ? `${failed} failed` : "all passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
