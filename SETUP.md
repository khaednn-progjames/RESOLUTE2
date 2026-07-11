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

## TL;DR
1. Fork → import to Vercel → deploy.
2. New Supabase → run the **SQL** above → paste your **URL + anon key** into `sync.js`,
   `topbar.js`, `gym.html`.
3. Change the password in `lock.js`. Done.
