# Setup checklist

Do these in order. Each line says where to copy a value from and where to paste it.
Vercel variables go in: Vercel, project bf-personal-app, Settings, Environment Variables (Production).

## 0. Database update 0013 and 0014 (the live database; about 1 minute)

One file runs both updates. Use it whether or not `UPDATE_0013_RUN_ONCE.sql` was already run.
- **0013:** send email from the app (Gmail message ids, partner report sent date).
- **0014:** Start an initiative, plan documents, checklists, weekly AI savings ideas, Load and Remove sample data, Reset all data.

- [ ] Open the file `supabase/UPDATE_0013_0014_RUN_ONCE.sql` in the GitHub repository (bf-personal-app), press "Copy raw file"
- [ ] Supabase, project bf-personal-app, SQL Editor, New query: paste, press **Run**. Expected result: "Success. No rows returned"
- [ ] Running it a second time is safe. It deletes or changes no existing record
- [ ] Open the app: Plan shows "Start an initiative" with no "Database update needed" notice; Settings has a "Sample data and reset" tab; Finance, Expenses shows "Savings ideas"
- [ ] Try it: Plan, Start an initiative, press "Use the meal plan example" (or press Speak and say it), press Draft the plan, check the review screen, press Approve selected. The initiative page shows the menu and the grocery list
- [ ] Testing with sample data: Settings, Sample data and reset, Load sample data (check the box when it says you have real records). Remove sample data deletes only the sample rows
- [ ] Before entering real data: Settings, Sample data and reset, Reset all data: step 1 Download full export (keep the file), step 2 type RESET, press Reset all data. Your setup (initiatives, pipelines, stage task lists, targets, recurring tasks, categories, Inputs, connections) stays

## 1. Supabase (database)

- [ ] Create a Supabase project (sign in with GitHub). Region: US East. Save the database password somewhere safe.
- [ ] SQL Editor: paste and run `supabase/ALL_MIGRATIONS_RUN_ONCE.sql` (0001 to 0014), or each file from `supabase/migrations/` in order: 0001 to 0014.
- [ ] Authentication, Sign In / Providers, Email: enabled. Multi-Factor: TOTP enabled.
- [ ] Copy Settings, API, **Project URL** to Vercel `NEXT_PUBLIC_SUPABASE_URL`
- [ ] Copy Settings, API, **anon public** key to Vercel `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] Copy Settings, API, **service_role** key to Vercel `SUPABASE_SERVICE_ROLE_KEY` (keep private)
- [ ] Authentication, URL Configuration: Site URL = your Vercel address (same as `APP_URL`)

## 1a. Send email from the app (the live database has 0001 to 0012, and Google is already connected)

Two one-time steps. Until both are done, Send now shows "Reconnect Google" and drafts and calendar keep working.

**Step 1: database update 0013 (about 1 minute)**
- [ ] Done by step 0 above (`supabase/UPDATE_0013_0014_RUN_ONCE.sql` includes 0013). If `supabase/UPDATE_0013_RUN_ONCE.sql` was already run, step 0 is still safe to run.

**Step 2: reconnect Google once (about 1 minute)**
- [ ] Google Cloud console (project "BF Personal App"), APIs and Services, OAuth consent screen (or Data access), Scopes: add `https://www.googleapis.com/auth/gmail.send` next to the existing ones, Save. (The app asks for it either way; adding it here keeps the consent screen list accurate.)
- [ ] The app: Settings, Connections. The Google card says "Reconnect Google to allow sending from the app (1 minute)". Press **Reconnect Google**
- [ ] Google: choose bram@cyanarc.com, keep every box checked, including "Send email on your behalf", press Continue
- [ ] Back in the app: "Google is connected. Sending from the app is allowed." The Google card shows "Sending from the app: Allowed", and the same account
- [ ] Try it once: People, Outreach Queue, Draft message on a contact whose email is yours (or a test contact), press Send now, check the dialog, press Send email. Gmail, Sent shows it, and the contact's history shows the communication

## 1b. Database updates 0011 and 0012 (a database with 0001 to 0010 or 0011; already done on the live database)

One file runs both updates. Use it whether or not `UPDATE_0011_RUN_ONCE.sql` was already run.
- **0011:** the deal source chain ("Deal came from", "Introduced by") and the Consulting pipeline.
- **0012:** relationship groups Friend (every 30 days) and Other (no set schedule); the runway setting text.

- [ ] Open the file `supabase/UPDATE_0011_0012_RUN_ONCE.sql` in the GitHub repository (bf-personal-app), press "Copy raw file"
- [ ] Supabase, project bf-personal-app, SQL Editor, New query: paste, press **Run**. Expected result: "Success. No rows returned"
- [ ] Open the app: Opportunities shows a sixth pipeline, **Consulting** (Identified, Contacted, Discovery call, Proposal sent, Negotiating, Signed, Active, Completed, Lost). The "Database update needed" notices naming this file are gone
- [ ] People, Add contact: Relationship group lists Close, Friend, Warm, Professional, and Other
- [ ] Settings, Initiatives and pipelines, Consulting: each stage shows its task list, time limit, required details, and chance (10% to 100%). Signed and Active show "Signed work". Edit anything that does not fit
- [ ] Plan, Inputs and Assumptions: Runway has "Count signed consulting income in runway" (0 = off; at 1, a signed engagement counts until its first payment); Consulting has "Consulting: monthly income" (0) and "Consulting: months of consulting income" (12)
- [ ] Running the file a second time is safe (nothing is duplicated). `supabase/UPDATE_0011_RUN_ONCE.sql` and `supabase/UPDATE_0012_RUN_ONCE.sql` are kept for reference; this file replaces both

## 1c. Database update (older database only: one combined file)

Do this once if the database was set up before 0010 (it has 0001 to 0007, 0001 to 0008, or 0001 to 0009).
It also includes 0011, 0012, 0013, and 0014, so step 0 and the database parts of steps 1a and 1b are then not needed (step 1a, Reconnect Google, still is). The file holds seven updates:
- **0008:** Daily Targets, Outreach Queue.
- **0009:** stage task lists, time limits, required details, stalled items, deal source, Deals sourced and Deals advanced targets.
- **0010:** commitment rule. Only pipeline next actions, milestones, daily targets, and the reviews are commitments. Regular tasks that are not done move to the next day.
- **0011:** deal source chain and the Consulting pipeline (see 1b).
- **0012:** relationship groups Friend and Other; runway setting text (see 1b).
- **0013:** send email from the app: Gmail message ids and the partner report sent date (see 1a).
- **0014:** Start an initiative, checklists, savings ideas, sample data, Reset all data (see step 0).

- [ ] Open the file `supabase/UPDATE_RUN_ONCE.sql` in the GitHub repository (bf-personal-app), press "Copy raw file"
- [ ] Supabase, project bf-personal-app, SQL Editor, New query: paste, press **Run**. Expected result: "Success. No rows returned"
- [ ] Open the app: Accountability, Targets shows "Network outreach" (3 per weekday), "Deals sourced" (5 per weekday), and "Deals advanced" (1 per weekday). The "Database update needed" notices are gone
- [ ] Settings, Initiatives and pipelines: each stage shows its task list, time limit, and required details. Only the "Next action" task in each stage shows "Commitment: Yes". Review them and edit anything that does not fit
- [ ] Productivity, Recurring tasks: only the four review tasks (daily close, weekly, monthly, quarterly review) show "Counts as a commitment: Yes"
- [ ] Plan, Inputs and Assumptions, Productivity: "Times a task can move to the next day before the weekly review lists it" is 5
- [ ] Running the file a second time is safe (nothing is duplicated). Do not use `supabase/UPDATE_0008_RUN_ONCE.sql`; it is kept for reference only

## 2. Vercel (website)

- [ ] Import the GitHub repository `bf-personal-app`
- [ ] `OWNER_EMAIL` = `bram@cyanarc.com`
- [ ] `APP_URL` = the Vercel address, for example `https://bf-personal-app.vercel.app` (no slash at the end)
- [ ] `CRON_SECRET` = any long random text (for example from a password manager, 40+ characters)
- [ ] `TOKEN_ENCRYPTION_KEY` = 64 hexadecimal characters. Create with `openssl rand -hex 32` or a password manager set to hex. Never change it later.
- [ ] Deploy. Then Redeploy once after adding any variable.

## 3. Your account

- [ ] Open the app, press "Create the owner account", use `bram@cyanarc.com` and a 12+ character password
- [ ] If Supabase sends a confirmation email, open it
- [ ] Sign in and scan the code with an authenticator app (Google Authenticator or 1Password)
- [ ] Supabase, Authentication, Sign In / Providers: turn **off** "Allow new users to sign up" (the database also blocks a second account)

## 4. Anthropic (AI)

- [ ] console.anthropic.com: create an API key and set a monthly spend limit
- [ ] Vercel `ANTHROPIC_API_KEY` = the key
- [ ] Vercel `AI_MONTHLY_CAP_USD` = your cap, for example `25`
- [ ] Optional: `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), `AI_INPUT_PRICE_PER_MTOK` and `AI_OUTPUT_PRICE_PER_MTOK` (default 3 and 15). Match the prices to the model's current price list so the cost shown in Settings is right.

## 5. Google (Gmail drafts, sending after you confirm, and Calendar), signed in as bram@cyanarc.com

- [ ] console.cloud.google.com: create a project "BF Personal App"
- [ ] APIs and Services, Library: enable **Gmail API** and **Google Calendar API**
- [ ] OAuth consent screen: User type **Internal**. App name "BF Personal App". Support email bram@cyanarc.com
- [ ] Scopes: `gmail.compose`, `gmail.send`, `calendar.events`, `calendar.readonly` (plus `openid` and `email`)
- [ ] Credentials, Create credentials, OAuth client ID, type **Web application**
- [ ] Authorized redirect URI: `<APP_URL>/api/google/callback`
- [ ] Vercel `GOOGLE_CLIENT_ID` = the client ID
- [ ] Vercel `GOOGLE_CLIENT_SECRET` = the client secret
- [ ] Redeploy, then in the app: Settings, Connections, **Connect Google**. Keep every box checked on Google's screen. The Google card then shows "Sending from the app: Allowed"

## 6. Plaid (after week 1)

- [ ] Create a Plaid account (Trial plan)
- [ ] Vercel `PLAID_CLIENT_ID` and `PLAID_SECRET` (from the Plaid dashboard, Keys)
- [ ] Vercel `PLAID_ENV` = `production` for real accounts (`sandbox` for testing)
- [ ] Redeploy, then Settings, Connections, **Connect a bank or card**

## 7. First use

- [ ] Finance, Accounts and Cash: add each account and its current balance
- [ ] Finance, Import CSV: import each bank and card export (the column layout is saved per bank)
- [ ] Plan, Inputs and Assumptions: set current age and review every number
- [ ] Accountability, Accountability partners: add partners, then create a private link on each partner page
- [ ] People, Contacts: open each person to keep in touch with, press Edit, set the relationship group (close, warm, or professional)
- [ ] People, Contacts: for each person who can refer off-market deals (owners, operators, accountants, attorneys, bankers), press Edit and turn on "Deal source"
- [ ] Opportunities, Acquisitions: open each existing deal, press Edit, and set the deal source (proprietary or brokered), "Deal came from", and "Introduced by" when a friend started the chain
- [ ] People, Contacts: for each person who could hire you or refer consulting work, press Edit and turn on "Consulting lead"
- [ ] Opportunities, Consulting: add each client or lead. On the item page, fill the engagement terms (rate type, rate, hours or project length, dates)
- [ ] Finance, Expenses: open each consulting payment (money in), press Edit, and choose its "Consulting engagement"
- [ ] Optional: Plan, Inputs and Assumptions: set "Count signed consulting income in runway" to 1 to add expected income from signed work to runway
- [ ] Accountability, Accountability partners: to share daily targets, add "Daily targets" to the partner's sections, and on the target turn on "Show to accountability partners"
- [ ] Monthly: Settings, Export, Download full export
- [ ] Weekly (automatic): on the weekly review day, Finance, Expenses shows up to 3 savings ideas. Approve, Edit, Decline (with a reason), or Later each one
