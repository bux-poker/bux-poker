# Prisma P3009 — failed migration `20260207120000_add_tournament_start_scheduled_at`

Deploy fails in `prestart` with:

```text
Error: P3009
The `20260207120000_add_tournament_start_scheduled_at` migration ... failed
```

Prisma will not run newer migrations (including blind-clock columns) until this is cleared.

## Why it failed

Usually **`startScheduledAt` already exists** on `"Tournament"` (added manually, copy-paste SQL, or an old deploy). Postgres then errors with “column already exists” and Prisma marks the migration as **failed**.

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

### Step 5 — Redeploy on Render

Push (if needed) and trigger deploy so `npm start` → `prestart` succeeds.

## Check status

```bash
npx prisma migrate status --schema=prisma/schema.prisma
```

## Do not edit old migration files

Changing SQL under an existing migration name breaks **checksums** for anyone who already applied that migration. Fix production with `migrate resolve` + optional manual SQL instead.
