# Fixing "modified migration" and drift (no data loss)

If `npx prisma migrate dev` says the migration was **modified after it was applied** and reports **drift**, use this flow instead of `prisma migrate reset` (so you keep all data).

## 1. Fix drift in the database

Run the drift-fix SQL against your DB:

```bash
# From project root, with DATABASE_URL in .env:
psql "$DATABASE_URL" -f prisma/fix-and-migrate.sql
```

Or copy the contents of `prisma/fix-and-migrate.sql` into the **Supabase SQL Editor** and run it.

## 2. Re-record the modified migration

Prisma is complaining because the migration file `20260115204253_add_discord_server_config` was changed after it was applied, so its checksum no longer matches. Re-record it with the current file:

```bash
# From project root
npx prisma migrate resolve --applied "20260115204253_add_discord_server_config"
```

If that fails (e.g. "Migration not found"), the migration history expects that name. List applied migrations:

```bash
npx prisma migrate status
```

Then remove the applied row for that migration from the database so Prisma can re-record it:

```sql
-- Run in Supabase SQL Editor or psql (replace with your migration name if different)
DELETE FROM "_prisma_migrations"
WHERE migration_name = '20260115204253_add_discord_server_config';
```

Then run again:

```bash
npx prisma migrate resolve --applied "20260115204253_add_discord_server_config"
```

## 3. Create and apply the new migration

```bash
npx prisma migrate dev --name add_player_finishing_place
```

This should create the migration that adds `Player.finishingPlace` and apply it.

## 4. Regenerate the client (if needed)

```bash
npx prisma generate
```

---

## If you prefer to add the column manually (no migrate dev)

1. Run drift fix only (step 1 above).
2. Add the column in SQL:

   ```sql
   ALTER TABLE "Player" ADD COLUMN IF NOT EXISTS "finishingPlace" INTEGER;
   ```

3. Regenerate the client:

   ```bash
   npx prisma generate
   ```

4. You still need to fix the "modified" migration (step 2) and then create a migration that adds `finishingPlace` so that `prisma migrate deploy` on other environments applies it. So creating the migration via `migrate dev` after fixing steps 1–2 is the cleanest approach.
