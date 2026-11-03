# BF Personal App

A personal work and accountability app for one owner: the acquisition search (listings, deals), people and follow-ups,
Rosara projects, the job search, consulting, to-dos, daily targets, End of day reports to accountability partners.

This is the **final app** (built from 2026-11-02 on the branch `final-app`). The earlier, larger app (Finance, Plan,
Productivity, the old Accountability pages and the rest) is saved whole on the branch `old-app-archive`, and its
database stays untouched in the first Supabase project.

## What is in the app

| Menu | Pages |
|---|---|
| Work | Home (Work on now), Screen listings, Deals, Outreach (People in push B), Rosara, Job search, Consulting, To-dos; record pages for deals and listings, people, projects, opportunities and clients |
| Accountability | Targets, End of day (the report to the accountability partner), Reports |
| Settings | Connections (Google, Anthropic), Email signature, AI, Buy box, Export, Sample data, Profile |

## Stack

- Next.js (app code), Supabase (database, sign-in, file storage), Vercel (hosting and the daily scheduled jobs).
- Gmail and Google Calendar through bram@cyanarc.com; the Anthropic API for the AI features, with a monthly cap.

## Database

- **One setup file:** `supabase/SETUP_NEW_DATABASE.sql` creates every table, lock and default in a new, empty Supabase
  project (SQL Editor, paste, Run). Then the first sign-up becomes the owner and gets the default pipelines, stages
  and settings. Only one account can exist.
- **No update files:** later changes during the final-app build go into the same setup file until it is run on setup
  day.

## Scheduled jobs

- `vercel.json` runs `/api/cron/morning` and `/api/cron/evening` once a day.
- Morning: checks the Google connection and the Anthropic key; a problem becomes a to-do on Home.

## Local testing

- `bash dev-tools/setup-local-db.sh` builds a local database from the setup file with one owner.
- `bash dev-tools/start-local.sh` starts a local stand-in for Supabase, Google and Anthropic, and the built app.
- Load sample data in the app: Settings, Sample data.
- `npx vitest run` runs the unit tests; `node dev-tools/check-pages.cjs` opens every page at desktop and phone width.
