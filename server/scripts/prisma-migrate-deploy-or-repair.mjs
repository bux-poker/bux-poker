#!/usr/bin/env node
/**
 * Runs `prisma migrate deploy`. If it fails with P3009 for the known broken
 * migration `20260207120000_add_tournament_start_scheduled_at`, auto-repair:
 *   1) ensure "startScheduledAt" exists (IF NOT EXISTS)
 *   2) `migrate resolve --applied` for that migration
 *   3) `migrate deploy` again
 *
 * Retries on advisory-lock / P1002 timeouts (Render rolling deploy, Neon pooler).
 * Do not run this from postinstall — only prestart — so only one migrate path runs per boot.
 */
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(serverRoot, "..");
const schema = path.join(repoRoot, "prisma", "schema.prisma");
const sqlFile = path.join(__dirname, "sql", "ensure-start-scheduled-at.sql");

const FAILED = "20260207120000_add_tournament_start_scheduled_at";

const MIGRATE_MAX_ATTEMPTS = Number(process.env.PRISMA_MIGRATE_RETRY_ATTEMPTS || 8);
const MIGRATE_RETRY_DELAY_MS = Number(process.env.PRISMA_MIGRATE_RETRY_DELAY_MS || 6000);

/**
 * Prisma migrate uses pg_advisory_lock; Neon / Supabase poolers often time out (P1002).
 * Use a direct (non-pooler) URL for migrate only. See:
 * https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production#direct-database-url
 */
function neonDirectUrlFromPooler(databaseUrl) {
  if (!databaseUrl || typeof databaseUrl !== "string") return null;
  if (!databaseUrl.includes("-pooler.")) return null;
  try {
    const normalized = databaseUrl.replace(/^postgresql:/i, "postgres:");
    const u = new URL(normalized);
    if (!u.hostname.includes("-pooler.")) return null;
    u.hostname = u.hostname.replace("-pooler.", ".");
    const out = u.toString().replace(/^postgres:/, "postgresql:");
    return out;
  } catch {
    return null;
  }
}

function resolveMigrateDatabaseUrl() {
  const explicit =
    process.env.DIRECT_DATABASE_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.NEON_DATABASE_URL_DIRECT;
  if (explicit) {
    console.log("[PRESTART] Using DIRECT_DATABASE_URL (or *_UNPOOLED) for migrate only");
    return explicit;
  }
  const pool = process.env.DATABASE_URL;
  const derived = neonDirectUrlFromPooler(pool);
  if (derived) {
    console.log(
      "[PRESTART] Neon pooler detected — using derived direct host for migrate deploy only (avoids advisory-lock P1002)"
    );
    return derived;
  }
  return pool;
}

function migrateProcessEnv() {
  const env = { ...process.env };
  const url = resolveMigrateDatabaseUrl();
  if (url) env.DATABASE_URL = url;
  return env;
}

function sh(cmd) {
  try {
    return execSync(cmd, {
      cwd: serverRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      env: migrateProcessEnv(),
    });
  } catch (e) {
    const stdout = e.stdout?.toString?.() ?? "";
    const stderr = e.stderr?.toString?.() ?? "";
    const err = new Error(stdout + stderr);
    err.status = e.status;
    err.combined = stdout + stderr;
    throw err;
  }
}

function migrateDeploy() {
  return sh(`npx prisma migrate deploy --schema="${schema}"`);
}

function isMigrateLockOrPoolTimeout(combined) {
  if (!combined) return false;
  return (
    combined.includes("advisory lock") ||
    combined.includes("P1002") ||
    combined.includes("Timed out trying to acquire")
  );
}

async function migrateDeployWithRetries() {
  let lastErr;
  for (let attempt = 1; attempt <= MIGRATE_MAX_ATTEMPTS; attempt++) {
    try {
      const out = migrateDeploy();
      return out;
    } catch (e) {
      lastErr = e;
      const combined = e.combined ?? e.message ?? "";
      if (!isMigrateLockOrPoolTimeout(combined) || attempt === MIGRATE_MAX_ATTEMPTS) {
        throw e;
      }
      console.warn(
        `[PRESTART] migrate deploy attempt ${attempt}/${MIGRATE_MAX_ATTEMPTS} failed; retry in ${MIGRATE_RETRY_DELAY_MS}ms`
      );
      console.warn(combined.slice(0, 400));
      await delay(MIGRATE_RETRY_DELAY_MS);
    }
  }
  throw lastErr;
}

async function main() {
  let out;
  try {
    out = await migrateDeployWithRetries();
    process.stdout.write(out);
    console.log("[PRESTART] prisma migrate deploy OK");
    process.exit(0);
  } catch (e) {
    const combined = e.combined ?? e.message ?? "";
    process.stderr.write(combined);
    const fixable =
      combined.includes("P3009") && combined.includes(FAILED);
    if (!fixable) {
      console.error("[PRESTART] migrate deploy failed (not auto-repairable).");
      process.exit(e.status ?? 1);
    }

    console.warn(
      `[PRESTART] P3009 for ${FAILED} — auto-repair (ensure column + resolve --applied + deploy)...`
    );

    try {
      sh(`npx prisma db execute --schema="${schema}" --file="${sqlFile}"`);
    } catch (e2) {
      console.error("[PRESTART] db execute failed:", e2.combined ?? e2.message);
      process.exit(e2.status ?? 1);
    }

    try {
      sh(
        `npx prisma migrate resolve --applied ${FAILED} --schema="${schema}"`
      );
    } catch (e3) {
      console.error("[PRESTART] migrate resolve failed:", e3.combined ?? e3.message);
      process.exit(e3.status ?? 1);
    }

    try {
      out = await migrateDeployWithRetries();
      process.stdout.write(out);
      console.log("[PRESTART] prisma migrate deploy OK after auto-repair");
      process.exit(0);
    } catch (e4) {
      process.stderr.write(e4.combined ?? e4.message ?? "");
      console.error("[PRESTART] migrate deploy still failed after repair.");
      process.exit(e4.status ?? 1);
    }
  }
}

main();
