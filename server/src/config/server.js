import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import session from "express-session";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import passport from "./passport.js";
import apiRouter from "../routes/index.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsRoot = path.resolve(__dirname, '..', 'uploads');

if (!fs.existsSync(uploadsRoot)) {
  fs.mkdirSync(uploadsRoot, { recursive: true });
}

const app = express();
const server = createServer(app);

// CORS configuration
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000"
];

if (process.env.CLIENT_URL) {
  allowedOrigins.push(process.env.CLIENT_URL);
  // Also add www version if main domain is provided
  if (process.env.CLIENT_URL.startsWith('https://') && !process.env.CLIENT_URL.includes('www.')) {
    allowedOrigins.push(process.env.CLIENT_URL.replace('https://', 'https://www.'));
  }
}

if (process.env.CLIENT_URL_ALT) {
  allowedOrigins.push(process.env.CLIENT_URL_ALT);
}

const corsOptions = {
  origin: allowedOrigins,
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());
app.use("/uploads", express.static(uploadsRoot));

// API routes
app.use("/api", apiRouter);

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET || "fallback-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  })
);

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Socket.IO configuration
const io = new Server(server, {
  cors: corsOptions,
  path: '/socket.io',
  transports: ['polling', 'websocket']
});

const PORT = process.env.PORT || 3000;

export { app, server, io, PORT };
