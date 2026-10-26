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
| Opportunities | One pipeline system with 6 seeded pipelines (Acquisitions, Jobs, Rosara Co-founder Search, Rosara Investor Outreach, Other Income Opportunities, Consulting); board and list views; stage task lists, stage time limits, required details, stalled items; deal source (proprietary or brokered) and the source chain (Deal came from: a contact or a typed source; Introduced by); consulting engagement terms, expected income, and pipeline value; stage history |
| People | Contacts, organizations with their people (link, unlink, add), communication history; follow-up dates create tasks and calendar events; Outreach Queue (contacts due for a message, Log outreach, Draft message) |
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
- **Outreach Queue:** contacts with a relationship group (close 30, friend 30, warm 60, professional 90 days, or a custom number; Other has no set schedule and is listed only with a custom number) are due when the last communication date plus the frequency is today or earlier. Draft message sends nothing on its own: after you approve the text, press Send now (confirm first), Save to Gmail drafts, or copy it.
- **Before 0008 is applied,** these screens show "Database update needed" and every existing screen keeps working.

### Pipeline accountability and deal source (database update 0009)

- **Next action required:** every pipeline item form requires a next action and a due date, filled from the stage's default task. Open items without one get a Home alert and the task "Set next action: <item>".
- **Stage task lists:** each stage has default tasks (Settings, Initiatives and pipelines). Entering a stage, including when an item is created, creates those tasks for the item (once per item and stage task), linked to the item and its initiative, and as commitments when the stage task says so (by default only the next-action task). A database trigger does this, so every way of saving an item gets the same tasks. Closing an item (won or passed) skips its open pipeline tasks and releases their commitments.
- **Stage time limits:** `pipeline_stages.max_days_in_stage`. When an open item is in a stage longer than the limit plus any extensions, the morning job opens a decision with three options written in advance: "Advance to next stage", "Pass", "Extend 7 days" (Inputs: `stage_extension_days`). Extend adds days for that item's current stay only (`pipeline_item_stage_extensions`).
- **Required details:** `pipeline_stages.required_fields`. A move is blocked when the details for the stage, or any earlier stage, are empty; the item page lists what is missing with a link to fill them. Moving to a passed stage never needs details.
- **Stalled:** an open item with no stage change and no linked communication, completed task, note, or document for `pipeline_stall_days` (Inputs, Opportunities, default 7) days. Shown as a badge, a Home alert, and in the weekly and monthly review.
- **Deal source:** acquisition items have a deal source (proprietary = off-market, brokered), a broker or referral person, and source notes. Proprietary deals sort first on the board, in task lists, in the morning plan, and in pipeline next actions. The Acquisitions page shows counts by type (this week, open, per stage).
- **Deal-source contacts:** contacts marked "Deal source" come first in the Outreach Queue; Draft message writes an off-market deal sourcing ask. Outreach has a purpose (general or deal sourcing); the Network outreach target still counts all outreach and shows the deal-sourcing share.
- **Deal targets:** "Deals sourced" (5 per weekday: new Acquisitions items that day, with proprietary and brokered counts) and "Deals advanced" (1 per weekday: each Acquisitions item counted once per day when it moved into NDA signed or a later stage that day, not counting the stage it was created in, or when "Log deal activity" recorded a CIM request or a contact with the broker or referral source on it that day).
- **Before the update is applied,** these features show "Database update needed" and every existing screen and both scheduled jobs keep working.

### Commitment rule (database update 0010)

- **Commitments are only:** pipeline next-action tasks (the stage task marked as the next action, and an item's current next action task), milestones, daily targets, and the scheduled reviews (the four "Complete the ... review / daily close" recurring tasks). A task can still be marked by hand ("This is a commitment" on a new task, or Mark as commitment on its page).
- **Everything else is a regular task:** other stage tasks, other recurring tasks, follow-ups, connection tasks (still high priority), "Set next action" tasks, and new tasks by default.
- **Regular tasks that are not done move to the next day:** the morning job sets the due date of each overdue open regular task to today and adds 1 to `tasks.times_moved`. The task shows "Moved N times". No reason is needed. Commitments keep their date and go through the missed-commitment flow.
- **Weekly review:** lists regular tasks moved `task_moved_review_threshold` (Inputs, default 5) or more times, with Done, Reschedule (times moved starts again from 0), and Delete.
- **Grouped Home alerts:** one alert per kind, updated in place and resolved at 0: "N pipeline items need a next action." and "N pipeline items are stalled." (open a filtered list on Opportunities), "N stage time limits passed." (opens Plan, Decisions; each item keeps its own decision record). Per-item badges stay on the board, list, and item pages. Missed regular tasks create no alert.
- **Daily close:** missed commitments and missed targets are listed with checkboxes (checked by default) and one shared reason; any item can get its own reason instead. Completing the close needs a reason for every missed item. Reasons are saved on the missed commitment and the missed target period.
- **Released commitments:** when 0010 runs, open or missed commitments on tasks that are now regular tasks are marked "released" (kept, not counted in scores, reviews, or partner reports). Scores show "No commitments" when nothing was due.
- **Applied once per owner** (`owner_profile.commitment_rule_applied_at`), so later changes in Settings are kept when the update runs again.
- **Before the update is applied,** nothing moves to the next day, the grouped alerts still work, and every screen and both scheduled jobs keep working.

### Deal source chain and Consulting (database update 0011)

- **Source chain:** "Deal came from" (`source_contact_id`: who handed you the deal directly: broker, owner, or a friend who knows the owner) and "Introduced by" (`introduced_by_contact_id`: the person in your network who started the chain). Middle steps go in Source notes. Consulting items show the same two fields ("Lead came from", "Introduced by").
- **Deal type suggestion:** under Deal source, the form suggests Brokered when the "Deal came from" contact has the Broker role (or works at an organization of kind broker), otherwise Proprietary, with a "Use" button. It never changes a value you chose (`src/lib/calc/source-chain.ts`).
- **Credit to your network:** contact pages show "Deals from this contact" (deals and consulting leads where the contact is "Deal came from" or "Introduced by", each item once). The Outreach Queue shows "Introduced N deals" and, within the same due status, lists those contacts first. Weekly and monthly reviews list the top 5 contacts by deals introduced.
- **Organization label per pipeline kind** (`src/lib/pipeline-labels.ts`): Company being acquired, Employer, Current company, Investor firm, Organization, Client.
- **Consulting pipeline:** initiative and pipeline "Consulting" (kind `consulting`), with stage task lists, time limits, required details (Proposal sent: rate type and rate; Signed: rate type, rate, start date; Active: start date), and a chance per stage (10, 20, 30, 50, 70, 100, 100%). Signed and Active are marked "Signed work" (`pipeline_stages.counts_as_signed`).
- **Engagement terms** (`consulting_details`): rate type (hourly, project, monthly retainer), rate, expected hours per month, project months, start and end dates, probability (empty = stage default). `rate` is the price for the rate type: per hour, the whole project fee, or per month. Expected monthly income is calculated, never typed: hourly = rate x hours; retainer = rate; project = fee / project months (empty: months from start to end date). Pipeline value = sum over open items of expected monthly income x probability (`src/lib/calc/consulting.ts`).
- **Payments:** a transaction (money in) can be linked to a consulting engagement (`transactions.pipeline_item_id`). The item page shows payments, total, and last payment date. Finance, Income Received shows consulting income this month and last month, signed work per month, pipeline value, and each engagement. Consulting income = money in linked to an engagement or assigned to a consulting income source.
- **Runway:** input `runway_include_signed_consulting` (0 by default). At 1, expected monthly income from Signed and Active items between their start and end dates is added to income in the runway formula, but only until the item's first linked payment is received (a payment dated today or earlier). After that the item is not added: its payments are already in average income, so a paid retainer is never counted twice (`runwaySignedIncome` in `src/lib/calc/consulting.ts`). "Signed work per month" still shows every signed engagement. The runway card says which mode is in use.
- **Scenarios:** inputs `consulting_monthly_income` (0) and `consulting_months` (12) add consulting income to the monthly cash projection. The Bridge comparison on each scenario page: job vs acquisition search with consulting (no salary for `acquisition_search_months_allowed` months, consulting income for `consulting_months`, then the acquisition salary and equity value).
- **Outreach:** contacts can be marked "Consulting lead" (badge in the Outreach Queue). Outreach purpose `consulting`. Draft message for a consulting lead writes a short note that Bram has time for consulting work.
- **Reviews:** weekly and monthly reviews show signed or active engagements, consulting income received in the period, pipeline value, and open items by stage.
- **No consulting daily target** (can be added on the Targets tab later).
- **Before the update is applied,** consulting features show "Database update needed" naming `supabase/UPDATE_0011_0012_RUN_ONCE.sql`; every existing screen and both scheduled jobs keep working.

### Contacts, organizations, and sources (database update 0012)

- **Organizations and their people:** the organization form (and the "+ New" organization dialog in other forms) has "People at this organization": search to link existing contacts, and add new people in rows (name, email, phone, job title or role, relationship group; "+ Add another person"). Saving sets each contact's organization; Unlink clears it and keeps the contact. The organization page lists its people with Unlink and an "Add people" form (`src/lib/org-people.ts`, `src/components/app/org-people.tsx`).
- **"+ New" contact dialog:** name, email, phone, organization (with its own search and "+ New"), job title, relationship group, roles. One "+ New" can open inside a dialog (`MAX_CREATE_DEPTH`).
- **Contact form:** sections in this order: Name and contact details; Relationship and outreach (roles, group, days); Follow-up; Labels in the Outreach Queue (deal source, consulting lead); Notes (`section` on each field in `src/lib/resources.ts`).
- **Contact options:** role Friend; relationship groups Friend (every 30 days) and Other (no set schedule: in the Outreach Queue only when "Reach out every (days)" is set). Friend and Other appear in forms after update 0012 (the app calls `public.schema_has_0012()` to check); the Friend role needs no update.
- **"Deal came from" / "Lead came from" is one field:** a contact (search, "+ New"), or "Not a person: type the source", which shows a text box saved in `pipeline_items.source` (examples: BizBuySell listing, Cold email campaign). The separate "Where it came from" field is gone on acquisition and consulting items (other pipeline kinds keep it). Choosing a contact after a typed source clears the text; an item that already had both keeps both and shows "also noted". A typed source gives no Proprietary or Brokered suggestion (`src/lib/calc/source-chain.ts`).
- **Pipeline and Stage fields:** search only, no "+ New" (pipelines and stages are set up in Settings).
- **Before the update is applied,** Friend and Other are not offered and contact forms show "Database update needed" naming `supabase/UPDATE_0011_0012_RUN_ONCE.sql`; everything else above works on 0001 to 0010.

### Send email from the app (database update 0013)

- **Where:** People, Outreach Queue, Draft message (after the draft is written), and Accountability, a finalized partner report (Delivery card). Each shows **Send now** and **Save to Gmail drafts** (the existing draft behavior). The Outreach Queue also keeps Copy to clipboard.
- **Send now** opens a dialog titled "Send this email?" with From, To, Subject, and the full message (read only, line breaks kept). **Edit** closes it and puts the cursor in the message. Only **Send email** sends. A partner report cannot be edited (a finalized report never changes), so its dialog has Cancel instead of Edit.
- **One email per click:** never sent by a scheduled job, never in bulk. The button is locked while sending, and each dialog opening has a request id; a repeated request with the same id is answered with "already sent" from the change log instead of sending again.
- **How it is sent:** Gmail API `users.messages.send` from the connected account, so it appears in Gmail, Sent. Plain text (the drafts were always plain text), UTF-8, base64 body with CRLF line breaks, RFC 2047 encoded subject, `To` and `Subject` headers, `threadId` when one is given (`src/lib/gmail-mime.ts`, `sendGmailMessage` in `src/lib/google.ts`). Drafts use the same message builder.
- **Permission:** the Google connection now asks for `gmail.send` too. The app saves the granted scopes from Google's token reply (`google_connections.scopes`) and allows Send now only when they list `gmail.send` (`src/lib/google-scopes.ts`). A connection saved before this counts as not allowed until Google is reconnected. Settings, Connections shows "Reconnect Google to allow sending from the app (1 minute)" with a Reconnect Google button, or "Sending from the app: Allowed". Reconnecting updates the same connection row. Without the permission, Send now shows the same message and button instead of the dialog.
- **After a send:** "Sent" with the date and time. One communication is saved: method email, outgoing, now, the subject, a short summary ("Sent from the app to ..." plus the start of the message), linked to the contact (and to a pipeline item when one is given; partner report emails are linked to the partner with a record link). Outreach emails get "Counts as outreach" and the same purpose rule as Log outreach (consulting lead: consulting; deal source: deal sourcing; otherwise general), so they count toward the Network outreach target and its shares (`src/lib/calc/sent-email.ts`). Partner report emails are not outreach. A partner report is marked sent with the date (Delivered: "Sent from the app on ...").
- **Change log:** every send adds a row with field `email_sent`, actor owner (To, Subject, Gmail message id, request id), shown in Settings, Change log as "Email sent from the app".
- **On failure:** the Google error in plain English plus Google's own words (`src/lib/google-errors.ts`); the text is kept and Save to Gmail drafts is offered.
- **Database update 0013** (`supabase/UPDATE_0013_RUN_ONCE.sql`): adds `communications.gmail_message_id`, `communications.gmail_thread_id`, `partner_reports.sent_at`, `partner_reports.gmail_message_id` (no existing column fit). **Before it runs,** sending still works: the communication is saved without the Gmail ids, the report is marked sent in Delivered, and the Gmail id and date are kept in the change log (the report page reads the date from there).
- **Local checks:** `dev-tools/mock-supabase.mjs` also runs a Google stand-in on port 54329 (`GOOGLE_API_MOCK_URL` in `dev-tools/local.env`; the app honors it only for a localhost address). Real Gmail sending cannot be checked locally.

### Shared form and card rules (UI)

- **Unsaved changes:** every form uses `GuardedForm` (`src/components/app/unsaved-changes.tsx`). When a field holds a change that is not saved, an in-app link or the browser Back button shows a dialog: Save and leave, Leave without saving, Stay on this page. Closing or reloading the tab shows the browser's prompt. A value changed back to the original is not a change. Filter forms (`method="get"`) and forms marked `data-unsaved="off"` are not checked. Screens that are not one form report work in progress with `useUnsavedWork` (the CSV import once a file is chosen): the dialog then offers Leave and discard, and Stay on this page.
- **CSV import:** 3 numbered steps with a step count (Step 1 of 3). Required columns are marked; a missing one is named in the error. Column choices are filled from, in order: this account's unfinished choices (kept in this browser), the layout used by the last import into the account, the saved layout for the account's bank or card, a saved layout whose columns match the file, a guess from the column names (`src/lib/calc/import-layout.ts`). The note under the step title says which.
- **Form fields:** `FieldGrid` and `FormField` (`src/components/ui/form-field.tsx`): label 6px above its input, 16px to the next field, labels held to 2 lines, inputs aligned across a row.
- **Reference fields:** type to search; "+ New" opens a short form for that record type (`src/lib/quick-create.ts`), saves it with the same checks as any form, and chooses it. What was typed in the main form stays.
- **Dropdowns:** one arrow 12px from the right edge, text never runs under it (`globals.css`).
- **Cards:** a card's one-line description of what it shows sits at the bottom under a thin line (`CardNote`). Instructions needed before using a card stay under the title. Metric labels are dark gray, medium weight (`METRIC_LABEL`); rows of metrics have a thin line between them (`StatGrid`).
- **Status colors** (`src/lib/status.ts`, tokens in `globals.css`): green = met or done; amber = due soon, due today, warnings; red = missed, overdue, critical; gray = not started or neutral. No other color carries meaning. Use `StatusBadge`, `StatusDot`, `StatusText`, `dueClass`, and `DueWord` (`src/components/ui/badge.tsx`), never raw color classes. Teal is the app color (links, buttons, Proprietary); Brokered is gray.
- **Next required action:** the first card on every record page (top of the main column; first on the phone). Teal line on the left, light teal tint, the action in larger semibold text, and the due date with "Overdue" (red) or "Due today" (amber). An action with nothing left to do has a gray line on a white card.
- **Module icons:** one small gray line icon per module (`src/components/app/module-icon.tsx`), in the sidebar and on Home card titles (each Home card belongs to a module).
- **Pipelines** open in list view; Board is one click away and the last choice per pipeline is remembered in a cookie. Closed stages (and closed items) are shown by default; "Hide closed stages" is one click away and is remembered the same way. The board fits the page width from 1024px (all 9 stages at 1280px, min 6rem per column); on narrow screens it scrolls inside its own box.

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

1. **Supabase:** create a project. In SQL Editor, paste and run `supabase/ALL_MIGRATIONS_RUN_ONCE.sql` (0001 to 0013),
   or run each file in `supabase/migrations/` in number order. Or with the Supabase CLI: `supabase link` then `supabase db push`.
   **Live database (has 0001 to 0012):** paste and run `supabase/UPDATE_0013_RUN_ONCE.sql` once (safe to run twice).
   A database with 0001 to 0010 (or 0011) runs `supabase/UPDATE_0011_0012_RUN_ONCE.sql` first, then `UPDATE_0013_RUN_ONCE.sql`.
   **Older database (0001 to 0007, 0008, or 0009):** paste and run `supabase/UPDATE_RUN_ONCE.sql` once.
   It holds 0008 to 0013 and is safe to run twice. (`UPDATE_0008_RUN_ONCE.sql`, `UPDATE_0011_RUN_ONCE.sql`, and `UPDATE_0012_RUN_ONCE.sql` are kept for reference.)
   After changing a migration, regenerate the combined files with `python3 supabase/build_combined.py`.
   In Authentication, turn on "Allow new users to sign up" only until you create your account, then turn it off.
   In Authentication, Multi-Factor, make sure TOTP is enabled.
2. **Vercel:** import the GitHub repository `bf-personal-app`. Add every variable from `.env.example`. Deploy.
3. Open the app, press "Create the owner account", sign in, scan the authenticator code.
4. Connect Google in Settings, Connections (it asks for Gmail drafts, sending email after you confirm, and Calendar). Plaid after week 1.
   **Existing connection (made before sending was added):** Settings, Connections, press Reconnect Google once and allow "Send email on your behalf".

## How scheduled jobs (cron) work

Vercel Hobby allows jobs that run once a day, so `vercel.json` has two:

| Job | Time (UTC) | Time (New York) | Runs |
|---|---|---|---|
| `/api/cron/morning` | 10:00 | 6:00 or 5:00 am | Plaid sync, category rules, recurring charge detection, Google and Plaid connection checks, recurring tasks, pipeline next-action tasks, pipeline checks (missing next action, stage time limits, stalled items), follow-ups, commitment check, missed regular tasks moved to today, missed milestones, decision conditions, weekly/monthly/quarterly review drafts (on their days), partner report drafts, calendar time blocks and review events, morning plan |
| `/api/cron/evening` | 00:30 | 8:30 or 7:30 pm | Daily close draft (the AI's evening check), commitment check for the day, decision conditions |

Vercel sends `Authorization: Bearer <CRON_SECRET>`. Any job can also be run alone, for example
`curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/decision-conditions`.
Jobs: morning, evening, plaid-sync, decision-conditions, connection-checks, recurring-tasks, morning-plan,
daily-close, weekly-review, monthly-review, quarterly-review, partner-reports, commitments, task-rollover, milestones, pipeline-checks.
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
bash supabase/tests/upgrade_test.sh   # UPDATE_RUN_ONCE on 0001-0007 (twice), 0001-0008, 0001-0009 (twice); UPDATE_0011_0012_RUN_ONCE on 0001-0010 and 0001-0011 (twice each); UPDATE_0013_RUN_ONCE on 0001-0012 (twice); existing owner
bash dev-tools/setup-local-db.sh      # local database with demo data (UP_TO=0012 for the live database before update 0013)
bash dev-tools/start-local.sh         # mock Supabase API + the built app on http://localhost:3000
NODE_PATH=$(npm root -g) node dev-tools/check-pages.cjs   # renders every screen, saves screenshots
NODE_PATH=$(npm root -g) node dev-tools/check-flows.cjs   # clicks through the main workflows (FLOWS="Send" runs only matching steps)
```

The local scripts need a Postgres server and are for testing only. Production uses Supabase.
