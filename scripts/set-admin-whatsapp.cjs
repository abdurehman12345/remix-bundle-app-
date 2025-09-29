const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const value = process.env.NEW_WHATSAPP || "+923162890203";
  const existing = await prisma.adminConfig.findUnique({ where: { id: "app-admin" } });
  const updated = existing
    ? await prisma.adminConfig.update({ where: { id: "app-admin" }, data: { whatsappNumber: value } })
    : await prisma.adminConfig.create({ data: { id: "app-admin", whatsappNumber: value } });
  console.log("Updated AdminConfig:", updated);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
