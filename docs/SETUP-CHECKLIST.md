# Setup checklist

Do these in order. Each line says where to copy a value from and where to paste it.
Vercel variables go in: Vercel, project bf-personal-app, Settings, Environment Variables (Production).

## 1. Supabase (database)

- [ ] Create a Supabase project (sign in with GitHub). Region: US East. Save the database password somewhere safe.
- [ ] SQL Editor: paste and run `supabase/ALL_MIGRATIONS_RUN_ONCE.sql` (0001 to 0011), or each file from `supabase/migrations/` in order: 0001 to 0011.
- [ ] Authentication, Sign In / Providers, Email: enabled. Multi-Factor: TOTP enabled.
- [ ] Copy Settings, API, **Project URL** to Vercel `NEXT_PUBLIC_SUPABASE_URL`
- [ ] Copy Settings, API, **anon public** key to Vercel `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] Copy Settings, API, **service_role** key to Vercel `SUPABASE_SERVICE_ROLE_KEY` (keep private)
- [ ] Authentication, URL Configuration: Site URL = your Vercel address (same as `APP_URL`)

## 1a. Database update 0011 (the live database: it has 0001 to 0010)

Adds the deal source chain ("Deal came from", "Introduced by") and the Consulting pipeline.

- [ ] Open the file `supabase/UPDATE_0011_RUN_ONCE.sql` in the GitHub repository (bf-personal-app), press "Copy raw file"
- [ ] Supabase, project bf-personal-app, SQL Editor, New query: paste, press **Run**. Expected result: "Success. No rows returned"
- [ ] Open the app: Opportunities shows a sixth pipeline, **Consulting** (Identified, Contacted, Discovery call, Proposal sent, Negotiating, Signed, Active, Completed, Lost). The "Database update needed" notices naming this file are gone
- [ ] Settings, Initiatives and pipelines, Consulting: each stage shows its task list, time limit, required details, and chance (10% to 100%). Signed and Active show "Signed work". Edit anything that does not fit
- [ ] Plan, Inputs and Assumptions: Runway has "Count signed consulting income in runway" (0 = off); Consulting has "Consulting: monthly income" (0) and "Consulting: months of consulting income" (12)
- [ ] Running the file a second time is safe (nothing is duplicated)

## 1b. Database update (older database only: one combined file)

Do this once if the database was set up before 0010 (it has 0001 to 0007, 0001 to 0008, or 0001 to 0009).
It also includes 0011, so step 1a is then not needed. The file holds four updates:
- **0008:** Daily Targets, Outreach Queue.
- **0009:** stage task lists, time limits, required details, stalled items, deal source, Deals sourced and Deals advanced targets.
- **0010:** commitment rule. Only pipeline next actions, milestones, daily targets, and the reviews are commitments. Regular tasks that are not done move to the next day.
- **0011:** deal source chain and the Consulting pipeline (see 1a).

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

## 5. Google (Gmail drafts and Calendar), signed in as bram@cyanarc.com

- [ ] console.cloud.google.com: create a project "BF Personal App"
- [ ] APIs and Services, Library: enable **Gmail API** and **Google Calendar API**
- [ ] OAuth consent screen: User type **Internal**. App name "BF Personal App". Support email bram@cyanarc.com
- [ ] Scopes: `gmail.compose`, `calendar.events`, `calendar.readonly` (plus `openid` and `email`)
- [ ] Credentials, Create credentials, OAuth client ID, type **Web application**
- [ ] Authorized redirect URI: `<APP_URL>/api/google/callback`
- [ ] Vercel `GOOGLE_CLIENT_ID` = the client ID
- [ ] Vercel `GOOGLE_CLIENT_SECRET` = the client secret
- [ ] Redeploy, then in the app: Settings, Connections, **Connect Google**

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
