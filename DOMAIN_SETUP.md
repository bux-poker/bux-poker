# 🌐 Custom Domain Setup - bux-poker.pro

This guide will help you connect your Namecheap domain `bux-poker.pro` to your BUX Poker application.

## Architecture

- **Frontend**: `bux-poker.pro` → Vercel
- **Backend API**: `api.bux-poker.pro` → Railway/Render (optional, or use Railway's default domain)

---

## 📋 Step 1: Add Domain to Vercel (Frontend)

### 1.1 Add Domain in Vercel Dashboard

1. Go to [vercel.com](https://vercel.com) and sign in
2. Select your **BUX Poker** project
3. Go to **Settings** → **Domains**
4. Click **"Add Domain"**
5. Enter your domain: `bux-poker.pro`
6. Click **"Add"**

### 1.2 Configure DNS Records

Vercel will show you the DNS records you need to add. You'll typically see:

**Option A: Apex Domain (bux-poker.pro)**
- **Type**: `A`
- **Name**: `@` (or leave blank)
- **Value**: `76.76.21.21` (Vercel's IP - this may vary, use what Vercel shows)

**Option B: CNAME (www.bux-poker.pro)**
- **Type**: `CNAME`
- **Name**: `www`
- **Value**: `cname.vercel-dns.com` (or what Vercel shows)

**Recommended**: Add both `@` (apex) and `www` records so both `bux-poker.pro` and `www.bux-poker.pro` work.

---

## 📋 Step 2: Configure DNS in Namecheap

### 2.1 Access Namecheap DNS Settings

1. Go to [namecheap.com](https://namecheap.com) and sign in
2. Go to **Domain List**
3. Find `bux-poker.pro` and click **"Manage"**
4. Go to **Advanced DNS** tab

### 2.2 Add DNS Records

**Add A Record (Apex Domain):**
1. Click **"Add New Record"**
2. Select **Type**: `A Record`
3. **Host**: `@` (or leave blank for apex)
4. **Value**: `76.76.21.21` (use the IP Vercel provided)
5. **TTL**: `Automatic` (or `30 min`)
6. Click **✓** to save

**Add CNAME Record (WWW):**
1. Click **"Add New Record"**
2. Select **Type**: `CNAME Record`
3. **Host**: `www`
4. **Value**: `cname.vercel-dns.com` (use what Vercel provided)
5. **TTL**: `Automatic` (or `30 min`)
6. Click **✓** to save

**Optional: Add API Subdomain (if using custom backend domain):**
1. Click **"Add New Record"**
2. Select **Type**: `CNAME Record`
3. **Host**: `api`
4. **Value**: `your-backend-url.railway.app` (or your Railway/Render domain)
5. **TTL**: `Automatic`
6. Click **✓** to save

### 2.3 Remove/Update Existing Records

- Remove any conflicting A or CNAME records for `@` or `www`
- Keep any other records you need (email, etc.)

---

## 📋 Step 3: Update Environment Variables

### 3.1 Update Vercel Environment Variables

After the domain is connected, update your Vercel environment variables:

1. Go to Vercel → Your Project → **Settings** → **Environment Variables**
2. Update (or add if missing):
   ```bash
   VITE_API_BASE_URL=https://api.bux-poker.pro
   # OR if not using custom API domain:
   VITE_API_BASE_URL=https://your-railway-url.railway.app
   
   VITE_SOCKET_URL=https://api.bux-poker.pro
   # OR if not using custom API domain:
   VITE_SOCKET_URL=https://your-railway-url.railway.app
   ```

### 3.2 Update Railway/Render Environment Variables

1. Go to Railway/Render dashboard → Your Service → **Variables**
2. Update:
   ```bash
   CLIENT_URL=https://bux-poker.pro
   CLIENT_URL_ALT=https://www.bux-poker.pro
   ```

### 3.3 Update Discord OAuth Callback URL

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your application
3. Go to **OAuth2** → **Redirects**
4. Update the callback URL to:
   ```
   https://api.bux-poker.pro/api/auth/discord/callback
   # OR if using Railway default domain:
   https://your-railway-url.railway.app/api/auth/discord/callback
   ```
5. Update `DISCORD_CALLBACK_URL` in Railway/Render env vars to match

---

## 📋 Step 4: Wait for DNS Propagation

DNS changes can take **15 minutes to 48 hours** to propagate, but usually complete within 1-2 hours.

### Check DNS Propagation

You can check if DNS has propagated:

```bash
# Check A record
dig bux-poker.pro

# Check CNAME record
dig www.bux-poker.pro

# Or use online tools:
# - https://dnschecker.org
# - https://www.whatsmydns.net
```

### Verify in Vercel

1. Go to Vercel → Your Project → **Settings** → **Domains**
2. Wait for the domain status to show **"Valid Configuration"** (green checkmark)
3. This may take a few minutes after DNS propagates

---

## 📋 Step 5: Enable HTTPS (Automatic)

Vercel automatically provisions SSL certificates via Let's Encrypt once DNS is configured. This usually happens within a few minutes of DNS propagation.

You can check SSL status in:
- Vercel → Settings → Domains → Your domain

---

## 📋 Step 6: Test Your Domain

### Test Frontend

1. Visit `https://bux-poker.pro` (should load your Vercel app)
2. Visit `https://www.bux-poker.pro` (should also work)
3. Check browser console for any errors
4. Test that API calls work correctly

### Test Backend (if using custom API domain)

1. Visit `https://api.bux-poker.pro/health` (or your health check endpoint)
2. Should return a successful response

---

## 🔧 Troubleshooting

### Domain Not Resolving

**Problem**: Domain shows "Not Configured" in Vercel
- **Solution**: 
  - Wait for DNS propagation (can take up to 48 hours)
  - Verify DNS records are correct in Namecheap
  - Check that you're using the correct IP/CNAME values from Vercel

**Problem**: DNS records are correct but domain doesn't work
- **Solution**:
  - Clear your DNS cache: `sudo dscacheutil -flushcache` (macOS) or restart your router
  - Try accessing from a different network/device
  - Check Vercel domain status page

### SSL Certificate Issues

**Problem**: HTTPS not working
- **Solution**: 
  - Wait 10-15 minutes after DNS propagation for Let's Encrypt to provision
  - Check Vercel domain settings for SSL status
  - Ensure DNS records are pointing to Vercel correctly

### CORS Errors

**Problem**: API calls fail with CORS errors
- **Solution**:
  - Verify `CLIENT_URL` in Railway/Render includes `https://bux-poker.pro` and `https://www.bux-poker.pro`
  - Check `server/src/config/server.js` CORS configuration
  - Ensure backend environment variables are updated

### API Not Working

**Problem**: Frontend can't connect to backend
- **Solution**:
  - Verify `VITE_API_BASE_URL` in Vercel matches your backend URL
  - Check that backend is running and accessible
  - Test backend URL directly in browser/Postman

---

## 📝 DNS Records Summary

Here's what your Namecheap DNS should look like:

```
Type    Host    Value                          TTL
A       @       76.76.21.21                   Automatic
CNAME   www     cname.vercel-dns.com          Automatic
CNAME   api     your-backend.railway.app       Automatic (optional)
```

**Note**: The IP address `76.76.21.21` is an example. Use the actual IP that Vercel provides in your dashboard.

---

## 🎯 Next Steps

1. ✅ Domain connected to Vercel
2. ✅ DNS records configured
3. ✅ Environment variables updated
4. ✅ SSL certificate provisioned
5. ✅ Test domain access
6. ✅ Update any hardcoded URLs in code/docs

---

## 📚 Additional Resources

- [Vercel Custom Domains Documentation](https://vercel.com/docs/concepts/projects/domains)
- [Namecheap DNS Management Guide](https://www.namecheap.com/support/knowledgebase/article.aspx/767/10/how-can-i-set-up-an-a-address-record-for-my-domain/)
- [DNS Propagation Checker](https://dnschecker.org)

---

**Last Updated**: Domain setup guide created
**Status**: Ready for domain configuration
