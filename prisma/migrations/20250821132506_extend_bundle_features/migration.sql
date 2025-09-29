-- CreateTable
CREATE TABLE "GlobalWrappingOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BundleGlobalWrap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bundleId" TEXT NOT NULL,
    "wrapId" TEXT NOT NULL,
    CONSTRAINT "BundleGlobalWrap_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BundleGlobalWrap_wrapId_fkey" FOREIGN KEY ("wrapId") REFERENCES "GlobalWrappingOption" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BundleCollection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bundleId" TEXT NOT NULL,
    "collectionGid" TEXT NOT NULL,
    CONSTRAINT "BundleCollection_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BundleTierPrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bundleId" TEXT NOT NULL,
    "minQuantity" INTEGER NOT NULL,
    "pricingType" TEXT NOT NULL,
    "valueCents" INTEGER,
    "valuePercent" INTEGER,
    CONSTRAINT "BundleTierPrice_bundleId_fkey" FOREIGN KEY ("bundleId") REFERENCES "Bundle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "widgetEnabled" BOOLEAN NOT NULL DEFAULT true,
    "languageJson" TEXT,
    "widgetPagesJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Bundle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "collectionId" TEXT,
    "pricingType" TEXT NOT NULL DEFAULT 'SUM',
    "priceValueCents" INTEGER,
    "minItems" INTEGER,
    "maxItems" INTEGER,
    "allowMessage" BOOLEAN NOT NULL DEFAULT false,
    "allowCardUpload" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Bundle" ("collectionId", "createdAt", "id", "maxItems", "minItems", "priceValueCents", "pricingType", "shop", "title", "updatedAt") SELECT "collectionId", "createdAt", "id", "maxItems", "minItems", "priceValueCents", "pricingType", "shop", "title", "updatedAt" FROM "Bundle";
DROP TABLE "Bundle";
ALTER TABLE "new_Bundle" RENAME TO "Bundle";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "BundleGlobalWrap_bundleId_wrapId_key" ON "BundleGlobalWrap"("bundleId", "wrapId");
