# 🚂 Railway Quick Start Guide

## One-Time Setup

### 1. Create Railway Project
1. Go to [railway.app](https://railway.app) → Sign in with GitHub
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Select your `bux-poker` repository
4. Railway will auto-detect Node.js

### 2. Configure Service
1. Railway should detect `server/` directory automatically
2. If not: **Settings** → **Root Directory** → `server`
3. **Settings** → **Start Command**: `npm start` (default)

### 3. Set Environment Variables
Go to **Variables** tab, add:

```bash
# Required
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
NODE_ENV=production
SESSION_SECRET=[GENERATE-RANDOM-STRING]
CLIENT_URL=https://your-vercel-app.vercel.app

# Optional (Discord)
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_BOT_TOKEN=...
```

**Generate SESSION_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Run Database Migration
After first deployment, run migration:

**Option A: Via Railway Dashboard**
1. Go to your service → **Deployments** → **New Deployment**
2. Add command: `npx prisma migrate deploy`

**Option B: Via Railway CLI**
```bash
npm i -g @railway/cli
railway login
railway link
cd server
railway run npx prisma migrate deploy
```

### 5. Get Your Backend URL
Railway provides: `https://your-app-name.up.railway.app`

Use this URL in your Vercel frontend env vars.

---

## Continuous Deployment

Railway automatically deploys on every push to your main branch.

**To trigger manual deployment:**
- Push to GitHub, or
- Click **"Deploy"** button in Railway dashboard

---

## Useful Railway Commands

```bash
# View logs
railway logs

# Run command in Railway environment
railway run [command]

# Open shell
railway shell

# View variables
railway variables
```

---

## Troubleshooting

**Deployment fails?**
- Check build logs in Railway dashboard
- Ensure `server/package.json` has `start` script
- Verify all dependencies are in `dependencies` (not `devDependencies`)

**Database connection fails?**
- Verify `DATABASE_URL` is correct
- Check Supabase project is active
- Ensure Prisma client is generated: `railway run npx prisma generate`

**CORS errors?**
- Verify `CLIENT_URL` matches your Vercel URL exactly
- Check `server/src/config/server.js` includes your domain

---

**See DEPLOYMENT.md for full deployment guide.**
