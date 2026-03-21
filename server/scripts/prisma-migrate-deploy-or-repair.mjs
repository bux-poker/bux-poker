#!/usr/bin/env node
/**
 * Runs `prisma migrate deploy`. If it fails with P3009 for the known broken
 * migration `20260207120000_add_tournament_start_scheduled_at`, auto-repair:
 *   1) ensure "startScheduledAt" exists (IF NOT EXISTS)
 *   2) `migrate resolve --applied` for that migration
 *   3) `migrate deploy` again
 *
 * This unblocks Render deploys without a manual laptop + DATABASE_URL step.
 */
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(serverRoot, "..");
const schema = path.join(repoRoot, "prisma", "schema.prisma");
const sqlFile = path.join(__dirname, "sql", "ensure-start-scheduled-at.sql");

const FAILED = "20260207120000_add_tournament_start_scheduled_at";

function sh(cmd) {
  try {
    return execSync(cmd, {
      cwd: serverRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
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

let out;
try {
  out = migrateDeploy();
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
    out = migrateDeploy();
    process.stdout.write(out);
    console.log("[PRESTART] prisma migrate deploy OK after auto-repair");
    process.exit(0);
  } catch (e4) {
    process.stderr.write(e4.combined ?? e4.message ?? "");
    console.error("[PRESTART] migrate deploy still failed after repair.");
    process.exit(e4.status ?? 1);
  }
}
