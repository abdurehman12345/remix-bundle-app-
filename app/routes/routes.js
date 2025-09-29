// Reserved for future shared route helpers
export const PLAN = Object.freeze({ FREE: 'FREE', PRO: 'PRO' });

export async function getPlan(prisma, shop){
  try{
    if(!shop) return PLAN.FREE;
    const s = await prisma.shopSettings.findUnique({ where: { shop } });
    return (s && s.plan) || PLAN.FREE;
  }catch(_){ return PLAN.FREE; }
}


