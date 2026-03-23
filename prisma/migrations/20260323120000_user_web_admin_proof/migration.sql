-- Persist last successful web admin verification (survives Discord REST global 429).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "webAdminVerifiedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "webAdminProofHash" TEXT;
