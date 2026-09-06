# Diagnostic Bench — CompTIA A+ Study App

A timed practice-quiz app for the CompTIA A+ Core 1 (220-1201) and Core 2
(220-1202) exams, backed by Supabase. Installable straight to an iPhone home
screen as a standalone app (no App Store needed).

## 1. Set up Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. In the dashboard, go to **SQL Editor → New query**, paste the contents of
   `supabase/schema.sql`, and run it. This creates three tables:
   `questions`, `quiz_history`, and `bookmarks`.
3. Run `supabase/seed.sql` the same way — this inserts the 45 starter
   questions into the `questions` table. You can re-run it safely later if
   you add more questions (it upserts by id).
4. Go to **Project Settings → API** and copy your **Project URL** and
   **anon public key**.

## 2. Configure the app

```bash
cp .env.example .env
```

Edit `.env` and paste in your Supabase URL and anon key:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

## 3. Run it locally

```bash
npm install
npm run dev
```

Open the printed local URL in your browser.

## 4. Deploy so you can reach it from your iPhone

The simplest free option is **Vercel**:

1. Push this project to a GitHub repo.
2. Go to [vercel.com](https://vercel.com) → **New Project** → import that repo.
3. Vercel auto-detects Vite. Before deploying, add your two environment
   variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) in the Vercel
   project settings — same values as your `.env`.
4. Deploy. You'll get a URL like `https://your-app.vercel.app`.

(Netlify or Cloudflare Pages work the same way if you prefer those.)

## 5. Add it to your iPhone home screen

1. Open your deployed URL in **Safari** on the iPhone (must be Safari, not
   Chrome — Chrome on iOS can't add home-screen apps with standalone mode).
2. Tap the **Share** button (square with an arrow).
3. Tap **Add to Home Screen**.

It'll launch full-screen, no browser chrome, with its own icon — the closest
thing to a native app without going through the App Store.

## How data works (no login)

There's no login screen. On first visit, the app generates a random device
ID and stores it in the browser's `localStorage`. That ID scopes your quiz
history and bookmarks in the shared Supabase tables. This is simplest for
solo use, but it does mean:

- Clearing Safari's site data (or using a different browser/device) starts
  you over with a "new" device and empty history.
- Anyone with your Supabase anon key could technically read/write any
  device's rows, since there's no real per-user auth. Fine for a personal
  study tool; don't reuse this pattern for anything with real user data.

If you ever want your progress to follow you across devices properly, the
next step up is adding Supabase Auth (email magic link) and scoping rows to
`auth.uid()` instead of a local device ID — happy to build that when you
want it.

## Project structure

```
src/
  App.jsx            — all UI and quiz logic
  supabaseClient.js   — Supabase client + device-id helper
supabase/
  schema.sql          — run first: creates tables + RLS policies
  seed.sql            — run second: inserts the question bank
scripts/
  gen_seed.py         — regenerates seed.sql if you edit the question list
public/
  manifest.json, icon-*.png, apple-touch-icon.png — PWA / home-screen icons
```

To add more questions later, either insert rows directly in the Supabase
table editor, or edit the `QUESTIONS` list in `scripts/gen_seed.py` and
re-run `python3 scripts/gen_seed.py` then re-run the generated `seed.sql`.
