# Regenerates the combined SQL files from supabase/migrations:
#   supabase/ALL_MIGRATIONS_RUN_ONCE.sql  every migration (new, empty project)
#   supabase/UPDATE_RUN_ONCE.sql          0008 to 0013 (full catch-up for an existing project with 0001 to 0007 or later)
#   supabase/UPDATE_0013_RUN_ONCE.sql     0013 only (the live database: it has 0001 to 0012)
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
    "-- BF Personal App: database update (0008, 0009, 0010, 0011, 0012, and 0013).\n"
    "--   0008: Daily Targets and Outreach Queue.\n"
    "--   0009: Stage task lists, stage time limits, required details, stalled items, deal source (proprietary or brokered),\n"
    "--         deal-source contacts, and the Deals sourced and Deals advanced targets.\n"
    "--   0010: Commitment rule: only pipeline next actions, milestones, daily targets, and reviews are commitments;\n"
    "--         regular tasks that are not done move to the next day; the weekly review lists tasks moved 5 or more times.\n"
    "--   0011: Deal source chain (Deal came from, Introduced by) and the Consulting initiative and pipeline.\n"
    "--   0012: Relationship groups Friend and Other; runway setting text (signed work counts until its first payment).\n"
    "--   0013: Send email from the app: Gmail message ids on communications; partner reports marked sent with the date.\n"
    "-- For a database that already has 0001 to 0007 (or 0001 to 0008, 0009, 0010, 0011, or 0012). Paste this whole file into the\n"
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
    "-- BF Personal App: database update 0013 (send email from the app).\n"
    "-- For the live database, which has 0001 to 0012. Paste this whole file into the Supabase SQL Editor and press Run.\n"
    "-- Safe to run more than once: nothing is duplicated. It only adds empty columns and a check function:\n"
    "--   communications.gmail_message_id, communications.gmail_thread_id, partner_reports.sent_at, partner_reports.gmail_message_id.\n"
    "-- Generated from supabase/migrations/0013_gmail_send.sql by supabase/build_combined.py.\n\n"
)
open("supabase/UPDATE_0013_RUN_ONCE.sql", "w").write(u13 + open("supabase/migrations/0013_gmail_send.sql").read())

old = (
    "-- USE supabase/UPDATE_RUN_ONCE.sql INSTEAD. That file includes this update (0008) and the next ones (0009 to 0013).\n"
    "-- This file is kept for reference only.\n"
    "--\n"
    "-- BF Personal App: database update 0008 (Daily Targets and Outreach Queue).\n"
    "-- For a database that already has 0001 to 0007. Paste this whole file into the Supabase SQL Editor and press Run.\n"
    "-- Safe to run more than once. Generated from supabase/migrations/0008_targets_outreach.sql.\n\n"
)
open("supabase/UPDATE_0008_RUN_ONCE.sql", "w").write(old + open("supabase/migrations/0008_targets_outreach.sql").read())
print(
    f"Wrote ALL_MIGRATIONS_RUN_ONCE.sql ({len(files)} files), UPDATE_RUN_ONCE.sql ({len(update_files)} files), "
    "UPDATE_0011_0012_RUN_ONCE.sql, UPDATE_0012_RUN_ONCE.sql, UPDATE_0013_RUN_ONCE.sql, UPDATE_0011_RUN_ONCE.sql, UPDATE_0008_RUN_ONCE.sql"
)
