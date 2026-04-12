import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import session from "express-session";
import { RedisStore } from "connect-redis";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import passport from "./passport.js";
import apiRouter from "../routes/index.js";
import { redisClient } from "./redis.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsRoot = path.resolve(__dirname, '..', 'uploads');

if (!fs.existsSync(uploadsRoot)) {
  fs.mkdirSync(uploadsRoot, { recursive: true });
}

const app = express();
// Required behind Fly.io / Render / other reverse proxies so secure cookies + sessions see HTTPS.
if (process.env.NODE_ENV === "production" || process.env.TRUST_PROXY === "1") {
  app.set("trust proxy", 1);
}
const server = createServer(app);

// CORS configuration
const allowedOriginsSet = new Set([
  "http://localhost:5173",
  "http://localhost:3000",
]);

/** Apex ⟷ www for HTTPS production domains (not Vercel previews). */
function counterpartHttpsWww(origin) {
  if (!origin || !origin.startsWith("https://")) return null;
  try {
    const u = new URL(origin);
    const h = u.hostname.toLowerCase();
    if (h.endsWith(".vercel.app") || h === "localhost" || h === "127.0.0.1") return null;
    const port = u.port ? `:${u.port}` : "";
    if (h.startsWith("www.")) {
      return `https://${h.slice(4)}${port}`;
    }
    return `https://www.${h}${port}`;
  } catch {
    return null;
  }
}

function addClientSiteOrigins(url) {
  const trimmed = String(url || "").trim().replace(/\/+$/, "");
  if (!trimmed) return;
  allowedOriginsSet.add(trimmed);
  const other = counterpartHttpsWww(trimmed);
  if (other && other !== trimmed) allowedOriginsSet.add(other);
}

if (process.env.CLIENT_URL) {
  addClientSiteOrigins(process.env.CLIENT_URL);
}

if (process.env.CLIENT_URL_ALT) {
  addClientSiteOrigins(process.env.CLIENT_URL_ALT);
}

// Comma-separated extra origins (e.g. Vercel preview URLs): https://foo.vercel.app,https://bar.vercel.app
if (process.env.CORS_EXTRA_ORIGINS) {
  for (const o of process.env.CORS_EXTRA_ORIGINS.split(",")) {
    const trimmed = o.trim();
    if (trimmed) allowedOriginsSet.add(trimmed);
  }
}

const allowedOrigins = [...allowedOriginsSet];

/**
 * Vercel preview deploys use unique subdomains each time. Allow https://*.vercel.app when the
 * hostname clearly belongs to this app (contains "bux-poker"). Set CORS_STRICT_VERCEL=true to disable.
 */
function isAllowedBuxPokerVercelPreview(origin) {
  if (process.env.CORS_STRICT_VERCEL === "true") {
    return false;
  }
  try {
    const u = new URL(origin);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (!host.endsWith(".vercel.app")) return false;
    return host.includes("bux-poker");
  } catch {
    return false;
  }
}

// Log allowed origins once at startup (not on every request)
console.log('[CORS] Allowed origins:', allowedOrigins);
console.log('[CORS] CLIENT_URL env var:', process.env.CLIENT_URL || 'NOT SET');
console.log(
  "[CORS] Vercel bux-poker preview auto-allow:",
  process.env.CORS_STRICT_VERCEL === "true" ? "OFF (CORS_STRICT_VERCEL)" : "ON (*.vercel.app host contains bux-poker)"
);

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      return callback(null, true);
    }
    
    // Check if origin is in allowed list
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else if (isAllowedBuxPokerVercelPreview(origin)) {
      callback(null, true);
    } else {
      // Only log denied requests (these are errors worth logging)
      console.warn('[CORS] Origin NOT allowed:', origin);
      console.warn('[CORS] Allowed origins are:', allowedOrigins);
      callback(new Error(`Not allowed by CORS. Origin: ${origin}`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  // Include common headers so preflight succeeds if clients send them (e.g. cache-busting)
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma', 'X-Requested-With']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use("/uploads", express.static(uploadsRoot));

// API routes
app.use("/api", apiRouter);

/**
 * Discord Developer Portal often has redirect `https://<api-host>/callback` while the real route is
 * `/api/auth/discord/callback`. Discord sends users to `/callback?code=...`; without this, the browser
 * hangs waiting for a handler. Preserve query string (code, state, error).
 */
app.get("/callback", (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  const dest = qs ? `/api/auth/discord/callback?${qs}` : "/api/auth/discord/callback";
  res.redirect(302, dest);
});

// Session configuration: use Redis when REDIS_URL is set (persistent sessions, multi-instance safe)
const sessionConfig = {
  secret: process.env.SESSION_SECRET || "fallback-session-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
};
if (redisClient) {
  sessionConfig.store = new RedisStore({ client: redisClient, prefix: "bux-poker:sess:" });
  console.log("[SESSION] Using Redis store");
} else {
  console.warn("[SESSION] Using default in-memory store (no Redis client)");
}

/** Single session middleware instance — required for Socket.IO to share cookies with Express. */
const sessionMiddleware = session(sessionConfig);
app.use(sessionMiddleware);

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Last: never return Express default HTML for /api — clients expect JSON
app.use((err, req, res, next) => {
  console.error("[API] Unhandled error:", err?.name, err?.message);
  if (err?.stack && process.env.NODE_ENV !== "production") {
    console.error(err.stack);
  }
  if (res.headersSent) {
    return next(err);
  }
  const statusRaw = Number(err?.status ?? err?.statusCode);
  const status =
    statusRaw >= 400 && statusRaw < 600 ? statusRaw : 500;
  const isApi = req.originalUrl?.startsWith("/api");
  if (isApi) {
    return res.status(status).json({
      error: err?.message || "Internal Server Error",
    });
  }
  return res.status(status).send(err?.message || "Internal Server Error");
});

// Socket.IO configuration
const io = new Server(server, {
  cors: corsOptions,
  path: '/socket.io',
  transports: ['polling', 'websocket']
});

// Share Express session + Passport with Socket.IO handshakes (for per-viewer game-state).
io.engine.use(sessionMiddleware);
io.engine.use(passport.initialize());
io.engine.use(passport.session());

const PORT = process.env.PORT || 3000;

export { app, server, io, PORT };
