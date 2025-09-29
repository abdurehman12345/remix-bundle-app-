-- Purpose: Persist subscription state per shop
CREATE TABLE IF NOT EXISTS "ShopSubscription" (
  "shop" TEXT PRIMARY KEY,
  "subscriptionId" TEXT,
  "status" TEXT,
  "planName" TEXT,
  "trialEndsAt" DATETIME,
  "rawPayload" TEXT,
  "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
);


