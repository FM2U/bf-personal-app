# Setup checklist

Do these in order. Each line says where to copy a value from and where to paste it.
Vercel variables go in: Vercel, project bf-personal-app, Settings, Environment Variables (Production).

## 0000000. The Work module, batch A: Work on now, Screen listings, Deals, the deal page (the live database has 0001 to 0019; about 6 minutes)

One database update. Until it is run, the Work screens show "Database update needed" and everything else keeps working.

**Step 1: database update 0020 (about 1 minute)**
- [ ] Open the file `supabase/UPDATE_0020_RUN_ONCE.sql` in the GitHub repository (bf-personal-app), press "Copy raw file"
- [ ] Supabase, project bf-personal-app, SQL Editor, New query: paste, press **Run**. Expected result: "Success. No rows returned"
- [ ] Running it a second time is safe. No deal is deleted. The acquisition stages become Interested, NDA signed, Broker call, CIM review, Seller call, Model, Partner presentation, IOI or LOI, Diligence (plus Closed, Passed, Lost); deals that were in Sourced or Screened are now in Interested, deals in CIM reviewed are in CIM review, deals in IOI sent or LOI signed are in IOI or LOI

**Step 2: check it (about 5 minutes)**
- [ ] The menu has three items: Work, Accountability, More. The app opens on Work on now with the date and three counts
- [ ] Settings, Sample data and reset: press Load sample data (tick the box about real records if it asks). Work on now now shows next actions and two long waits; Screen listings shows 7 listings
- [ ] Screen listings: press Add a listing, paste a broker email into the top box, press Fill from text, check the fields, Save to the list. The new row shows a green Fits or an amber reason
- [ ] On a listing, press Pass and choose a reason: the row leaves and the count drops. Open Passed at the bottom and search its name
- [ ] On a listing, press Interested: it moves to Deals at Interested with "Sign the NDA and ask the broker for a call" due tomorrow
- [ ] Work on now: press Done on a row whose action is the stage default. Answer Yes: the deal moves one stage. Press Later on another row: Tomorrow or a date
- [ ] Waiting on someone: press Chase on a row. The email editor opens with the follow-up drafted. Send now sends it, logs it on the deal, and the days count starts again
- [ ] Deals: the deals grouped by stage, with Passed and Lost collapsed at the bottom. Click a row: the deal page. Edit the key finding, the next action, and the facts, add a note, then press Advance
- [ ] More still lists Today, Close the day, Pipelines, and every old page
- [ ] When done testing: Settings, Sample data and reset, Remove sample data

## 000000. The focused version, batch 1: Today and Close the day (the live database has 0001 to 0018; about 5 minutes)

One database update. Until it is run, Today and Close the day show "Database update needed" and everything else keeps working (the old pages are under More).

**Step 1: database update 0019 (about 1 minute)**
- [ ] Open the file `supabase/UPDATE_0019_RUN_ONCE.sql` in the GitHub repository (bf-personal-app), press "Copy raw file"
- [ ] Supabase, project bf-personal-app, SQL Editor, New query: paste, press **Run**. Expected result: "Success. No rows returned"
- [ ] Running it a second time is safe. No existing record is changed; it adds the daily outcomes table, three fields on the daily plan, and two on tasks

**Step 2: check it (about 4 minutes)**
- [ ] The menu has five items: Today, Pipelines, Commitments, Reports, More. Today opens on the date with "Focused hours today" under it
- [ ] Today, Outcomes: type one outcome, press Enter. "Saved" shows under the rows. Press "+ Add" on a line in "Pick from next actions": it fills the next row
- [ ] Today's activity: press +1 on Listings screened. The count goes up
- [ ] Open a task from Next actions: the task window has "Waiting on" with a name and a date. Type a name, Save. Today lists it under "Waiting on someone"
- [ ] In the evening, press Close the day: step 1 (Complete, Partial, Incomplete and one result line per outcome), step 2 (what changed, tomorrow's top priority, any missed commitment resolved right there), step 3 (the daily report with Approve and send, or Not today). Press Finish. Today shows "Day closed" with Reopen
- [ ] More lists every old page (Finance, Plan, People, Reviews (old), Settings, Old Home, and the rest). Each still opens

## 00000. Done late and daily partner reports (a database with 0001 to 0017; already done on the live database; about 4 minutes)

One database update. Until it is run, Resolve shows Done late with "Database update needed" (the other choices work), partners stay Weekly, no daily report is drafted, and everything else keeps working.

**Step 1: database update 0018 (about 1 minute)**
- [ ] Open the file `supabase/UPDATE_0018_RUN_ONCE.sql` in the GitHub repository (bf-personal-app), press "Copy raw file"
- [ ] Supabase, project bf-personal-app, SQL Editor, New query: paste, press **Run**. Expected result: "Success. No rows returned"
- [ ] Running it a second time is safe. Every existing partner gets the report frequency Weekly; no report or commitment is changed

**Step 2: check it (about 3 minutes)**
- [ ] Accountability, Report templates: on the right, each partner has Template and Reports (Daily, Weekly, Both). Set one partner to Both
- [ ] Commitments: press Resolve on a missed commitment. The task window opens with "Resolve this miss" at the top. Choose Done late, type the reason, Save. The Resolved misses table shows "Done late" with the date
- [ ] On a weekday evening, complete the daily close: "Today's partner reports" shows the report for that partner. Press Approve and send (or Not today). Nothing is sent before you press it
- [ ] People, Communication history: open the sent report. The report shows as it was sent, with Open the PDF and Open the report record

## 0000. Partner report templates (a database with 0001 to 0016; already done on the live database; about 3 minutes)

One database update. Until it is run, report emails use the three starter templates (Standard by default), Accountability, Report templates shows "Database update needed" (naming the file), and everything else keeps working. The balance sheet and the deal scorecard need no update.

**Step 1: database update 0017 (about 1 minute)**
- [ ] Open the file `supabase/UPDATE_0017_RUN_ONCE.sql` in the GitHub repository (bf-personal-app), press "Copy raw file"
- [ ] Supabase, project bf-personal-app, SQL Editor, New query: paste, press **Run**. Expected result: "Success. No rows returned"
- [ ] Running it a second time is safe. It adds three starter templates once and gives each partner the Standard template; it changes no report

**Step 2: check it (about 2 minutes)**
- [ ] Accountability, Report templates: three cards (Summary, Standard, Detailed), no "Database update needed" notice. On the right, each partner shows Standard. Pick another template for a partner if you want
- [ ] Optional: press Add template, give it a name, tick the measures, choose the period, Save template
- [ ] Open a finalized partner report: the Report email card shows the template choice, "Second template (optional)", "Attach a PDF of the report" (off), and the preview. Send now shows the same email before it sends
- [ ] Finance, Balance Sheet: assets by type, liabilities, net worth, and the trend (Personal by default; Cyan Arc LLC and Both are one click away)
- [ ] Any pipeline item: the Deal scorecard card at the top right, and a colored dot before each item in the pipeline list

## 000. Deal funnel (a database with 0001 to 0015; already done on the live database; about 2 minutes)

One database update. Until it is run, the Acquisitions page shows the funnel with "Database update needed" (naming the file) and everything else keeps working.

**Step 1: database update 0016 (about 1 minute)**
- [ ] Open the file `supabase/UPDATE_0016_RUN_ONCE.sql` in the GitHub repository (bf-personal-app), press "Copy raw file"
- [ ] Supabase, project bf-personal-app, SQL Editor, New query: paste, press **Run**. Expected result: "Success. No rows returned"
- [ ] Running it a second time is safe. It adds three targets and five inputs once and changes no existing record

**Step 2: check it (about 1 minute)**
- [ ] Accountability, Targets: three new cards, each with "Commitment": **Listings screened** (20 per weekday, with +1, +5, Undo last, and a Note box), **CIMs reviewed** (1 per weekday), **Broker or owner calls** (2 per week). Each says "Counting since" today
- [ ] Above the first deal target: "Suggested targets: With 2 hours a day: screen 17 listings, reply to 4, review 1 CIM, 2 calls a week."
- [ ] Opportunities, Acquisitions: the header shows "Listings screened today: 0 of 20" with +1, +5, Undo last; the "Deal funnel, last 30 days" card shows six steps with no "Database update needed" notice. Press 90 days to see the longer view
- [ ] Plan, Inputs and Assumptions, Acquisition: "Search hours per day (hours)" is 2; minutes to screen a listing 3, review a CIM 45, reply or send an NDA 5, per call 30. Change them to match how you work; the suggested targets follow
- [ ] Optional: edit any of the three targets on the Targets tab (Edit) if the numbers do not fit. Suggestions never change a target on their own
- [ ] Logging a call: open a deal, Log activity, How: Call (or Meeting). It counts toward Broker or owner calls this week (one per deal per day)

## 00. Gmail signature on app emails (a database with 0001 to 0014; already done on the live database; about 3 minutes)

Three one-time steps. Until they are done, emails from the app are sent without a signature and everything else keeps working.

**Step 1: database update 0015 (about 1 minute)**
- [ ] Open the file `supabase/UPDATE_0015_RUN_ONCE.sql` in the GitHub repository (bf-personal-app), press "Copy raw file"
- [ ] Supabase, project bf-personal-app, SQL Editor, New query: paste, press **Run**. Expected result: "Success. No rows returned"
- [ ] Running it a second time is safe. It adds four empty columns to the owner profile and changes no existing record

**Step 2: reconnect Google once (about 1 minute)**
- [ ] Google Cloud console (project "BF Personal App"), APIs and Services, OAuth consent screen (or Data access), Scopes: add `https://www.googleapis.com/auth/gmail.settings.basic` next to the existing ones, Save. (The app asks for it either way; adding it here keeps the consent screen list accurate.)
- [ ] The app: Settings, Connections. The Google card says "Reconnect Google to use your Gmail signature (1 minute)". Press **Reconnect Google**
- [ ] Google: choose bram@cyanarc.com, keep every box checked, including "See, edit, create, or change your email settings and filters in Gmail" (the app only reads your signature with it), press Continue
- [ ] Back in the app: "Google is connected. Sending from the app is allowed." The Google card shows "Gmail signature: Can be copied" and no Reconnect message

**Step 3: copy the signature and test (about 1 minute)**
- [ ] Settings, Email signature, press **Copy from Gmail**. The Preview shows your Gmail signature (logo, phone number, links) and the Plain text version under it
- [ ] Edit the HTML only if something looks wrong, then press **Save signature**. Leave "Add signature to emails sent or drafted from the app" checked
- [ ] Test send: open a contact whose email is yours (or a test contact), press **Email**, type a subject and message, keep **Include signature** checked, press Send now. The dialog shows the signature below "--". Press Send email
- [ ] Gmail, Sent: the email shows the signature with its logo and links. In Gmail, More (three dots), Show original: the message has both a text/plain and a text/html part
- [ ] Optional: press Save to Gmail drafts on another email; Gmail, Drafts shows it with the signature

## 0. Database update 0013 and 0014 (a database with 0001 to 0012 or 0013; already done on the live database)

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
- [ ] SQL Editor: paste and run `supabase/ALL_MIGRATIONS_RUN_ONCE.sql` (0001 to 0017), or each file from `supabase/migrations/` in order: 0001 to 0017.
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
It also includes 0011 to 0017, so steps 0000, 000, 00, and 0 and the database parts of steps 1a and 1b are then not needed (Reconnect Google in steps 00 and 1a still is). The file holds ten updates:
- **0008:** Daily Targets, Outreach Queue.
- **0009:** stage task lists, time limits, required details, stalled items, deal source, Deals sourced and Deals advanced targets.
- **0010:** commitment rule. Only pipeline next actions, milestones, daily targets, and the reviews are commitments. Regular tasks that are not done move to the next day.
- **0011:** deal source chain and the Consulting pipeline (see 1b).
- **0012:** relationship groups Friend and Other; runway setting text (see 1b).
- **0013:** send email from the app: Gmail message ids and the partner report sent date (see 1a).
- **0014:** Start an initiative, checklists, savings ideas, sample data, Reset all data (see step 0).
- **0015:** Gmail signature on app emails (see step 00).
- **0016:** deal funnel: Listings screened, CIMs reviewed, and Broker or owner calls targets; search hours and minutes per step (see step 000).
- **0017:** partner report templates and a default template per partner (see step 0000).

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

## 5. Google (Gmail drafts, sending after you confirm, the Gmail signature, and Calendar), signed in as bram@cyanarc.com

- [ ] console.cloud.google.com: create a project "BF Personal App"
- [ ] APIs and Services, Library: enable **Gmail API** and **Google Calendar API**
- [ ] OAuth consent screen: User type **Internal**. App name "BF Personal App". Support email bram@cyanarc.com
- [ ] Scopes: `gmail.compose`, `gmail.send`, `gmail.settings.basic`, `calendar.events`, `calendar.readonly` (plus `openid` and `email`)
- [ ] Credentials, Create credentials, OAuth client ID, type **Web application**
- [ ] Authorized redirect URI: `<APP_URL>/api/google/callback`
- [ ] Vercel `GOOGLE_CLIENT_ID` = the client ID
- [ ] Vercel `GOOGLE_CLIENT_SECRET` = the client secret
- [ ] Redeploy, then in the app: Settings, Connections, **Connect Google**. Keep every box checked on Google's screen. The Google card then shows "Sending from the app: Allowed" and "Gmail signature: Can be copied". Then Settings, Email signature, Copy from Gmail, Save signature

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
