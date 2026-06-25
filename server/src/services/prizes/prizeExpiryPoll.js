import { runExpiredPrizeClaimsTick } from "./prizeExpirySweep.js";

const POLL_MS = 5 * 60 * 1000;

let intervalId = null;
let tickInFlight = false;
let backoffUntilMs = 0;

function isPrismaPressureError(err) {
  const msg = `${err?.message ?? err ?? ""}`;
  return (
    msg.includes("connection pool") ||
    msg.includes("PrismaClientKnownRequestError") ||
    msg.includes("Can't reach database server") ||
    msg.includes("Can't reach database")
  );
}

export function startPrizeExpiryPoll() {
  if (intervalId) return;
  intervalId = setInterval(async () => {
    const now = Date.now();
    if (tickInFlight) return;
    if (now < backoffUntilMs) return;
    tickInFlight = true;
    try {
      await runExpiredPrizeClaimsTick();
    } catch (err) {
      console.error("[PRIZES] Expiry sweep poll error:", err);
      if (isPrismaPressureError(err)) {
        backoffUntilMs = Date.now() + 30000;
      }
    } finally {
      tickInFlight = false;
    }
  }, POLL_MS);
  console.log(
    `[PRIZES] Expiry sweep poll every ${POLL_MS / 60000} min (7-day claim window → refund wallet)`
  );
  runExpiredPrizeClaimsTick().catch((err) =>
    console.error("[PRIZES] Expiry sweep initial tick:", err)
  );
}
