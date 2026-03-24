# Prisma P3009 — failed migration `20260207120000_add_tournament_start_scheduled_at`

Deploy fails in `prestart` with:

```text
Error: P3009
The `20260207120000_add_tournament_start_scheduled_at` migration ... failed
```

Prisma will not run newer migrations (including blind-clock columns) until this is cleared.

## Two different things (read this)

| Step | What it does | Triggers Render? |
|------|----------------|------------------|
| **A. Fix the database** | `migrate resolve` + `migrate deploy` on your laptop with **production** `DATABASE_URL` | **No.** This only updates Supabase / `_prisma_migrations`. |
| **B. Start the service** | Tell Render to run a new deploy | **Yes.** This is what actually restarts the app. |

Running Prisma locally **does not** ping Render. After the DB is fixed, you **must** redeploy the service yourself.

## Why it failed

Usually **`startScheduledAt` already exists** on `"Tournament"` (added manually, copy-paste SQL, or an old deploy). Postgres then errors with “column already exists” and Prisma marks the migration as **failed**.

## Auto-repair on Render (no laptop)

The server’s **`prestart`** runs `node server/scripts/prisma-migrate-deploy-or-repair.mjs` before `prisma generate`. **`postinstall`** only runs `prisma generate` so two migrate passes don’t fight for the same advisory lock on boot.

If `migrate deploy` fails with **P3009** and mentions **`20260207120000_add_tournament_start_scheduled_at`**, that script:

1. Ensures the column with `ADD COLUMN IF NOT EXISTS` (`server/scripts/sql/ensure-start-scheduled-at.sql`)
2. Runs `prisma migrate resolve --applied` for that migration
3. Runs `migrate deploy` again

Any other error still fails the deploy (so you are not silently masking broken migrations). Push the commit that includes this script and trigger a **Manual Deploy** (or rely on auto-deploy).

## Fix (production Supabase DB)

### Step 1 — Confirm column (optional)

In Supabase → SQL Editor:

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'Tournament' AND column_name = 'startScheduledAt';
```

### Step 2 — If the column exists (typical)

On your machine, with **production** `DATABASE_URL` (direct connection URI from Supabase is best for DDL):

```bash
cd /path/to/bux-poker
export DATABASE_URL='postgresql://...'

npx prisma migrate resolve \
  --applied 20260207120000_add_tournament_start_scheduled_at \
  --schema=prisma/schema.prisma
```

This tells Prisma: “that migration is satisfied; do not run its SQL again.”

### Step 3 — If the column does NOT exist

Add it once, then mark applied:

```sql
ALTER TABLE "Tournament" ADD COLUMN "startScheduledAt" TIMESTAMP(3);
```

Then run the same `migrate resolve --applied ...` as above.

**Alternative:** mark rolled back and redeploy (re-runs the migration SQL from the repo):

```bash
npx prisma migrate resolve \
  --rolled-back 20260207120000_add_tournament_start_scheduled_at \
  --schema=prisma/schema.prisma
```

Only use `--rolled-back` if the column is missing and you want Prisma to execute the migration file on the next `migrate deploy`.

### Step 4 — Apply any pending migrations

```bash
npx prisma migrate deploy --schema=prisma/schema.prisma
```

You should see `20260319120000_tournament_blind_anchor_break` apply if it was still pending.

### Step 5 — Redeploy on Render (required — CLI above does not do this)

After `migrate deploy` succeeds against prod:

1. Open **Render Dashboard** → select **bux-poker-server** (or your API service).
2. Click **Manual Deploy** → **Deploy latest commit** (or “Clear build cache & deploy” if you want a clean build).

You do **not** need a new git commit for the migration fix. Manual Deploy re-runs `prestart`; with the DB fixed, `prisma migrate deploy` should pass.

**Optional:** If you only use auto-deploy on push, run `git commit --allow-empty -m "chore: redeploy after prisma resolve" && git push` instead of Manual Deploy.

## Check status

```bash
npx prisma migrate status --schema=prisma/schema.prisma
```

## Do not edit old migration files

Changing SQL under an existing migration name breaks **checksums** for anyone who already applied that migration. Fix production with `migrate resolve` + optional manual SQL instead.
