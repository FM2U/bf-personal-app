# BF Personal App

A personal productivity and accountability app for one owner. It holds every financial record, goal,
opportunity, contact, and required task in one database, and checks what was done against what was committed.

Built from `docs/` in the project: Architecture v2 and the Decisions Log (both approved 2026-10-25).

## What is in the app

| Module | What it does |
|---|---|
| Home | Number tiles (Productivity: tasks done, targets met, pipeline actions due; Accountability: commitment score, days in a row, open misses, next review), runway vs. target, today's plan and tasks, meetings, overdue items, alerts, this month's spending vs. budget |
| Plan | Initiatives, goals, milestones, decision conditions, Inputs and Assumptions, scenarios (incl. job vs. acquisition), decisions log |
| Finance | Accounts (Personal or Cyan Arc LLC) and transfers, expenses with categories and recurring charges, CSV import, budget, debt payoff (avalanche and snowball), funding and repayments, income received, savings and financial security |
| Opportunities | One pipeline system with 5 seeded pipelines and stages; acquisition, job, and investor fields; stage history |
| People | Contacts, organizations, communication history; follow-up dates create tasks and calendar events; Outreach Queue (contacts due for a message, Log outreach, Draft message) |
| Productivity | Today's plan with daily target counters, task lists, recurring task templates, calendar time blocks, pipeline next actions |
| Accountability | Commitments, Daily Targets, missed-commitment flow, daily/weekly/monthly/quarterly reviews, completion scores, accountability partners and reports |
| Settings | Connections (Google, Plaid, AI), AI usage, imports, partner links, initiatives and pipelines, categories, export, profile, change log |

### Daily Targets and Outreach Queue (database update 0008)

- **Target:** a minimum count per day (on chosen weekdays) or per week. Example: "Network outreach", 3 per weekday.
- **Counts are never typed in** for automatic sources: outreach = communications marked as outreach; pipeline items added; or manual taps (+1).
- **Logging outreach** = one communication with "Counts as outreach" on, plus an optional outcome (replied, meeting booked, referral, no response).
- **Daily close:** each target for the day shows met or missed; a missed target needs a one-line reason (saved in `target_misses`).
- **Reviews and partner reports:** target totals vs required, reply rate, meetings booked. Partners see only targets marked "Show to accountability partners", and only when their sections include "Daily targets".
- **Decision conditions:** measured numbers "Daily target: count in the last N days / N weeks" and "periods met / missed in a row", with details such as `{"target":"Network outreach","days":7}`.
- **Outreach Queue:** contacts with a relationship group (close 30, warm 60, professional 90 days, or a custom number) are due when the last communication date plus the frequency is today or earlier. Draft message never sends: it creates a Gmail draft after approval, or copies the text.
- **Before 0008 is applied,** these screens show "Database update needed" and every existing screen keeps working.

### AI text format

All AI features share one output rule (`src/lib/ai/claude.ts`): bulleted outline, bold lead-in per bullet, short lines, answer first, no em dashes.
Email and message drafts use a conversational voice. Every AI text is shown with a small safe renderer (`src/components/app/ai-text.tsx`), so raw `**` or `#` never appear.

Every record page shows its next required action, linked records, documents, notes, and change history.
The AI chat panel is on every screen. The AI can read data and can only propose changes; you approve them on the
AI proposals page.

## Folder layout

```
src/app/(app)/        Signed-in screens (one folder per module)
src/app/(auth)/       Sign in, create owner account, authenticator step
src/app/report/       Public partner report page (private link, no login)
src/app/api/          Cron jobs, Google OAuth, Plaid, AI chat, exports, document downloads
src/app/actions/      Server actions (saving records, finance, AI proposals, settings)
src/components/       Screen parts (ui/ = shadcn/ui components, app/ = app components)
src/lib/calc/         Pure calculations (runway, debt payoff, savings, scenarios, conditions, CSV, recurring, scores) with tests
src/lib/engine/       Scheduled job logic (conditions, milestones, tasks, commitments, reviews, partner reports, morning plan)
src/lib/              Supabase clients, auth, AI, Google, Plaid, metrics, record definitions (resources.ts)
supabase/migrations/  Database schema, security rules, default configuration (run in order)
supabase/seed/        demo_seed.sql: made-up data for testing only (never run in the real project)
supabase/tests/       Local migration test (plain Postgres stand-in for Supabase)
dev-tools/            Local testing only: mock Supabase API, page and workflow checks
docs/                 SETUP-CHECKLIST.md and screenshots
```

## Deploy

Exact values to paste are in `docs/SETUP-CHECKLIST.md`. Summary:

1. **Supabase:** create a project. In SQL Editor, paste and run `supabase/ALL_MIGRATIONS_RUN_ONCE.sql` (0001 to 0008),
   or run each file in `supabase/migrations/` in number order. Or with the Supabase CLI: `supabase link` then `supabase db push`.
   **Existing database (already has 0001 to 0007):** paste and run `supabase/UPDATE_0008_RUN_ONCE.sql` once. It is safe to run twice.
   After changing a migration, regenerate both combined files with `python3 supabase/build_combined.py`.
   In Authentication, turn on "Allow new users to sign up" only until you create your account, then turn it off.
   In Authentication, Multi-Factor, make sure TOTP is enabled.
2. **Vercel:** import the GitHub repository `bf-personal-app`. Add every variable from `.env.example`. Deploy.
3. Open the app, press "Create the owner account", sign in, scan the authenticator code.
4. Connect Google in Settings, Connections. Plaid after week 1.

## How scheduled jobs (cron) work

Vercel Hobby allows jobs that run once a day, so `vercel.json` has two:

| Job | Time (UTC) | Time (New York) | Runs |
|---|---|---|---|
| `/api/cron/morning` | 10:00 | 6:00 or 5:00 am | Plaid sync, category rules, recurring charge detection, Google and Plaid connection checks, recurring tasks, pipeline next-action tasks, follow-ups, commitment check, missed milestones, decision conditions, weekly/monthly/quarterly review drafts (on their days), partner report drafts, calendar time blocks and review events, morning plan |
| `/api/cron/evening` | 00:30 | 8:30 or 7:30 pm | Daily close draft (the AI's evening check), commitment check for the day, decision conditions |

Vercel sends `Authorization: Bearer <CRON_SECRET>`. Any job can also be run alone, for example
`curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/decision-conditions`.
Jobs: morning, evening, plaid-sync, decision-conditions, connection-checks, recurring-tasks, morning-plan,
daily-close, weekly-review, monthly-review, quarterly-review, partner-reports, commitments, milestones.
Settings, Connections also has "Run the morning job now" and "Run the evening job now".
Decision conditions are also checked right after each relevant change in the app.

## Local development and tests

```
npm install
npm test              # unit tests for the calculations
npm run lint
npm run typecheck
npm run build
bash supabase/tests/run_local.sh      # applies all migrations to a local Postgres and runs a smoke test
bash supabase/tests/upgrade_test.sh   # 0001-0007 plus an owner, then UPDATE_0008 twice (upgrade path)
bash dev-tools/setup-local-db.sh      # local database with demo data
bash dev-tools/start-local.sh         # mock Supabase API + the built app on http://localhost:3000
NODE_PATH=$(npm root -g) node dev-tools/check-pages.cjs   # renders every screen, saves screenshots
NODE_PATH=$(npm root -g) node dev-tools/check-flows.cjs   # clicks through the main workflows
```

The local scripts need a Postgres server and are for testing only. Production uses Supabase.
