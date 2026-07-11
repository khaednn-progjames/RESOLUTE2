# Dashboard — Setup Guide (fork → deploy in ~5 min)

This is a static dashboard (plain HTML/JS) that deploys on **Vercel** and syncs across your
devices with **Supabase**.

---

## 1. Fork & deploy

1. **Fork** this repo to your GitHub.
2. Go to **vercel.com → Add New → Project → Import** your fork.
3. Framework Preset: **Other**. Root Directory: **`./`**. Build/output: leave blank (static).
4. **Deploy.** You'll get a URL like `https://your-app.vercel.app`.

The dashboard opens to a **password screen** — the default password is in
[`lock.js`](lock.js) (`var PASSWORD = "qwer"`). Change it to whatever you want.

---

## 2. Supabase (cross-device sync) — required for sync

Create a free project at **supabase.com**, then run **both** SQL blocks in
**SQL Editor → New query → Run**.

### SQL #1 — `app_state` (all dashboard sync)
```sql
create table if not exists public.app_state (
  key        text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- The browser uses the ANON key, so allow it to read/write:
alter table public.app_state enable row level security;
create policy "anon full access app_state"
  on public.app_state for all
  to anon using (true) with check (true);

-- Instant cross-device updates:
alter publication supabase_realtime add table public.app_state;
```

### SQL #2 — progress-photo sync (Storage bucket)
Progress photos upload to a Supabase **Storage** bucket called `progress-photos` (only the
image URLs sync through `app_state`). Skip this if you don't need photos to sync across devices.
```sql
insert into storage.buckets (id, name, public)
values ('progress-photos', 'progress-photos', true)
on conflict (id) do nothing;

create policy "anon manage progress-photos"
  on storage.objects for all
  to anon
  using (bucket_id = 'progress-photos')
  with check (bucket_id = 'progress-photos');
```

### Connect YOUR Supabase — pick ONE way
Supabase → **Project Settings → API**. Copy the **Project URL** and the **anon / publishable** key.

**Way A — Vercel env vars (easiest, no code edits):**
In Vercel → **Settings → Environment Variables**, add:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | your Project URL |
| `SUPABASE_ANON_KEY` | your anon / publishable key |

Redeploy. The app reads these automatically via `/api/config`.

**Way B — edit the files:**
Replace the old URL/key in these files:
- [`sync.js`](sync.js)
- [`topbar.js`](topbar.js)
- [`gym.html`](gym.html)

> ⚠️ Only the **anon** key (public) is used here. **Never** put the `service_role` key in code
> or in these env vars.

---

## 3. Nova (AI mentor / gym coach) — optional

No setup or key in the repo. Each user **pastes their own Anthropic API key** on the
**Nova** tile; it's stored only in their browser and sent straight to Anthropic. Get a key at
console.anthropic.com.

---

## 4. Bank Accounts (Plaid) — optional, US/Canada only

Real, live bank balances via **Plaid**. Unlike the rest of the app, this one needs a proper
backend secret — the Plaid access token must **never** reach the browser, so it can't live in
`localStorage` or the public `app_state` table the rest of the dashboard uses.

### 4.1 Get Plaid API keys
1. Sign up at **dashboard.plaid.com** → note your **Client ID** and **Sandbox secret**.
2. Test everything in **Sandbox** first (fake banks, fake data — safe to break). Plaid's test
   login is `user_good` / `pass_good` for any institution.
3. When ready for your real bank, apply for **Production** access in the Plaid dashboard
   (there's a review step, and production usage has its own pricing — check Plaid's current
   terms before connecting a real account).

### 4.2 SQL #3 — `plaid_items` (bank access tokens — locked down)
Run in **SQL Editor → New query → Run**. Note there's **no `anon` policy** here on purpose —
row level security is on with zero policies, so the public anon key (the one shipped to the
browser) gets **no access at all**. Only the `service_role` key can read/write this table, and
that key only ever lives in Vercel env vars, used by the `api/plaid-*.js` functions.
```sql
create table if not exists public.plaid_items (
  id               bigint generated always as identity primary key,
  item_id          text unique not null,
  access_token     text not null,
  institution_name text,
  created_at       timestamptz not null default now()
);

alter table public.plaid_items enable row level security;
-- Deliberately no policies: RLS with zero policies = no anon/public access whatsoever.
```

### 4.3 Vercel env vars
| Variable | Value |
|---|---|
| `PLAID_CLIENT_ID` | your Plaid Client ID |
| `PLAID_SECRET` | your Plaid Sandbox (or Production) secret |
| `PLAID_ENV` | `sandbox` or `production` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → **service_role** secret |

> ⚠️ `SUPABASE_SERVICE_ROLE_KEY` bypasses row level security entirely. It must **only** ever be
> a Vercel env var read by `api/plaid-*.js` (server-side). Never put it in any `.html`/`.js`
> file that ships to the browser, and never reuse the `SUPABASE_ANON_KEY` for it.

Redeploy after adding the env vars, then open the **Bank Accounts** tile → **Connect a bank**.

---

## 5. Iron Condor Bot (Tastytrade) — optional, real money, use at your own risk

Fully-automated 0DTE SPY iron condor bot. This is the highest-stakes optional feature in the
repo — it can place real multi-leg options orders. Read this whole section before enabling it.

**It was built without any Tastytrade account to test against.** The auth flow, option-chain
parsing, and strike selection follow Tastytrade's public API shape as documented, but the live
quote-fetching endpoint in particular (`/market-data/quotes`) has not been verified against a
real account. If it can't get a clean quote, the bot skips the trade rather than guess — but
you should still test extensively in **Sandbox** with **mode: paper** for a while, then
**Sandbox + mode: live** against a Tastytrade certification account, before ever pointing this
at a real brokerage account.

**Safety rails built in, all defaulting to the safe side:**
- `enabled` (master kill switch) defaults to **off**.
- `mode` defaults to **paper** (simulates and logs a trade, places no real order).
- `max_risk_per_trade` is checked against the **worst-case loss** (wing width, assuming $0
  credit) — not the estimated credit — so the cap can't be exceeded even if the credit estimate
  is wrong.
- `daily_loss_limit` is a circuit breaker: if today's logged losses reach it, the bot stops
  trading for the rest of the day.
- Only ever enters once per day, only inside the configured entry-window (ET), only on weekdays.
- Because it's a defined-risk iron condor (long wings on both sides), max loss per trade is
  capped at trade entry regardless of what SPY does afterward — there's no active stop-loss
  logic, which is deliberate, not an oversight.

### 5.1 Get Tastytrade API access
Tastytrade's API is at `api.tastyworks.com` (production) / `api.cert.tastyworks.com`
(sandbox/certification). Log in with your normal Tastytrade username/password — there's no
separate developer signup for personal use, but **use a certification/sandbox account to test**,
never your real account, until you've watched the bot run correctly in paper mode for a while.

### 5.2 SQL #4 — `tt_session`, `tt_settings`, `tt_trades` (locked down, same pattern as Plaid)
```sql
create table if not exists public.tt_session (
  id              bigint primary key,
  username        text,
  session_token   text,
  remember_token  text,
  environment     text,
  account_number  text,
  expires_at      timestamptz,
  updated_at      timestamptz not null default now()
);
alter table public.tt_session enable row level security;
-- No policies: zero anon/public access, service_role only.

create table if not exists public.tt_settings (
  id                    bigint primary key,
  enabled               boolean not null default false,
  mode                  text not null default 'paper',
  symbol                text not null default 'SPY',
  short_otm_pct         numeric not null default 0.6,
  wing_width            numeric not null default 2,
  contracts             integer not null default 1,
  max_risk_per_trade    numeric not null default 200,
  daily_loss_limit      numeric not null default 400,
  entry_window_start    text not null default '09:45',
  entry_window_end      text not null default '10:15',
  updated_at            timestamptz not null default now()
);
alter table public.tt_settings enable row level security;
-- No policies here either — settings are only ever read/written via api/tt-settings.js.

create table if not exists public.tt_trades (
  id                 bigint generated always as identity primary key,
  opened_at          timestamptz not null default now(),
  symbol             text,
  expiration         text,
  short_call_strike  numeric,
  long_call_strike   numeric,
  short_put_strike   numeric,
  long_put_strike    numeric,
  credit             numeric,
  max_loss           numeric,
  realized_pnl       numeric,
  contracts          integer,
  mode               text,
  status             text,
  order_id           text,
  note               text
);
alter table public.tt_trades enable row level security;
-- No policies: only api/tt-trades.js (service role) can read this.
```

### 5.3 Vercel env vars
| Variable | Value |
|---|---|
| `CRON_SECRET` | any random string you generate — protects `/api/iron-condor-run` so only Vercel's own cron can trigger it |

`SUPABASE_SERVICE_ROLE_KEY` from §4.3 is reused here — no separate Tastytrade secret is needed
in env vars; the session itself is created by logging in from the **Iron Condor Bot** tile.

### 5.4 Scheduling
`vercel.json` already defines a cron hitting `/api/iron-condor-run` every 15 minutes, 13:00–21:59
UTC, Monday–Friday (covers US market hours across both EST/EDT with margin — the function itself
checks the precise ET entry window from your settings). Check your current Vercel plan's cron
limits; if your plan restricts frequency, an external scheduler (e.g. cron-job.org) hitting the
same URL with `Authorization: Bearer <CRON_SECRET>` works identically.

> ⚠️ There is deliberately no "run now" button in the UI — the bot only ever fires on the cron
> schedule, to keep entry timing consistent and to avoid the temptation to bypass the entry-window
> check while testing.

---

## 6. USPS Tracking — optional

Live package status via USPS's official **Tracking API**. Much lower stakes than the sections
above — no money involved, just package status — so no locked-down Supabase table is needed;
it's a single app-level API credential kept as a Vercel env var, same as the Anthropic-key-free
sections.

### 6.1 Get USPS API keys
1. Register an app at **developer.usps.com** → note your **Consumer Key** and **Consumer Secret**.
2. That's it — the app requests a fresh OAuth2 token per lookup, no token storage needed.

### 6.2 Vercel env vars
| Variable | Value |
|---|---|
| `USPS_CONSUMER_KEY` | your USPS API Consumer Key |
| `USPS_CONSUMER_SECRET` | your USPS API Consumer Secret |

Redeploy, then open **Miscellaneous → USPS Tracking** and add a tracking number.

> Note: the response parsing in `api/usps-track.js` follows USPS's documented Tracking API shape
> but hasn't been verified against a live account — if a field name is off, the page falls back
> to showing whatever status text it can find rather than crashing. Worth a quick real test once
> your keys are in.

---

## TL;DR
1. Fork → import to Vercel → deploy.
2. New Supabase → run the **SQL** above → paste your **URL + anon key** into `sync.js`,
   `topbar.js`, `gym.html`.
3. Change the password in `lock.js`. Done.
