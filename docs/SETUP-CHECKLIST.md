# Setup checklist

Do these in order. Each line says where to copy a value from and where to paste it.
Vercel variables go in: Vercel, project bf-personal-app, Settings, Environment Variables (Production).

## 1. Supabase (database)

- [ ] Create a Supabase project (sign in with GitHub). Region: US East. Save the database password somewhere safe.
- [ ] SQL Editor: paste and run each file from `supabase/migrations/`, in order: 0001, 0002, 0003, 0004, 0005, 0006, 0007.
- [ ] Authentication, Sign In / Providers, Email: enabled. Multi-Factor: TOTP enabled.
- [ ] Copy Settings, API, **Project URL** to Vercel `NEXT_PUBLIC_SUPABASE_URL`
- [ ] Copy Settings, API, **anon public** key to Vercel `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- [ ] Copy Settings, API, **service_role** key to Vercel `SUPABASE_SERVICE_ROLE_KEY` (keep private)
- [ ] Authentication, URL Configuration: Site URL = your Vercel address (same as `APP_URL`)

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
- [ ] Monthly: Settings, Export, Download full export
