# 🔗 Discord OAuth Redirect URL Setup

## Quick Steps to Add Redirect URL

### Step 1: Go to Discord Developer Portal

1. Visit [https://discord.com/developers/applications](https://discord.com/developers/applications)
2. Sign in with your Discord account
3. Select your **BUX Poker** application (or create one if you haven't)

### Step 2: Navigate to OAuth2 Settings

1. In the left sidebar, click **OAuth2**
2. Scroll down to the **Redirects** section
3. Click **"Add Redirect"** button

### Step 3: Add Your Callback URL

**Option A: If using custom domain `api.bux-poker.pro`:**
```
https://api.bux-poker.pro/api/auth/discord/callback
```

**Option B: If using Railway default domain:**
```
https://your-railway-url.railway.app/api/auth/discord/callback
```

**Option C: If using Render default domain:**
```
https://bux-poker-server.onrender.com/api/auth/discord/callback
```

**Option D: For local development:**
```
http://localhost:3000/api/auth/discord/callback
```

### Step 4: Save

1. Paste the URL in the input field
2. Click **"Add"** or **"Save Changes"**
3. The redirect URL will appear in your list

---

## Important Notes

### Multiple Redirect URLs

You can add **multiple redirect URLs** if needed:
- One for production (custom domain or Railway/Render)
- One for local development (localhost)
- One for staging (if you have a staging environment)

Discord allows multiple redirects, so you can have:
```
https://api.bux-poker.pro/api/auth/discord/callback
http://localhost:3000/api/auth/discord/callback
```

### URL Must Match Exactly

⚠️ **Important**: The redirect URL in Discord **must match exactly** what your server expects:
- Protocol: `https://` (or `http://` for localhost)
- Domain: Your backend domain
- Path: `/api/auth/discord/callback` (exact path)

### Update Environment Variables

After adding the redirect URL in Discord, make sure your backend environment variable matches:

**In Railway/Render:**
```bash
DISCORD_CALLBACK_URL=https://api.bux-poker.pro/api/auth/discord/callback
# OR
DISCORD_CALLBACK_URL=https://your-railway-url.railway.app/api/auth/discord/callback
```

---

## Verify It's Working

### Test the OAuth Flow

1. Visit your frontend: `https://bux-poker.pro` (or your Vercel URL)
2. Click **"Login with Discord"**
3. You should be redirected to Discord authorization page
4. After authorizing, you should be redirected back to your app
5. Check browser console for any errors

### Common Issues

**Error: "Invalid OAuth2 redirect_uri"**
- The redirect URL in Discord doesn't match what your server is sending
- Check `DISCORD_CALLBACK_URL` environment variable
- Verify the URL is added in Discord Developer Portal

**Error: "Redirect URI mismatch"**
- The URL in Discord must match exactly (including protocol, domain, and path)
- No trailing slashes
- Case-sensitive

---

## Current Setup

Based on your code, the callback URL is constructed as:
```javascript
process.env.DISCORD_CALLBACK_URL || `${process.env.API_BASE_URL || 'http://localhost:3000'}/api/auth/discord/callback`
```

So you can either:
1. Set `DISCORD_CALLBACK_URL` explicitly in your environment variables
2. Or set `API_BASE_URL` and it will append `/api/auth/discord/callback`

---

## Quick Reference

**Discord Developer Portal:**
- URL: https://discord.com/developers/applications
- Path: Your App → OAuth2 → Redirects

**Callback Path:**
- Always: `/api/auth/discord/callback`

**Full URLs:**
- Custom domain: `https://api.bux-poker.pro/api/auth/discord/callback`
- Railway: `https://[your-app].up.railway.app/api/auth/discord/callback`
- Render: `https://[your-app].onrender.com/api/auth/discord/callback`
- Local: `http://localhost:3000/api/auth/discord/callback`
