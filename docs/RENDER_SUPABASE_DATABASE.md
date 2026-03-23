# Render + Supabase: `P1001 Can't reach database server`

If deploy logs show:

```text
Error: P1001: Can't reach database server at `....pooler.supabase.com:5432`
```

the server cannot open a TCP connection to Postgres. Fix **infrastructure / env**, not application code.

## 1. Confirm Supabase project is running

- Dashboard → your project → ensure it is **not paused** (free tier pauses after inactivity).

## 2. Use the correct connection string in Render

In **Supabase** → **Project Settings** → **Database**:

- **Direct connection** (best for `prisma migrate deploy` on boot):
  - Host looks like `db.<project-ref>.supabase.co`
  - Port **5432**
  - Append SSL, e.g. `?sslmode=require`

Example shape (password URL-encoded if it has special chars):

```text
postgresql://postgres.<PROJECT_REF>:<PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres?sslmode=require
```

- **Pooler** hostnames (`*.pooler.supabase.com`) use:
  - **Session mode** → often port **5432**
  - **Transaction mode** → port **6543** (and Prisma may need `pgbouncer=true` / `connection_limit=1` for runtime)

Copy the URI **exactly** from the dashboard for the mode you choose. A wrong port or host is a common cause of P1001.

## 3. Render environment variables

- Set `DATABASE_URL` on the **Render** web service (same value you tested).
- Redeploy after changing env vars.
- Do not commit real URLs/passwords to git.

## 4. IPv4 vs IPv6 (if it still fails)

Some hosts only route IPv4 to Supabase. If Supabase docs mention **IPv4 add-on** or connection issues from certain clouds, enable that or use the **direct** connection string that resolves over IPv4.

## 5. Quick local test

With the **same** `DATABASE_URL` as Render:

```bash
cd server && npx prisma db execute --stdin --schema=../prisma/schema.prisma <<< "SELECT 1"
```

If this fails locally too, the URL or network path is wrong; if it works locally but not on Render, compare env and Supabase network settings.

## 6. `npm audit` warnings

The audit summary during `npm install` does **not** cause P1001. Address separately with `npm audit` / dependency updates when convenient.
