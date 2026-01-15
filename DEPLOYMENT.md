# 🚀 Deployment Guide - BUX Poker

## Architecture

- **Frontend**: Vercel (from `client/` directory)
- **Backend**: Railway (from `server/` directory)
- **Database**: Supabase Postgres (via Prisma)

---

## 📋 Prerequisites

1. **Supabase Account**: [supabase.com](https://supabase.com)
2. **Vercel Account**: [vercel.com](https://vercel.com)
3. **Railway Account**: [railway.app](https://railway.app)
4. **GitHub Repository**: Your code pushed to GitHub

---

## 🗄️ Step 1: Set Up Supabase Database

### 1.1 Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Wait for the project to finish provisioning (takes ~2 minutes)
3. Go to **Project Settings** → **Database**
4. Find **Connection string** → **URI** (Node.js format)
5. Copy the connection string (looks like):
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
   ```
   **⚠️ Important**: Replace `[YOUR-PASSWORD]` with your actual database password (shown once during project creation)

### 1.2 Run Prisma Migrations

**Option A: Run locally (recommended for first migration)**

1. Create `.env` file in project root:
   ```bash
   DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"
   ```

2. Run migrations:
   ```bash
   cd server
   npm install
   npx prisma generate
   npx prisma migrate dev --name init
   ```

**Option B: Run via Railway (after deployment)**

- Railway will run migrations automatically if you set up a migration script (see Step 3)

### 1.3 Verify Database Connection

```bash
cd server
npx prisma studio
```

This opens Prisma Studio where you can view your database tables.

---

## 🚂 Step 2: Deploy Backend to Railway

### 2.1 Create Railway Project

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Choose your `bux-poker` repository
5. Railway will auto-detect it's a Node.js project

### 2.2 Configure Railway Service

1. Railway should detect the `server/` directory automatically
2. If not, go to **Settings** → **Root Directory** → Set to `server`
3. Go to **Settings** → **Build Command**: Leave empty (Railway auto-detects)
4. Go to **Settings** → **Start Command**: `npm start` (or `node src/index.js`)

### 2.3 Set Environment Variables

Go to **Variables** tab and add:

```bash
# Database (from Supabase)
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres

# Server
NODE_ENV=production
PORT=3000
SESSION_SECRET=[GENERATE-A-RANDOM-STRING-HERE]

# Client URL (will be your Vercel URL)
CLIENT_URL=https://your-app-name.vercel.app
CLIENT_URL_ALT=https://www.your-custom-domain.com  # Optional, if you have custom domain

# Discord Bot (if you have Discord integration)
DISCORD_CLIENT_ID=your-discord-client-id
DISCORD_CLIENT_SECRET=your-discord-client-secret
DISCORD_BOT_TOKEN=your-discord-bot-token
DISCORD_CALLBACK_URL=https://your-railway-url.railway.app/auth/discord/callback

# Redis (if using Redis, optional for now)
REDIS_URL=redis://default:[PASSWORD]@[HOST]:[PORT]  # Optional
```

**Generate SESSION_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2.4 Deploy

1. Railway will automatically deploy when you push to your main branch
2. Or click **"Deploy"** button to trigger manual deployment
3. Wait for deployment to complete (~2-3 minutes)
4. Railway will provide a URL like: `https://your-app-name.up.railway.app`

### 2.5 Set Up Custom Domain (Optional)

1. Go to **Settings** → **Domains**
2. Click **"Generate Domain"** or add your custom domain
3. Update `CLIENT_URL` env var if needed

### 2.6 Run Database Migrations on Railway

**Option A: Via Railway CLI**

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Link to your project
railway link

# Run migration
cd server
railway run npx prisma migrate deploy
```

**Option B: Via Railway Dashboard**

1. Go to your Railway service
2. Click **"Deployments"** → **"New Deployment"**
3. Add a one-time command: `npx prisma migrate deploy`
4. Or add to `package.json` scripts and run via Railway

---

## ⚡ Step 3: Deploy Frontend to Vercel

### 3.1 Create Vercel Project

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **"Add New..."** → **"Project"**
3. Import your `bux-poker` repository
4. Configure project:
   - **Framework Preset**: Vite
   - **Root Directory**: `client`
   - **Build Command**: `npm run build` (auto-detected)
   - **Output Directory**: `dist` (auto-detected)
   - **Install Command**: `npm install` (auto-detected)

### 3.2 Set Environment Variables

Go to **Settings** → **Environment Variables** and add:

```bash
# Backend API URL (your Railway URL)
VITE_API_BASE_URL=https://your-app-name.up.railway.app

# Socket URL (same as API, or separate if needed)
VITE_SOCKET_URL=https://your-app-name.up.railway.app
```

### 3.3 Deploy

1. Click **"Deploy"**
2. Vercel will build and deploy automatically
3. You'll get a URL like: `https://your-app-name.vercel.app`

### 3.4 Update Railway Environment Variables

After Vercel deployment, go back to Railway and update:

```bash
CLIENT_URL=https://your-app-name.vercel.app
```

This ensures CORS works correctly.

---

## 🔄 Step 4: Set Up Continuous Deployment

### Railway (Backend)

Railway automatically deploys on push to your main branch. To configure:

1. Go to **Settings** → **Source**
2. Select your branch (usually `main` or `master`)
3. Railway will auto-deploy on every push

### Vercel (Frontend)

Vercel automatically deploys on push. To configure:

1. Go to **Settings** → **Git**
2. Production branch: `main` (or your default branch)
3. Vercel will auto-deploy on every push

---

## 🧪 Step 5: Verify Deployment

### Test Backend

```bash
# Health check
curl https://your-app-name.up.railway.app/health

# Or visit in browser
https://your-app-name.up.railway.app
```

### Test Frontend

1. Visit your Vercel URL: `https://your-app-name.vercel.app`
2. Check browser console for errors
3. Test API connection (should connect to Railway backend)

### Test Database

```bash
# Via Railway CLI
railway run npx prisma studio

# Or connect directly via Supabase dashboard
# Go to Supabase → Table Editor
```

---

## 🔧 Troubleshooting

### Backend Issues

**Problem**: Railway deployment fails
- **Solution**: Check build logs in Railway dashboard
- Ensure `server/package.json` has correct `start` script
- Check that all dependencies are in `dependencies` (not `devDependencies`)

**Problem**: Database connection fails
- **Solution**: Verify `DATABASE_URL` is correct in Railway env vars
- Check Supabase project is active
- Ensure IP allowlist in Supabase (if enabled)

**Problem**: CORS errors
- **Solution**: Verify `CLIENT_URL` in Railway matches your Vercel URL
- Check `server/src/config/server.js` includes your Vercel domain

### Frontend Issues

**Problem**: Vercel build fails
- **Solution**: Check build logs
- Ensure `client/package.json` has correct build script
- Check TypeScript errors

**Problem**: API calls fail
- **Solution**: Verify `VITE_API_BASE_URL` in Vercel env vars
- Check browser console for CORS errors
- Ensure Railway backend is running

### Database Issues

**Problem**: Migrations fail
- **Solution**: Run `npx prisma generate` first
- Check `DATABASE_URL` is correct
- Verify Prisma schema is valid

---

## 📝 Environment Variables Summary

### Railway (Backend)
```bash
DATABASE_URL=postgresql://...
NODE_ENV=production
PORT=3000
SESSION_SECRET=...
CLIENT_URL=https://...
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_BOT_TOKEN=...
```

### Vercel (Frontend)
```bash
VITE_API_BASE_URL=https://...
VITE_SOCKET_URL=https://...
```

### Local Development
Create `.env` files:

**Root `.env`:**
```bash
DATABASE_URL=postgresql://...
```

**`client/.env`:**
```bash
VITE_API_BASE_URL=http://localhost:3000
VITE_SOCKET_URL=http://localhost:3000
```

**`server/.env`:**
```bash
DATABASE_URL=postgresql://...
NODE_ENV=development
PORT=3000
SESSION_SECRET=dev-secret
CLIENT_URL=http://localhost:5173
```

---

## 🎯 Next Steps After Deployment

1. **Set up custom domains** (optional)
2. **Configure SSL certificates** (automatic on Vercel/Railway)
3. **Set up monitoring** (Railway has built-in metrics)
4. **Configure backups** (Supabase has automatic backups)
5. **Set up error tracking** (Sentry, LogRocket, etc.)

---

## 📚 Additional Resources

- [Railway Documentation](https://docs.railway.app)
- [Vercel Documentation](https://vercel.com/docs)
- [Supabase Documentation](https://supabase.com/docs)
- [Prisma Documentation](https://www.prisma.io/docs)

---

**Last Updated**: Deployment setup complete
**Status**: Ready for deployment
