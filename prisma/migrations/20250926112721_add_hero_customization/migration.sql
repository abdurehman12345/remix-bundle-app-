-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN "heroColorEnd" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "heroColorStart" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "heroEmoji" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "heroEnabled" BOOLEAN DEFAULT true;
ALTER TABLE "ShopSettings" ADD COLUMN "heroSubtitle" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "heroTitle" TEXT;
