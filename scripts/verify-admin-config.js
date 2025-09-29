import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verifyAdminConfig() {
  try {
    console.log('Checking AdminConfig table...');
    
    // Check if table exists and get current data
    const config = await prisma.adminConfig.findUnique({
      where: { id: 'app-admin' }
    });
    
    if (config) {
      console.log('✅ AdminConfig table exists with data:');
      console.log(JSON.stringify(config, null, 2));
    } else {
      console.log('⚠️  AdminConfig table exists but no data found. Creating default config...');
      
      const newConfig = await prisma.adminConfig.create({
        data: {
          id: 'app-admin',
          appUrl: process.env.SHOPIFY_APP_URL || 'https://your-app-url.com',
          webhooksVersion: '2025-07',
          appHandle: 'bundle-app-235',
          whatsappNumber: '+1234567890',
          email: 'admin@example.com'
        }
      });
      
      console.log('✅ Created default AdminConfig:');
      console.log(JSON.stringify(newConfig, null, 2));
    }
    
    // Also check ShopSubscription table
    const subscriptions = await prisma.shopSubscription.findMany();
    console.log(`\n📊 Found ${subscriptions.length} shop subscriptions:`);
    subscriptions.forEach(sub => {
      console.log(`- ${sub.shop}: ${sub.status} (${sub.planName})`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

verifyAdminConfig();
