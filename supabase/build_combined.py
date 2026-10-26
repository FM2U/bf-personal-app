# Regenerates supabase/ALL_MIGRATIONS_RUN_ONCE.sql and supabase/UPDATE_0008_RUN_ONCE.sql from supabase/migrations.
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

update = (
    "-- BF Personal App: database update 0008 (Daily Targets and Outreach Queue).\n"
    "-- For a database that already has 0001 to 0007. Paste this whole file into the Supabase SQL Editor and press Run.\n"
    "-- Safe to run more than once. Generated from supabase/migrations/0008_targets_outreach.sql.\n\n"
)
open("supabase/UPDATE_0008_RUN_ONCE.sql", "w").write(update + open("supabase/migrations/0008_targets_outreach.sql").read())
print("Wrote ALL_MIGRATIONS_RUN_ONCE.sql (" + str(len(files)) + " files) and UPDATE_0008_RUN_ONCE.sql")
