# Fix Prisma Client on Render

## Problem
The error "Unknown argument inviteLink" means Render's Prisma client is out of sync with the schema.

## Solution: Manual Fix on Render

### Option 1: Via Render Dashboard (Recommended)

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Select your `bux-poker-server` service
3. Go to **"Shell"** tab (or **"Manual Deploy"** → **"Run Command"**)
4. Run these commands one at a time:

```bash
cd /opt/render/project/src
npx prisma migrate deploy --schema=../prisma/schema.prisma
npx prisma generate --schema=../prisma/schema.prisma
```

5. After running these commands, restart your service (or it will auto-restart)

### Option 2: Trigger Manual Rebuild

1. Go to Render Dashboard → Your Service
2. Click **"Manual Deploy"** → **"Deploy latest commit"**
3. This will trigger a fresh build that runs the `postinstall` script
4. The `postinstall` script will:
   - Run `prisma migrate deploy` (applies migrations)
   - Run `prisma generate` (regenerates Prisma client)

### Option 3: Check Build Logs

1. Go to Render Dashboard → Your Service → **"Logs"**
2. Look for the `postinstall` script output
3. You should see:
   ```
   > prisma migrate deploy --schema=../prisma/schema.prisma
   > prisma generate --schema=../prisma/schema.prisma
   ```
4. If these commands aren't running, the build might be failing silently

## Verify It's Fixed

After running the commands or rebuilding, test the `/setup` command in Discord again. The error should be gone.

## Why This Happened

- The migration was created locally and applied to your local database
- Render's database might not have the migration applied yet
- Render's Prisma client wasn't regenerated with the new schema fields
- The `postinstall` script should fix this automatically on future deployments
