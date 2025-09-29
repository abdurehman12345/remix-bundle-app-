-- Step 1: Add bundleId column as nullable
ALTER TABLE "Bundle" ADD COLUMN "bundleId" TEXT;

-- Step 2: Populate bundleId for existing records
UPDATE "Bundle" SET "bundleId" = "id" WHERE "bundleId" IS NULL;

-- Step 3: Make bundleId required and unique
CREATE UNIQUE INDEX "Bundle_bundleId_key" ON "Bundle"("bundleId");
