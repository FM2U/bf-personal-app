# BF Personal App

Bram's personal productivity and accountability app. Next.js 16, Supabase (Postgres), Vercel.
One user. Desktop first. Work module (deals, listings, contacts, Rosara, job search, consulting,
to-dos) plus Accountability (targets, End of day report to partners, weekly and monthly reviews).

## Start every session

- Read the newest `claude/*-session-handoff.md` in the claude.ai Project first. It is last
  session's snapshot, not the current state: before advising on the preview, ask Bram for today's
  day, whether End of day is sent, and whether sample data is loaded.
- Work on branch `final-app`. Never touch `main` before setup day.

## Commands

- Local database: `service postgresql start`, then `bash dev-tools/setup-local-db.sh` (fresh
  database before each flow check).
- Run the app: `bash dev-tools/start-local.sh`.
- Build and type check need `NODE_OPTIONS=--max-old-space-size=4096` in the container.
- Checks, all must pass before a commit is reported:
  `npx vitest run`, `bash dev-tools/push-b-friday.sh`, `node dev-tools/check-push-c.cjs`,
  `bash dev-tools/push-d-days.sh`, `node dev-tools/check-push-e.cjs`,
  `node dev-tools/check-push-e2.cjs`, `node dev-tools/check-pages.cjs`,
  `node dev-tools/check-speed.cjs` (app started with `SHOW_TIMING=1 BATCH_VERIFY=1`, sample data loaded),
  `node dev-tools/check-full.cjs` (Screen listings, Rosara, Job search, Consulting, Settings; replaces the
  old `check-flows.cjs`, which tests pages that no longer exist),
  `node dev-tools/check-ai-rules.cjs` (after any prompt change).
- Afterwards: `git checkout -- docs/screenshots` and remove untracked images.
- Vercel build status: `gh api repos/FM2U/bf-personal-app/commits/<sha>/statuses`.

## Code rules

- No prettier on whole files.
- Every database change goes in `supabase/SETUP_NEW_DATABASE.sql` plus a guarded
  `supabase/UPDATE_PREVIEW_PUSH_<X>.sql`. Each file runs as one query and is safe to run twice.
- Never name a table `tasks`.
- Shared AI rules live in `src/lib/ai/rules.ts` (`AI_ROLE`, used by `src/lib/ai/claude.ts`).
  Features add task text only. Prompts say "the signed-in user", never a name.
- Email sign-offs use the Name in Settings (`owner_profile.display_name`), never a name typed into the code.
- In the app's own screens the app speaks to the user as "you"; in reports the user speaks ("I", "my").
- Layout: cards side by side line up; rows, columns and fields stay aligned when labels wrap;
  centered windows for reading whole items, side panels for quick entry and lists; light, calm.
- Words never used in the app or in replies: "wedge", "lane", "shape" (for a kind of thing).

## Never

- Touch `main`, Production settings, or the old database before setup day.
- Put keys in chat or in commits.
- Commit a builder's half-done work.
- Change the preview database; Bram runs the update files himself.

## Working with Bram

- Propose, get a yes, build; one step at a time. Every decision goes in a Project doc.
- First line of a reply is the direct answer. If there is a catch, it goes first.
- One plain full sentence per bullet. Name what you mean; no bare "it" or "this".
  No metaphors, jargon, shorthand, coined phrases, hyperbole, or em-dashes.
- Describe what Bram sees or does on screen. Give exact click paths (menu item, card, button).
  Only give steps he can do on the preview right now.
- Every step names the thing it acts on and where it is on screen, with how to do it. Never a bare
  verb like "reload", "refresh" or "open": write "reload the browser page (the circular arrow left of
  the address bar, or Command+R)".
- List the files created or changed at the end of a task.
- Label every description with where it happens (Bram, 2026-11-07): "In the live app (while you use it)"
  for what Bram sees and does in the app, or "While building (in Claude, before release)" for what
  Claude does to write, test or fix the code. Never mix the two in one bullet.

## Speed rules (Bram, 2026-11-07; plan in claude/2026-11-07-speed-plan.md)

- Reads asked at the same moment go to the database together in one trip (`src/lib/supabase/batch.ts`
  to `read_batch`). A read that waits for another read's answer adds a trip: start every read of a page
  at once, read the owner's rows and keep the ones needed (`src/lib/work/shared-reads.ts`), with
  `pickOrRead` so a read that reached its limit falls back to reading by id.
- Settings a page needs first (time zone, thresholds, Name, pipeline ids) come from the browser cookie
  (`src/lib/kept-settings.ts`); a save that changes them calls `forgetKeptSettings()`.
- Rules (due dates, groupings, counts) stay in the app's code; the database only gathers rows.
- Target: every page opens in under 0.5 s on a click. Measure before reporting any change done;
  `check-speed.cjs` holds each page's trip limit.
