# 🔧 Render Environment Variables Checklist

## Required Environment Variables for Discord OAuth to Work

### 1. Database Connection (CRITICAL)
```bash
DATABASE_URL=postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres
```
**Without this, the server will crash when trying to create/update users.**

### 2. Discord OAuth Credentials (REQUIRED)
```bash
DISCORD_CLIENT_ID=1461311075428601959
DISCORD_CLIENT_SECRET=your_discord_client_secret
DISCORD_CALLBACK_URL=https://bux-poker-server.onrender.com/api/auth/discord/callback
```

### 3. JWT Secret (REQUIRED)
```bash
JWT_SECRET=your-random-secret-key-here
```
**Generate one:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Client URL (REQUIRED - CRITICAL FOR CORS)
```bash
CLIENT_URL=https://bux-poker.pro
```
**⚠️ IMPORTANT:** This must be set to your custom domain (`https://bux-poker.pro`) for CORS to work correctly. The server will automatically allow both `https://bux-poker.pro` and `https://www.bux-poker.pro` if this is set.

**Without this, you'll get CORS errors when trying to authenticate!**

### 5. Server Configuration
```bash
NODE_ENV=production
PORT=3000
SESSION_SECRET=another-random-secret-key
```

### 6. Optional: Discord Bot
```bash
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_GUILD_ID=your_guild_id
```

---

## How to Check Render Logs

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Select your service: `bux-poker-server`
3. Click on **"Logs"** tab
4. Look for errors when you try to log in

**Common errors you might see:**
- `PrismaClientInitializationError` → Missing or incorrect `DATABASE_URL`
- `TypeError: Cannot read property 'id' of undefined` → User not being created (database issue)
- `jwt.sign is not a function` → Missing `jsonwebtoken` package (unlikely)
- `Invalid OAuth2 redirect_uri` → Wrong `DISCORD_CALLBACK_URL`

---

## Quick Fix Steps

### Step 1: Verify Environment Variables in Render

1. Go to Render Dashboard → Your Service
2. Click **"Environment"** tab
3. Check that all required variables are set:
   - ✅ `DATABASE_URL`
   - ✅ `DISCORD_CLIENT_ID`
   - ✅ `DISCORD_CLIENT_SECRET`
   - ✅ `DISCORD_CALLBACK_URL`
   - ✅ `JWT_SECRET`
   - ✅ `CLIENT_URL`

### Step 2: Check Render Logs

1. Go to **"Logs"** tab
2. Try logging in again
3. Look for the error message
4. The improved error handling will now show detailed error messages

### Step 3: Test Database Connection

If you see database errors, verify:
1. Your Supabase database is active
2. `DATABASE_URL` is correct (use the Session pooler URI)
3. Database password is correct

---

## Most Likely Issues

### Issue 1: Missing DATABASE_URL
**Symptom**: Internal Server Error, Prisma errors in logs
**Fix**: Add `DATABASE_URL` to Render environment variables

### Issue 2: Missing JWT_SECRET
**Symptom**: Internal Server Error when generating token
**Fix**: Generate and add `JWT_SECRET` to Render

### Issue 3: Wrong DISCORD_CALLBACK_URL
**Symptom**: "Invalid OAuth2 redirect_uri" error
**Fix**: Make sure `DISCORD_CALLBACK_URL` matches exactly what's in Discord Developer Portal

### Issue 4: Missing CLIENT_URL (CORS ERRORS)
**Symptom**: "CORS header 'Access-Control-Allow-Origin' missing" errors in browser console
**Fix**: Add `CLIENT_URL=https://bux-poker.pro` to Render environment variables and redeploy

---

## After Adding Variables

1. **Redeploy** your Render service (or wait for auto-deploy)
2. **Check logs** to verify no startup errors
3. **Try logging in** again
4. **Check logs** for any new errors

---

## Debugging Commands

If you have Render CLI access:
```bash
# View environment variables
render env:list

# View logs
render logs
```

---

## Next Steps

1. ✅ Check Render environment variables
2. ✅ Check Render logs for specific error
3. ✅ Verify all required variables are set
4. ✅ Test login again
5. ✅ Share the error from logs if still failing
