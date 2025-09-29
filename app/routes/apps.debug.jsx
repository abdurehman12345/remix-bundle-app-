import { json } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  try {
    // Validate app proxy if available; skip gracefully in dev
    try { 
      await authenticate.public.appProxy(request); 
    } catch (error) {
      console.log('App proxy validation skipped (dev mode):', error.message);
    }

    console.log('🔍 Debug route called');
    console.log('🔍 Request URL:', request.url);
    console.log('🔍 Request headers:', Object.fromEntries(request.headers.entries()));

    // Get all bundles for debugging
    const allBundles = await prisma.bundle.findMany({
      include: {
        _count: {
          select: {
            products: true,
            wrappingOptions: true,
            cards: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    console.log('📋 Found', allBundles.length, 'bundles in database');

    // Check for any bundles with bundleId field
    const bundlesWithBundleId = allBundles.filter(b => b.bundleId);
    console.log('🔑 Bundles with bundleId field:', bundlesWithBundleId.length);

    // Check for active bundles
    const activeBundles = allBundles.filter(b => b.status === 'ACTIVE');
    console.log('✅ Active bundles:', activeBundles.length);

    // Check for bundles without bundleId
    const bundlesWithoutBundleId = allBundles.filter(b => !b.bundleId);
    console.log('⚠️ Bundles without bundleId field:', bundlesWithoutBundleId.length);

    // Generate bundleId for bundles that don't have one
    if (bundlesWithoutBundleId.length > 0) {
      console.log('🔧 Generating bundleIds for bundles without them...');
      
      for (const bundle of bundlesWithoutBundleId) {
        const newBundleId = `bundle_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        try {
          await prisma.bundle.update({
            where: { id: bundle.id },
            data: { bundleId: newBundleId }
          });
          console.log(`✅ Generated bundleId for bundle ${bundle.id}: ${newBundleId}`);
        } catch (error) {
          console.error(`❌ Failed to generate bundleId for bundle ${bundle.id}:`, error);
        }
      }
      
      // Refresh the bundles list after updates
      const updatedBundles = await prisma.bundle.findMany({
        include: {
          _count: {
            select: {
              products: true,
              wrappingOptions: true,
              cards: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      });
      
      console.log('🔄 Updated bundles list after generating bundleIds');
      return json({ 
        message: "Debug information and bundleId generation completed",
        timestamp: new Date().toISOString(),
        totalBundles: updatedBundles.length,
        activeBundles: updatedBundles.filter(b => b.status === 'ACTIVE').length,
        bundlesWithBundleId: updatedBundles.filter(b => b.bundleId).length,
        bundlesGenerated: bundlesWithoutBundleId.length,
        allBundles: updatedBundles.map(b => ({
          id: b.id,
          bundleId: b.bundleId,
          title: b.title,
          status: b.status,
          createdAt: b.createdAt,
          productsCount: b._count.products,
          wrapsCount: b._count.wrappingOptions,
          cardsCount: b._count.cards
        })),
        databaseInfo: {
          hasBundles: updatedBundles.length > 0,
          hasActiveBundles: updatedBundles.filter(b => b.status === 'ACTIVE').length > 0,
          hasBundleIds: updatedBundles.filter(b => b.bundleId).length > 0
        }
      }, { 
        headers: { 
          "Cache-Control": "no-cache",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        } 
      });
    }

    return json({ 
      message: "Debug information for bundle lookup",
      timestamp: new Date().toISOString(),
      totalBundles: allBundles.length,
      activeBundles: activeBundles.length,
      bundlesWithBundleId: bundlesWithBundleId.length,
      bundlesWithoutBundleId: bundlesWithoutBundleId.length,
      allBundles: allBundles.map(b => ({
        id: b.id,
        bundleId: b.bundleId,
        title: b.title,
        status: b.status,
        createdAt: b.createdAt,
        productsCount: b._count.products,
        wrapsCount: b._count.wrappingOptions,
        cardsCount: b._count.cards,
        startAt: b.startAt,
        endAt: b.endAt
      })),
      databaseInfo: {
        hasBundles: allBundles.length > 0,
        hasActiveBundles: activeBundles.length > 0,
        hasBundleIds: bundlesWithBundleId.length > 0
      }
    }, { 
      headers: { 
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      } 
    });

  } catch (error) {
    console.error('❌ Debug route error:', error);
    return json({ 
      error: "Debug route error", 
      details: error.message,
      stack: error.stack
    }, { status: 500 });
  }
};
