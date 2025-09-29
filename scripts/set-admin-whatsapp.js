const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const value = process.env.NEW_WHATSAPP || "+923162890203";
  const updated = await prisma.adminConfig.upsert({
    where: { id: "app-admin" },
    update: { whatsappNumber: value },
    create: { id: "app-admin", whatsappNumber: value },
  });
  console.log("Updated AdminConfig:", updated);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
