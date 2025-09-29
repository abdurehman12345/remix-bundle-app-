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
    "messageCharLimit" INTEGER,
    "personalizationFeeCents" INTEGER,
    "wrapRequired" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "type" TEXT NOT NULL DEFAULT 'FIXED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Bundle" ("allowCardUpload", "allowMessage", "collectionId", "createdAt", "description", "id", "imageUrl", "maxItems", "minItems", "priceValueCents", "pricingType", "shop", "title", "updatedAt") SELECT "allowCardUpload", "allowMessage", "collectionId", "createdAt", "description", "id", "imageUrl", "maxItems", "minItems", "priceValueCents", "pricingType", "shop", "title", "updatedAt" FROM "Bundle";
DROP TABLE "Bundle";
ALTER TABLE "new_Bundle" RENAME TO "Bundle";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
