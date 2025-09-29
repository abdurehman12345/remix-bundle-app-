/*
  Warnings:

  - You are about to alter the column `rawPayload` on the `ShopSubscription` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - Made the column `shop` on table `ShopSubscription` required. This step will fail if there are existing NULL values in that column.
  - Made the column `updatedAt` on table `ShopSubscription` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateTable
CREATE TABLE "AdminConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'app-admin',
    "appUrl" TEXT,
    "webhooksVersion" TEXT,
    "appHandle" TEXT,
    "whatsappNumber" TEXT,
    "email" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ShopSubscription" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "subscriptionId" TEXT,
    "status" TEXT,
    "planName" TEXT,
    "trialEndsAt" DATETIME,
    "rawPayload" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ShopSubscription" ("createdAt", "planName", "rawPayload", "shop", "status", "subscriptionId", "trialEndsAt", "updatedAt") SELECT coalesce("createdAt", CURRENT_TIMESTAMP) AS "createdAt", "planName", "rawPayload", "shop", "status", "subscriptionId", "trialEndsAt", "updatedAt" FROM "ShopSubscription";
DROP TABLE "ShopSubscription";
ALTER TABLE "new_ShopSubscription" RENAME TO "ShopSubscription";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
