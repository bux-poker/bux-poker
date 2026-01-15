#!/bin/bash
# Script to fix Prisma client on Render
# Run this in Render's Shell: bash scripts/fix-prisma.sh

echo "Current directory: $(pwd)"
echo "Listing prisma directory..."
ls -la ../prisma/ || ls -la ../../prisma/ || ls -la prisma/

echo "Applying migrations..."
npx prisma migrate deploy --schema=../prisma/schema.prisma || npx prisma migrate deploy --schema=../../prisma/schema.prisma || npx prisma migrate deploy --schema=./prisma/schema.prisma

echo "Generating Prisma client..."
npx prisma generate --schema=../prisma/schema.prisma || npx prisma generate --schema=../../prisma/schema.prisma || npx prisma generate --schema=./prisma/schema.prisma

echo "Verifying Prisma client..."
ls -la node_modules/@prisma/client/ | head -5

echo "Done! Please restart your Render service."
