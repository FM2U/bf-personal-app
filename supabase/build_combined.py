# Regenerates the combined SQL files from supabase/migrations:
#   supabase/ALL_MIGRATIONS_RUN_ONCE.sql  every migration (new, empty project)
#   supabase/UPDATE_RUN_ONCE.sql          0008 to 0011 (full catch-up for an existing project with 0001 to 0007 or later)
#   supabase/UPDATE_0011_RUN_ONCE.sql     0011 only (existing project with 0001 to 0010: the live database on 2026-10-26)
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
    "-- BF Personal App: database update (0008, 0009, 0010, and 0011).\n"
    "--   0008: Daily Targets and Outreach Queue.\n"
    "--   0009: Stage task lists, stage time limits, required details, stalled items, deal source (proprietary or brokered),\n"
    "--         deal-source contacts, and the Deals sourced and Deals advanced targets.\n"
    "--   0010: Commitment rule: only pipeline next actions, milestones, daily targets, and reviews are commitments;\n"
    "--         regular tasks that are not done move to the next day; the weekly review lists tasks moved 5 or more times.\n"
    "--   0011: Deal source chain (Deal came from, Introduced by) and the Consulting initiative and pipeline.\n"
    "-- For a database that already has 0001 to 0007 (or 0001 to 0008, 0009, or 0010). Paste this whole file into the\n"
    "-- Supabase SQL Editor and press Run. Safe to run more than once: nothing is duplicated.\n"
    "-- Generated from supabase/migrations by supabase/build_combined.py.\n\n"
)
open("supabase/UPDATE_RUN_ONCE.sql", "w").write(update + "\n".join(f"-- ===== {f} =====\n" + open(f).read() for f in update_files))

u11 = (
    "-- BF Personal App: database update 0011 (deal source chain and the Consulting pipeline).\n"
    "-- For the live database, which already has 0001 to 0010. Paste this whole file into the Supabase SQL Editor and press Run.\n"
    "-- Safe to run more than once: nothing is duplicated. (A database with only 0001 to 0007, 0008, or 0009 uses\n"
    "-- supabase/UPDATE_RUN_ONCE.sql instead, which includes this update.)\n"
    "-- What it adds:\n"
    "--   - Pipeline items: \"Introduced by\" (the person in your network who started the chain).\n"
    "--   - The Consulting initiative and pipeline: stages, stage task lists, time limits, required details, stage probabilities.\n"
    "--   - Consulting details per item (rate type, rate, hours, dates, probability); payments linked to an engagement;\n"
    "--     \"Consulting lead\" on contacts; the consulting outreach purpose; three inputs (runway and scenarios).\n"
    "-- Generated from supabase/migrations/0011_source_chain_consulting.sql by supabase/build_combined.py.\n\n"
)
open("supabase/UPDATE_0011_RUN_ONCE.sql", "w").write(u11 + open("supabase/migrations/0011_source_chain_consulting.sql").read())

old = (
    "-- USE supabase/UPDATE_RUN_ONCE.sql INSTEAD. That file includes this update (0008) and the next ones (0009 to 0011).\n"
    "-- This file is kept for reference only.\n"
    "--\n"
    "-- BF Personal App: database update 0008 (Daily Targets and Outreach Queue).\n"
    "-- For a database that already has 0001 to 0007. Paste this whole file into the Supabase SQL Editor and press Run.\n"
    "-- Safe to run more than once. Generated from supabase/migrations/0008_targets_outreach.sql.\n\n"
)
open("supabase/UPDATE_0008_RUN_ONCE.sql", "w").write(old + open("supabase/migrations/0008_targets_outreach.sql").read())
print(f"Wrote ALL_MIGRATIONS_RUN_ONCE.sql ({len(files)} files), UPDATE_RUN_ONCE.sql ({len(update_files)} files), UPDATE_0011_RUN_ONCE.sql, UPDATE_0008_RUN_ONCE.sql")
