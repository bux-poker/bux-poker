# Discord Bot & Admin Panel Setup

## What Was Built

### 1. Discord Bot (`server/src/discord/bot.js`)
- Slash commands:
  - `/tournament` - Create a new tournament
  - `/list-tournaments` - List all active tournaments
  - `/register` - Register for a tournament
- Automatically initializes when server starts (if credentials are provided)

### 2. Admin API Routes (`server/src/routes/admin.js`)
- `POST /api/admin/tournaments` - Create a new tournament (requires JWT auth)
- `POST /api/admin/tournaments/:id/start` - Start a tournament
- `POST /api/admin/tournaments/:id/advance-blinds` - Advance blind levels
- `POST /api/admin/tournaments/:id/end` - End a tournament

### 3. Discord OAuth (`server/src/routes/auth.js`)
- `GET /api/auth/discord` - Initiate Discord login
- `GET /api/auth/discord/callback` - Discord OAuth callback (returns JWT token)
- `GET /api/auth/profile` - Get current user profile (requires JWT)

### 4. Frontend Components
- **LoginButton** (`client/src/components/auth/LoginButton.tsx`) - Discord login button
- **CreateTournament** (`client/src/components/admin/CreateTournament.tsx`) - Admin panel for creating tournaments
- **AuthCallback** (`client/src/pages/AuthCallback.tsx`) - Handles OAuth callback

## Environment Variables Needed

### Backend (Render)
Add these to your Render service environment variables:

```bash
# Discord OAuth (for user login)
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
DISCORD_CALLBACK_URL=https://bux-poker-server.onrender.com/api/auth/discord/callback

# Discord Bot (for slash commands)
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_GUILD_ID=your_discord_guild_id  # Optional: for faster command registration

# JWT Secret (for token generation)
JWT_SECRET=your_random_secret_key

# Client URL (for OAuth redirects)
CLIENT_URL=https://bux-poker-puce.vercel.app

# API Base URL (for Discord bot API calls)
API_BASE_URL=https://bux-poker-server.onrender.com
```

### Frontend (Vercel)
Already set:
- `VITE_API_BASE_URL=https://bux-poker-server.onrender.com`
- `VITE_SOCKET_URL=https://bux-poker-server.onrender.com`

## Discord Setup Steps

### 1. Create Discord Application
1. Go to https://discord.com/developers/applications
2. Click "New Application"
3. Name it "BUX Poker" (or your choice)
4. Go to **OAuth2** → **General**
   - Copy **Client ID** → `DISCORD_CLIENT_ID`
   - Copy **Client Secret** → `DISCORD_CLIENT_SECRET`
   - Add redirect: `https://bux-poker-server.onrender.com/api/auth/discord/callback`

### 2. Create Discord Bot
1. In the same application, go to **Bot**
2. Click "Add Bot"
3. Copy **Token** → `DISCORD_BOT_TOKEN`
4. Enable **MESSAGE CONTENT INTENT** (if needed)
5. Go to **OAuth2** → **URL Generator**
   - Select scopes: `bot`, `applications.commands`
   - Select permissions: `Send Messages`, `Use Slash Commands`
   - Copy the generated URL and invite bot to your server

### 3. Get Guild ID (Optional)
1. Enable Developer Mode in Discord (User Settings → Advanced)
2. Right-click your server → "Copy Server ID"
3. Use this as `DISCORD_GUILD_ID` for faster command registration

## Testing

### 1. Test Discord Login
1. Visit `https://bux-poker-puce.vercel.app`
2. Click "Login with Discord"
3. Authorize the application
4. You should be redirected back and logged in

### 2. Test Admin Panel
1. After logging in, go to `/admin`
2. Fill out the tournament creation form
3. Submit - tournament should be created

### 3. Test Discord Bot
1. In your Discord server, type `/tournament`
2. Fill in the parameters
3. The bot should create a tournament via the API

## Notes

- The Discord bot requires the same `DISCORD_CLIENT_ID` as OAuth (they're the same application)
- The bot will only initialize if `DISCORD_BOT_TOKEN` and `DISCORD_CLIENT_ID` are set
- OAuth will only work if `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are set
- All admin routes require JWT authentication (login via Discord first)
