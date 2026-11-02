# Regenerates the combined SQL files from supabase/migrations:
#   supabase/ALL_MIGRATIONS_RUN_ONCE.sql  every migration (new, empty project)
#   supabase/UPDATE_RUN_ONCE.sql          0008 to 0027 (full catch-up for an existing project with 0001 to 0007 or later)
#   supabase/UPDATE_0027_RUN_ONCE.sql     0027 only (the live database: 0001 to 0026)
#   supabase/UPDATE_0026_RUN_ONCE.sql     0026 only (a database with 0001 to 0025)
#   supabase/UPDATE_0025_RUN_ONCE.sql     0025 only (a database with 0001 to 0024)
#   supabase/UPDATE_0024_RUN_ONCE.sql     0024 only (a database with 0001 to 0023)
#   supabase/UPDATE_0023_RUN_ONCE.sql     0023 only (a database with 0001 to 0022)
#   supabase/UPDATE_0022_RUN_ONCE.sql     0022 only (a database with 0001 to 0021)
#   supabase/UPDATE_0021_RUN_ONCE.sql     0021 only (a database with 0001 to 0020)
#   supabase/UPDATE_0020_RUN_ONCE.sql     0020 only (a database with 0001 to 0019)
#   supabase/UPDATE_0019_RUN_ONCE.sql     0019 only (a database with 0001 to 0018)
#   supabase/UPDATE_0018_RUN_ONCE.sql     0018 only (a database with 0001 to 0017)
#   supabase/UPDATE_0017_RUN_ONCE.sql     0017 only (a database with 0001 to 0016)
#   supabase/UPDATE_0016_RUN_ONCE.sql     0016 only (a database with 0001 to 0015)
#   supabase/UPDATE_0015_RUN_ONCE.sql     0015 only (a database with 0001 to 0014)
#   supabase/UPDATE_0013_0014_RUN_ONCE.sql 0013 then 0014 (the live database: 0001 to 0012, or 0001 to 0013)
#   supabase/UPDATE_0014_RUN_ONCE.sql     0014 only (a database that already has 0001 to 0013)
#   supabase/UPDATE_0013_RUN_ONCE.sql     0013 only (kept for reference; use UPDATE_0013_0014_RUN_ONCE.sql instead)
#   supabase/UPDATE_0011_0012_RUN_ONCE.sql 0011 then 0012 (the live database: 0001 to 0010, or 0001 to 0011)
#   supabase/UPDATE_0012_RUN_ONCE.sql     0012 only (a database that already has 0001 to 0011)
#   supabase/UPDATE_0011_RUN_ONCE.sql     0011 only (kept for reference; use UPDATE_0011_0012_RUN_ONCE.sql instead)
#   supabase/UPDATE_0008_RUN_ONCE.sql     0008 only (kept for reference; use UPDATE_RUN_ONCE.sql instead)
# Usage (from the repository root): python3 supabase/build_combined.py
import glob

files = sorted(glob.glob("supabase/migrations/[0-9][0-9][0-9][0-9]_*.sql"))
last = files[-1].split("/")[-1][:4]
header = (
    f"-- BF Personal App: all database migrations combined (0001 to {last}), for one paste into the Supabase SQL Editor.\n"
    "-- Generated from supabase/migrations. Run once on a new, empty project.\n\n"
)
parts = [f"-- ===== {f} =====\n" + open(f).read() for f in files]
open("supabase/ALL_MIGRATIONS_RUN_ONCE.sql", "w").write(header + "\n".join(parts))

update_files = [f for f in files if f.split("/")[-1][:4] >= "0008"]
update = (
    "-- BF Personal App: database update (0008, 0009, 0010, 0011, 0012, 0013, 0014, 0015, 0016, 0017, 0018, 0019, 0020, 0021, 0022, 0023, 0024, 0025, 0026, and 0027).\n"
    "--   0008: Daily Targets and Outreach Queue.\n"
    "--   0009: Stage task lists, stage time limits, required details, stalled items, deal source (proprietary or brokered),\n"
    "--         deal-source contacts, and the Deals sourced and Deals advanced targets.\n"
    "--   0010: Commitment rule: only pipeline next actions, milestones, daily targets, and reviews are commitments;\n"
    "--         regular tasks that are not done move to the next day; the weekly review lists tasks moved 5 or more times.\n"
    "--   0011: Deal source chain (Deal came from, Introduced by) and the Consulting initiative and pipeline.\n"
    "--   0012: Relationship groups Friend and Other; runway setting text (signed work counts until its first payment).\n"
    "--   0013: Send email from the app: Gmail message ids on communications; partner reports marked sent with the date.\n"
    "--   0014: Start an initiative (drafts, plan documents, checklists), weekly AI savings ideas, sample data, Reset data.\n"
    "--   0015: Gmail signature on emails sent or drafted from the app (four columns on owner_profile).\n"
    "--   0016: Deal funnel: Listings screened, CIMs reviewed, and Broker or owner calls targets; search hours and minutes per step.\n"
    "--   0017: Partner report templates (Summary, Standard, Detailed, and your own) and a default template per partner.\n"
    "--   0018: Resolve a miss as Done late; daily partner reports (report frequency Daily, Weekly, or Both; the day period).\n"
    "--   0019: The focused version, batch 1: daily outcomes (Today and Close the day), focused hours, changes and tomorrow's priority,\n"
    "--         waiting on someone (tasks), and sample data and reset for daily outcomes.\n"
    "--   0020: The Work module, batch A: listing and deal facts on pipeline items, the acquisition stages Interested to Diligence\n"
    "--         (plus Closed, Passed, Lost) with their default next actions, the waiting setting, and a check function.\n"
    "--   0021: Edit batch A: company name and open questions (three groups) on pipeline items, the \"Also to do\" checklist per deal\n"
    "--         (deal_todos), \"Chase\" renamed \"Follow up\" in the stage defaults, and a check function.\n"
    "--   0022: Batch B: Outreach fields on contacts, call fields and incoming replies on communications, personal to-dos, the outreach\n"
    "--         target setting, tasks on any record, Rosara projects, the Job search and Consulting stages, opportunity fields, the AI order cache.\n"
    "--   0023: Batch B2: findings with a source link on the timeline (notes.kind, notes.source_url) and the pay range of a job opportunity.\n"
    "--   0024: Edit batch B: Broker call moves after CIM review in the acquisition stages; the NDA signed default becomes \"Ask the broker for the CIM\".\n"
    "--   0025: Batch C: Targets counted from the app's own data (counts_key, archived), work events (next actions and follow-ups done, the Rosara focus done),\n"
    "--         End of day rows (reasons, tomorrow's line, sent or skipped, the email as sent), End of day reports as partner reports.\n"
    "--   0026: Edit batch C round 2: the outreach role \"Former colleague\" becomes \"Personal network\" (contacts moved over by UPDATE).\n"
    "--   0027: The original listing text, year established, and employees on pipeline items (three empty columns).\n"
    "-- For a database that already has 0001 to 0007 (or 0001 to 0008, 0009, 0010, 0011, 0012, 0013, 0014, 0015, 0016, 0017, 0018, 0019, 0020, 0021, 0022, 0023, 0024, 0025, or 0026). Paste this whole file into the\n"
    "-- Supabase SQL Editor and press Run. Safe to run more than once: nothing is duplicated.\n"
    "-- Generated from supabase/migrations by supabase/build_combined.py.\n\n"
)
open("supabase/UPDATE_RUN_ONCE.sql", "w").write(update + "\n".join(f"-- ===== {f} =====\n" + open(f).read() for f in update_files))

m11 = open("supabase/migrations/0011_source_chain_consulting.sql").read()
m12 = open("supabase/migrations/0012_contacts_sources.sql").read()

u1112 = (
    "-- BF Personal App: database updates 0011 and 0012, in one paste.\n"
    "-- For the live database, which has 0001 to 0010 (or 0001 to 0011, if UPDATE_0011_RUN_ONCE.sql was already run).\n"
    "-- Paste this whole file into the Supabase SQL Editor and press Run. Safe to run more than once: nothing is duplicated.\n"
    "-- (A database with only 0001 to 0007, 0008, or 0009 uses supabase/UPDATE_RUN_ONCE.sql instead, which includes both.)\n"
    "-- What it adds:\n"
    "--   0011: Pipeline items: \"Introduced by\". The Consulting initiative and pipeline (stages, stage task lists, time limits,\n"
    "--         required details, stage probabilities), consulting details per item, payments linked to an engagement,\n"
    "--         \"Consulting lead\" on contacts, the consulting outreach purpose, and three inputs (runway and scenarios).\n"
    "--   0012: Relationship groups Friend (every 30 days) and Other (no set schedule); the runway setting text\n"
    "--         (a signed engagement counts until its first payment).\n"
    "-- Generated from supabase/migrations/0011_source_chain_consulting.sql and 0012_contacts_sources.sql by supabase/build_combined.py.\n\n"
)
open("supabase/UPDATE_0011_0012_RUN_ONCE.sql", "w").write(
    u1112 + "-- ===== supabase/migrations/0011_source_chain_consulting.sql =====\n" + m11 + "\n-- ===== supabase/migrations/0012_contacts_sources.sql =====\n" + m12
)

u12 = (
    "-- BF Personal App: database update 0012 (relationship groups Friend and Other; runway setting text).\n"
    "-- For a database that already has 0001 to 0011. Paste this whole file into the Supabase SQL Editor and press Run.\n"
    "-- Safe to run more than once. (The live database with 0001 to 0010 uses supabase/UPDATE_0011_0012_RUN_ONCE.sql.)\n"
    "-- Generated from supabase/migrations/0012_contacts_sources.sql by supabase/build_combined.py.\n\n"
)
open("supabase/UPDATE_0012_RUN_ONCE.sql", "w").write(u12 + m12)

u11 = (
    "-- USE supabase/UPDATE_0011_0012_RUN_ONCE.sql INSTEAD. That file runs this update (0011) and the next one (0012).\n"
    "-- This file is kept for reference only. Running it first does no harm: the combined file is safe after it.\n"
    "--\n"
    "-- BF Personal App: database update 0011 (deal source chain and the Consulting pipeline).\n"
    "-- For a database that has 0001 to 0010. Safe to run more than once: nothing is duplicated.\n"
    "-- Generated from supabase/migrations/0011_source_chain_consulting.sql by supabase/build_combined.py.\n\n"
)
open("supabase/UPDATE_0011_RUN_ONCE.sql", "w").write(u11 + m11)

u13 = (
    "-- USE supabase/UPDATE_0013_0014_RUN_ONCE.sql INSTEAD. That file runs this update (0013) and the next one (0014).\n"
    "-- This file is kept for reference only. Running it first does no harm: the combined file is safe after it.\n"
    "--\n"
    "-- BF Personal App: database update 0013 (send email from the app).\n"
    "-- For the live database, which has 0001 to 0012. Paste this whole file into the Supabase SQL Editor and press Run.\n"
    "-- Safe to run more than once: nothing is duplicated. It only adds empty columns and a check function:\n"
    "--   communications.gmail_message_id, communications.gmail_thread_id, partner_reports.sent_at, partner_reports.gmail_message_id.\n"
    "-- Generated from supabase/migrations/0013_gmail_send.sql by supabase/build_combined.py.\n\n"
)
open("supabase/UPDATE_0013_RUN_ONCE.sql", "w").write(u13 + open("supabase/migrations/0013_gmail_send.sql").read())

m13 = open("supabase/migrations/0013_gmail_send.sql").read()
m14 = open("supabase/migrations/0014_initiative_builder_reset.sql").read()
u1314 = (
    "-- BF Personal App: database updates 0013 and 0014, in one paste.\n"
    "-- For the live database, which has 0001 to 0012 (or 0001 to 0013, if UPDATE_0013_RUN_ONCE.sql was already run).\n"
    "-- Paste this whole file into the Supabase SQL Editor and press Run. Expected result: \"Success. No rows returned\".\n"
    "-- Safe to run more than once: nothing is duplicated, and no existing record is changed or deleted.\n"
    "-- (A database with only 0001 to 0007, 0008, 0009, 0010, or 0011 uses supabase/UPDATE_RUN_ONCE.sql instead, which includes both.)\n"
    "-- What it adds:\n"
    "--   0013: Send email from the app: Gmail message ids on communications; partner reports marked sent with the date.\n"
    "--   0014: Start an initiative (AI drafts you approve, plan documents, checklists such as a weekly grocery list),\n"
    "--         weekly AI savings ideas (Approve, Decline, Later), Load and Remove sample data, and Reset all data.\n"
    "-- Generated from supabase/migrations/0013_gmail_send.sql and 0014_initiative_builder_reset.sql by supabase/build_combined.py.\n\n"
)
open("supabase/UPDATE_0013_0014_RUN_ONCE.sql", "w").write(
    u1314 + "-- ===== supabase/migrations/0013_gmail_send.sql =====\n" + m13 + "\n-- ===== supabase/migrations/0014_initiative_builder_reset.sql =====\n" + m14
)
u14 = (
    "-- BF Personal App: database update 0014 (Start an initiative, savings ideas, checklists, sample data, Reset data).\n"
    "-- For a database that already has 0001 to 0013. Paste this whole file into the Supabase SQL Editor and press Run.\n"
    "-- Safe to run more than once. (The live database with 0001 to 0012 uses supabase/UPDATE_0013_0014_RUN_ONCE.sql.)\n"
    "-- Generated from supabase/migrations/0014_initiative_builder_reset.sql by supabase/build_combined.py.\n\n"
)
open("supabase/UPDATE_0014_RUN_ONCE.sql", "w").write(u14 + m14)

u15 = (
    "-- BF Personal App: database update 0015 (Gmail signature on emails sent or drafted from the app).\n"
    "-- For a database that has 0001 to 0014. Paste this whole file into the Supabase SQL Editor and press Run.\n"
    "-- Expected result: \"Success. No rows returned\". Safe to run more than once: nothing is duplicated, and no existing\n"
    "-- record is changed or deleted. It only adds four empty columns to owner_profile and a check function.\n"
    "-- Generated from supabase/migrations/0015_email_signature.sql by supabase/build_combined.py.\n\n"
)
open("supabase/UPDATE_0015_RUN_ONCE.sql", "w").write(u15 + open("supabase/migrations/0015_email_signature.sql").read())

u16 = (
    "-- BF Personal App: database update 0016 (deal funnel).\n"
    "-- For a database that has 0001 to 0015 (the live database with 0001 to 0016 uses UPDATE_0017_RUN_ONCE.sql). Paste this whole file into the Supabase SQL Editor and press Run.\n"
    "-- Expected result: \"Success. No rows returned\". Safe to run more than once: nothing is duplicated, and no existing\n"
    "-- target, input, or record is changed or deleted. What it adds:\n"
    "--   Two count sources for targets: CIMs reviewed (cims_reviewed) and Broker or owner calls (deal_calls).\n"
    "--   Three targets, counting from today (New York date), all commitments: Listings screened (20 per weekday, +1 and +5\n"
    "--   buttons), CIMs reviewed (1 per weekday), Broker or owner calls (2 per week). Future owners get them too.\n"
    "--   Five inputs (Plan, Inputs, Acquisition): search hours per day (2) and minutes to screen a listing (3), review a CIM (45),\n"
    "--   reply or send an NDA (5), and per call (30), used for the Suggested targets line. And a check function.\n"
    "-- Generated from supabase/migrations/0016_deal_funnel.sql by supabase/build_combined.py.\n\n"
)
open("supabase/UPDATE_0016_RUN_ONCE.sql", "w").write(u16 + open("supabase/migrations/0016_deal_funnel.sql").read())

u17 = (
    "-- BF Personal App: database update 0017 (partner report templates).\n"
    "-- For a database that has 0001 to 0016 (the live database with 0001 to 0017 uses UPDATE_0018_RUN_ONCE.sql). Paste this whole file into the Supabase SQL Editor and press Run.\n"
    "-- Expected result: \"Success. No rows returned\". Safe to run more than once: nothing is duplicated, and no existing\n"
    "-- record is changed or deleted. What it adds:\n"
    "--   A table of partner report templates (which measures a report shows, the period, an optional note) with three\n"
    "--   starter templates for you and future owners: Summary, Standard, Detailed.\n"
    "--   A default template on each accountability partner (Standard for existing partners).\n"
    "--   Reset all data: also deletes templates you added and keeps the three starter templates. And a check function.\n"
    "-- The balance sheet and the deal scorecard need no database change.\n"
    "-- Generated from supabase/migrations/0017_partner_report_templates.sql by supabase/build_combined.py.\n\n"
)
open("supabase/UPDATE_0017_RUN_ONCE.sql", "w").write(u17 + open("supabase/migrations/0017_partner_report_templates.sql").read())

u18 = (
    "-- BF Personal App: database update 0018 (resolve a miss as Done late; daily partner reports).\n"
    "-- For a database that has 0001 to 0017 (the live database with 0001 to 0018 uses UPDATE_0019_RUN_ONCE.sql). Paste this whole file into the Supabase SQL Editor and press Run.\n"
    "-- Expected result: \"Success. No rows returned\". Safe to run more than once: nothing is duplicated, and no existing\n"
    "-- record is changed or deleted (existing partners get the report frequency Weekly). What it adds:\n"
    "--   Done late: a missed commitment can be resolved with the date it was done. It still counts as a miss in the score.\n"
    "--   The day period for report templates (today's numbers).\n"
    "--   A report frequency on each accountability partner: Daily, Weekly, or Both (Weekly for existing partners).\n"
    "--   Daily partner reports: drafted after the weekday daily close, sent only after you press Approve and send.\n"
    "--   And a check function.\n"
    "-- Generated from supabase/migrations/0018_resolve_daily_reports.sql by supabase/build_combined.py.\n\n"
)
open("supabase/UPDATE_0018_RUN_ONCE.sql", "w").write(u18 + open("supabase/migrations/0018_resolve_daily_reports.sql").read())

u19 = (
    "-- BF Personal App: database update 0019 (the focused version, batch 1: Today and Close the day).\n"
    "-- For a database that has 0001 to 0018 (the live database with 0001 to 0019 uses UPDATE_0020_RUN_ONCE.sql). Paste this whole file into the Supabase SQL Editor and press Run.\n"
    "-- Expected result: \"Success. No rows returned\". Safe to run more than once: nothing is duplicated, and no existing\n"
    "-- record is changed or deleted. What it adds:\n"
    "--   A table of daily outcomes: up to 3 planned outcomes per day, each with an initiative, a planned block in minutes,\n"
    "--   and after the close a status (complete, partial, incomplete), a one-line result, and optional actual minutes.\n"
    "--   On the daily plan: focused hours, what changed in the plan, and tomorrow's top priority.\n"
    "--   On tasks: who the task is waiting on and since when (the Waiting on someone list on Today).\n"
    "--   Sample data and Reset all data also cover daily outcomes. And a check function.\n"
    "-- Generated from supabase/migrations/0019_focused_today.sql by supabase/build_combined.py.\n\n"
)
open("supabase/UPDATE_0019_RUN_ONCE.sql", "w").write(u19 + open("supabase/migrations/0019_focused_today.sql").read())

u20 = (
    "-- BF Personal App: database update 0020 (the Work module, batch A: Work on now, Screen listings, Deals, the deal page).\n"
    "-- For a database that has 0001 to 0019 (the live database with 0001 to 0020 uses UPDATE_0021_RUN_ONCE.sql). Paste this whole file into the Supabase SQL Editor and press Run.\n"
    "-- Expected result: \"Success. No rows returned\". Safe to run more than once: nothing is duplicated and no deal is deleted.\n"
    "-- What it changes:\n"
    "--   On pipeline items (deals): what it does, location, industry, link, broker, why selling, key finding, open questions,\n"
    "--   waiting on and since when, pass reason, screened (a listing is a deal not yet screened), buy box note, block minutes.\n"
    "--   The acquisition pipeline's stages become Interested, NDA signed, Broker call, CIM review, Seller call, Model,\n"
    "--   Partner presentation, IOI or LOI, Diligence, then Closed, Passed, Lost. Screened is renamed Interested, CIM reviewed\n"
    "--   is renamed CIM review, IOI sent is renamed IOI or LOI; deals in Sourced move to Interested and deals in LOI signed move\n"
    "--   to IOI or LOI (those two stages are removed). Each stage gets its approved default next action.\n"
    "--   The setting \"Days waiting on someone before it is marked amber\" (5; red at double) under Plan, Inputs, Acquisition.\n"
    "--   Future owners get the same. And a check function.\n"
    "-- Generated from supabase/migrations/0020_work_module.sql by supabase/build_combined.py.\n\n"
)
open("supabase/UPDATE_0020_RUN_ONCE.sql", "w").write(u20 + open("supabase/migrations/0020_work_module.sql").read())

u21 = (
    "-- BF Personal App: database update 0021 (Edit batch A: listing and company names, open questions, Also to do, Follow up).\n"
    "-- For a database that has 0001 to 0020 (the live database with 0001 to 0021 uses UPDATE_0022_RUN_ONCE.sql). Paste this whole file into the Supabase SQL Editor and press Run.\n"
    "-- Expected result: \"Success. No rows returned\". Safe to run more than once: nothing is duplicated and nothing is deleted.\n"
    "-- What it changes:\n"
    "--   On pipeline items (deals): company_name (the real name once known; the name column holds the listing name) and\n"
    "--   open_questions_json (the open questions as three groups: Ask the seller, Ask the broker, Find out myself; lines typed\n"
    "--   earlier into the plain open questions box are copied once into Ask the seller).\n"
    "--   A new table deal_todos: the \"Also to do\" checklist of each deal (deleted with its deal).\n"
    "--   \"Chase\" becomes \"Follow up\" in two stage default next actions (NDA signed, IOI or LOI), on the deals that still carry\n"
    "--   them (same due date), and in the waiting setting's description. Future owners get the same. And a check function.\n"
    "-- Generated from supabase/migrations/0021_edit_batch_a.sql by supabase/build_combined.py.\n\n"
)
open("supabase/UPDATE_0021_RUN_ONCE.sql", "w").write(u21 + open("supabase/migrations/0021_edit_batch_a.sql").read())

u22 = (
    "-- BF Personal App: database update 0022 (batch B: Outreach, calls and emails logged, To-dos, and what batch B2 needs).\n"
    "-- For a database that has 0001 to 0021 (the live database with 0001 to 0022 uses UPDATE_0023_RUN_ONCE.sql). Paste this whole file into the Supabase SQL Editor and press Run.\n"
    "-- Expected result: \"Success. No rows returned\". Safe to run more than once: nothing is duplicated. No contact, communication,\n"
    "-- deal, opportunity, or consulting item is deleted; four consulting stages go away after their items move (see below).\n"
    "-- What it changes:\n"
    "--   On contacts: outreach_role, purposes (several of off-market deals, job search, consulting, Rosara), linkedin_url,\n"
    "--   last_contact_at and last_contact_kind (kept current from the logged emails and calls), archived_at. The next follow-up\n"
    "--   date and what it is for are the existing follow_up_date and follow_up_note.\n"
    "--   On communications: call_minutes, call_outcome, awaiting_log (an incoming reply not yet on the timeline).\n"
    "--   New tables: todos (the personal To-dos page), projects (Rosara, batch B2), ai_order_cache (the AI order on Home, batch B2).\n"
    "--   deal_todos gains record_type and record_id (existing rows stay deals); a person's or a project's tasks go with it.\n"
    "--   On pipeline items: role_title, contact_name, fee (Job search and Consulting, batch B2).\n"
    "--   The Jobs pipeline becomes Job search with the stages Contact, Conversation, Interview, Offer, Accepted, Declined, Not chosen\n"
    "--   (three renamed in place, one added). The Consulting pipeline's stages become Lead, Proposal, Engagement, Paid, Done, Lost\n"
    "--   (four renamed in place; items in Contacted and Discovery call move to Lead, Negotiating to Proposal, Active to Engagement,\n"
    "--   then those four stages are removed). Each open stage gets one approved default next action.\n"
    "--   The settings \"Network outreach per week\" (10) and \"Rosara weekly focus\". Future owners get the same. And a check function.\n"
    "-- Generated from supabase/migrations/0022_batch_b.sql by supabase/build_combined.py.\n\n"
)
open("supabase/UPDATE_0022_RUN_ONCE.sql", "w").write(u22 + open("supabase/migrations/0022_batch_b.sql").read())

u23 = (
    "-- BF Personal App: database update 0023 (batch B2: findings with a source link on the timeline, the pay range of a job opportunity).\n"
    "-- For a database that has 0001 to 0022 (the live database with 0001 to 0023 uses UPDATE_0024_RUN_ONCE.sql). Paste this whole file into the Supabase SQL Editor and press Run.\n"
    "-- Expected result: \"Success. No rows returned\". Safe to run more than once: nothing is duplicated, and no existing record\n"
    "-- is changed or deleted. It only adds empty columns and a check function:\n"
    "--   notes.kind ('note' or 'finding') and notes.source_url, pipeline_items.pay_range, schema_has_0023().\n"
    "-- Generated from supabase/migrations/0023_batch_b2.sql by supabase/build_combined.py.\n\n"
)
open("supabase/UPDATE_0023_RUN_ONCE.sql", "w").write(u23 + open("supabase/migrations/0023_batch_b2.sql").read())

u24 = (
    "-- BF Personal App: database update 0024 (Edit batch B: Broker call after CIM review, the NDA signed default).\n"
    "-- For a database that has 0001 to 0023 (the live database with 0001 to 0024 uses UPDATE_0025_RUN_ONCE.sql). Paste this whole file into the Supabase SQL Editor and press Run.\n"
    "-- Expected result: \"Success. No rows returned\". Safe to run more than once. Nothing is deleted: stage rows keep their ids\n"
    "-- and every deal keeps its stage. What it changes, by UPDATE only:\n"
    "--   In the acquisition pipeline, CIM review takes position 3 and Broker call position 4 (the order becomes Interested,\n"
    "--   NDA signed, CIM review, Broker call, Seller call, Model, Partner presentation, IOI or LOI, Diligence).\n"
    "--   The NDA signed default next action becomes \"Ask the broker for the CIM\" (on the stage and on the deals that still\n"
    "--   carried \"Follow up with the broker for the CIM and the call\", same due date). Future owners get the same. And a check function.\n"
    "-- Generated from supabase/migrations/0024_edit_batch_b.sql by supabase/build_combined.py.\n\n"
)
open("supabase/UPDATE_0024_RUN_ONCE.sql", "w").write(u24 + open("supabase/migrations/0024_edit_batch_b.sql").read())

u25 = (
    "-- BF Personal App: database update 0025 (batch C: Targets, End of day, Reports).\n"
    "-- For a database that has 0001 to 0024 (the live database with 0001 to 0025 uses UPDATE_0026_RUN_ONCE.sql). Paste this whole file into the Supabase SQL Editor and press Run.\n"
    "-- Expected result: \"Success. No rows returned\". Safe to run more than once: nothing is duplicated, nothing is deleted, no existing row changes.\n"
    "-- What it adds:\n"
    "--   targets.counts_key (what a target counts from the app's own data) and targets.archived_at; the work_events table (next actions\n"
    "--   and follow-ups marked Done, the Rosara focus marked done); the end_of_day table (reasons, tomorrow's line, sent or skipped,\n"
    "--   the email as sent); partner_reports.report_kind allows end_of_day; the six default targets for a future owner; sample data,\n"
    "--   removal, and reset cover the new tables; schema_has_0025().\n"
    "-- Generated from supabase/migrations/0025_batch_c.sql by supabase/build_combined.py.\n\n"
)
open("supabase/UPDATE_0025_RUN_ONCE.sql", "w").write(u25 + open("supabase/migrations/0025_batch_c.sql").read())

u26 = (
    "-- BF Personal App: database update 0026 (Edit batch C round 2: the Personal network role).\n"
    "-- For a database that has 0001 to 0025 (the live database with 0001 to 0026 uses UPDATE_0027_RUN_ONCE.sql). Paste this whole file into the Supabase SQL Editor and press Run.\n"
    "-- Expected result: \"Success. No rows returned\". Safe to run more than once: nothing is duplicated and nothing is deleted.\n"
    "-- What it changes:\n"
    "--   The outreach role \"Former colleague\" becomes \"Personal network\": every contact with the old role gets the new one by\n"
    "--   UPDATE (every other field kept), and the role check allows the new key instead of the old one. schema_has_0026().\n"
    "-- Generated from supabase/migrations/0026_edit_batch_c_round_2.sql by supabase/build_combined.py.\n\n"
)
open("supabase/UPDATE_0026_RUN_ONCE.sql", "w").write(u26 + open("supabase/migrations/0026_edit_batch_c_round_2.sql").read())

u27 = (
    "-- BF Personal App: database update 0027 (the original listing text, year established, and employees).\n"
    "-- For the live database, which has 0001 to 0026. Paste this whole file into the Supabase SQL Editor and press Run.\n"
    "-- Expected result: \"Success. No rows returned\". Safe to run more than once: nothing is duplicated, nothing is deleted, no existing row changes.\n"
    "-- What it adds:\n"
    "--   pipeline_items.listing_text (the full text pasted into Add a listing, shown in the Original listing text card and read by\n"
    "--   every AI action on the listing or deal), pipeline_items.year_established and pipeline_items.employees (Facts). schema_has_0027().\n"
    "-- Generated from supabase/migrations/0027_listing_text.sql by supabase/build_combined.py.\n\n"
)
open("supabase/UPDATE_0027_RUN_ONCE.sql", "w").write(u27 + open("supabase/migrations/0027_listing_text.sql").read())

old = (
    "-- USE supabase/UPDATE_RUN_ONCE.sql INSTEAD. That file includes this update (0008) and the next ones (0009 to 0027).\n"
    "-- This file is kept for reference only.\n"
    "--\n"
    "-- BF Personal App: database update 0008 (Daily Targets and Outreach Queue).\n"
    "-- For a database that already has 0001 to 0007. Paste this whole file into the Supabase SQL Editor and press Run.\n"
    "-- Safe to run more than once. Generated from supabase/migrations/0008_targets_outreach.sql.\n\n"
)
open("supabase/UPDATE_0008_RUN_ONCE.sql", "w").write(old + open("supabase/migrations/0008_targets_outreach.sql").read())
print(
    f"Wrote ALL_MIGRATIONS_RUN_ONCE.sql ({len(files)} files), UPDATE_RUN_ONCE.sql ({len(update_files)} files), "
    "UPDATE_0027_RUN_ONCE.sql, UPDATE_0026_RUN_ONCE.sql, UPDATE_0025_RUN_ONCE.sql, UPDATE_0024_RUN_ONCE.sql, UPDATE_0023_RUN_ONCE.sql, UPDATE_0022_RUN_ONCE.sql, UPDATE_0021_RUN_ONCE.sql, UPDATE_0020_RUN_ONCE.sql, UPDATE_0019_RUN_ONCE.sql, UPDATE_0018_RUN_ONCE.sql, UPDATE_0017_RUN_ONCE.sql, UPDATE_0016_RUN_ONCE.sql, UPDATE_0015_RUN_ONCE.sql, UPDATE_0013_0014_RUN_ONCE.sql, UPDATE_0014_RUN_ONCE.sql, UPDATE_0011_0012_RUN_ONCE.sql, UPDATE_0012_RUN_ONCE.sql, UPDATE_0013_RUN_ONCE.sql, UPDATE_0011_RUN_ONCE.sql, UPDATE_0008_RUN_ONCE.sql"
)
