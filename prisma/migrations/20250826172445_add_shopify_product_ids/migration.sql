-- AlterTable
ALTER TABLE "BundleCard" ADD COLUMN "shopifyProductId" TEXT;
ALTER TABLE "BundleCard" ADD COLUMN "shopifyVariantId" TEXT;

-- AlterTable
ALTER TABLE "WrappingOption" ADD COLUMN "shopifyProductId" TEXT;
ALTER TABLE "WrappingOption" ADD COLUMN "shopifyVariantId" TEXT;
